/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Bot, Context, InputFile } from 'grammy';
import { run, sequentialize } from '@grammyjs/runner';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { SessionManager } from '../../core/session.js';
import { processMessage } from '../../core/messageLoop.js';
import { createTelegramSendMedia } from './outbound.js';
import type {
  ChannelReply,
  SessionOptions,
  DaemonSession,
  MultimodalInput,
} from '../../core/types.js';
import { registerCommands } from './commands.js';
import { telegramFormatter, markdownToHtml } from './formatter.js';
import { logger } from '../../utils/logger.js';

const TYPING_KEEPALIVE_MS = 3000;
const TYPING_TTL_MS = 3_600_000; // Safety: auto-stop typing after 1 hour
const DOWNLOAD_MAX_RETRIES = 3;
const DOWNLOAD_RETRY_BASE_MS = 1000;

export interface TelegramBotOptions {
  allowedUsers?: number[];
  model?: string;
  cwd?: string;
}

/**
 * Returns a sequentialize key for grammY's runner.
 *
 * Regular messages get keyed by chatId, so they're processed serially per chat.
 * /cancel gets a separate key (`control:${chatId}`) so it runs concurrently
 * with the in-progress message handler — otherwise it would be queued behind it.
 */
function getSequentialKey(ctx: {
  chat?: { id?: number };
  message?: { text?: string };
}): string {
  const chatId = ctx.chat?.id ?? 0;
  const text = ctx.message?.text ?? '';
  if (text.startsWith('/cancel')) {
    return `control:${chatId}`;
  }
  return `chat:${chatId}`;
}

/**
 * Build a ChannelReply that bridges the core message loop to Telegram's API.
 */
function buildChannelReply(ctx: Context, chatId: number): ChannelReply {
  return {
    send: async (replyText: string): Promise<number> => {
      try {
        const msg = await ctx.reply(markdownToHtml(replyText), {
          parse_mode: 'HTML',
        });
        return msg.message_id;
      } catch {
        const msg = await ctx.reply(replyText);
        return msg.message_id;
      }
    },
    edit: async (messageId: number, newText: string): Promise<void> => {
      try {
        await ctx.api.editMessageText(
          chatId,
          messageId,
          markdownToHtml(newText),
          { parse_mode: 'HTML' },
        );
      } catch {
        await ctx.api.editMessageText(chatId, messageId, newText);
      }
    },
    sendPlain: async (replyText: string): Promise<number> => {
      const msg = await ctx.reply(replyText);
      return msg.message_id;
    },
    editPlain: async (messageId: number, newText: string): Promise<void> => {
      await ctx.api.editMessageText(chatId, messageId, newText);
    },
    sendDocument: async (
      filePath: string,
      docCaption?: string,
    ): Promise<void> => {
      await ctx.replyWithDocument(new InputFile(filePath), {
        caption: docCaption ? markdownToHtml(docCaption) : undefined,
        parse_mode: docCaption ? 'HTML' : undefined,
      });
    },
  };
}

/**
 * Wrap a handler with session acquisition, typing indicator, and cleanup.
 */
async function withSession(
  sessionManager: SessionManager,
  ctx: Context,
  defaultOptions: SessionOptions,
  handler: (session: DaemonSession, channelReply: ChannelReply) => Promise<void>,
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  let session;
  try {
    session = await sessionManager.getOrCreate(chatId, defaultOptions);
  } catch (e) {
    logger.error(`Failed to create session for chat ${chatId}: ${e}`);
    await ctx.reply(`Failed to initialize session: ${e}`);
    return;
  }

  if (session.busy) {
    await ctx.reply(
      'Still processing your previous message. Use /cancel to abort it.',
    );
    return;
  }

  session.busy = true;

  session.typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, TYPING_KEEPALIVE_MS);
  ctx.replyWithChatAction('typing').catch(() => {});

  const typingTtl = setTimeout(() => {
    logger.warn(
      `Chat ${chatId}: typing TTL exceeded (${TYPING_TTL_MS}ms), auto-clearing`,
    );
    if (session.typingInterval) {
      clearInterval(session.typingInterval);
      session.typingInterval = undefined;
    }
  }, TYPING_TTL_MS);

  try {
    await handler(session, buildChannelReply(ctx, chatId));
  } catch (e) {
    logger.error(`Error in handler for chat ${chatId}: ${e}`);
    try {
      await ctx.reply(
        `Error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } catch {
      // ignore reply failures
    }
  } finally {
    clearTimeout(typingTtl);
    if (session.typingInterval) {
      clearInterval(session.typingInterval);
      session.typingInterval = undefined;
    }
    session.busy = false;
  }
}

/**
 * Download a file from Telegram with retry + exponential backoff.
 * Uses ctx.api.token instead of env var so --token flag works.
 */
async function downloadTelegramFile(
  ctx: Context,
  fileId: string,
): Promise<string> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error('Telegram file_path not found.');
  }

  const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= DOWNLOAD_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const tempDir = path.join(os.tmpdir(), 'gemini-cli-telegram-media');
      await fs.mkdir(tempDir, { recursive: true });

      // Use unique filename to avoid collisions from concurrent downloads
      const ext = path.extname(file.file_path) || '';
      const localFilePath = path.join(
        tempDir,
        `${crypto.randomUUID()}${ext}`,
      );

      const arrayBuffer = await response.arrayBuffer();
      await fs.writeFile(localFilePath, Buffer.from(arrayBuffer));

      return localFilePath;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < DOWNLOAD_MAX_RETRIES) {
        const delay = DOWNLOAD_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn(
          `File download attempt ${attempt} failed: ${lastError.message}. Retrying in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw new Error(
    `Failed to download file after ${DOWNLOAD_MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}

/** Supported Telegram media types for extraction. */
type TelegramMediaType = 'photo' | 'voice' | 'audio' | 'video' | 'document';

/** Extracted info from a Telegram media message. */
interface TelegramMediaInfo {
  fileId: string;
  mimeType: string;
  caption?: string;
  fileName?: string;
}

/**
 * Extract file ID, MIME type, and optional file name from a Telegram media message.
 */
function extractMediaInfo(
  ctx: Context,
  mediaType: TelegramMediaType,
): TelegramMediaInfo | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = ctx.message as any;
  if (!msg) return undefined;
  const caption = msg.caption as string | undefined;

  if (mediaType === 'photo') {
    const photos = msg.photo as { file_id: string }[] | undefined;
    if (!photos || photos.length === 0) return undefined;
    const photo = photos[photos.length - 1];
    if (!photo) return undefined;
    return { fileId: photo.file_id, mimeType: 'image/jpeg', caption };
  } else if (mediaType === 'voice') {
    const voice = msg.voice as { file_id: string; mime_type?: string } | undefined;
    if (!voice) return undefined;
    return { fileId: voice.file_id, mimeType: voice.mime_type || 'audio/ogg', caption };
  } else if (mediaType === 'audio') {
    const audio = msg.audio as { file_id: string; mime_type?: string; file_name?: string } | undefined;
    if (!audio) return undefined;
    return { fileId: audio.file_id, mimeType: audio.mime_type || 'audio/mpeg', caption, fileName: audio.file_name };
  } else if (mediaType === 'video') {
    const video = msg.video as { file_id: string; mime_type?: string; file_name?: string } | undefined;
    if (!video) return undefined;
    return { fileId: video.file_id, mimeType: video.mime_type || 'video/mp4', caption, fileName: video.file_name };
  } else if (mediaType === 'document') {
    const doc = msg.document as { file_id: string; mime_type?: string; file_name?: string } | undefined;
    if (!doc) return undefined;
    return { fileId: doc.file_id, mimeType: doc.mime_type || 'application/octet-stream', caption, fileName: doc.file_name };
  }
  return undefined;
}

export class TelegramBot {
  private bot: Bot;
  private runner: ReturnType<typeof run> | undefined;
  private sessionManager: SessionManager;
  private defaultOptions: SessionOptions;

  constructor(token: string, options: TelegramBotOptions = {}) {
    this.bot = new Bot(token);
    this.sessionManager = new SessionManager(
      (chatId) => createTelegramSendMedia(this.bot.api, chatId),
    );
    this.defaultOptions = {
      cwd: options.cwd || process.cwd(),
      model: options.model,
    };

    this.setupMiddleware(options.allowedUsers);
    registerCommands(this.bot, this.sessionManager, this.defaultOptions);
    this.setupMessageHandler();
  }

  async start(): Promise<void> {
    logger.info('Starting Telegram bot...');

    await this.bot.api.setMyCommands([
      { command: 'new', description: 'Start a fresh session' },
      { command: 'cancel', description: 'Cancel current operation' },
      { command: 'resume', description: 'List or resume a previous session' },
      { command: 'model', description: 'Switch model (starts new session)' },
      { command: 'compact', description: 'Compress chat history' },
      { command: 'addfolder', description: 'Add a folder for read+write access' },
      { command: 'stats', description: 'Show session statistics' },
      { command: 'id', description: 'Show current session ID' },
      { command: 'help', description: 'Show help message' },
    ]);

    logger.info('Telegram bot started. Listening for messages...');

    // Use @grammyjs/runner for concurrent update processing.
    // This allows /cancel to run even while a message handler is busy.
    this.runner = run(this.bot, {
      runner: {
        fetch: { timeout: 30 },
        silent: true,
      },
    });

    // runner.task() resolves when the runner stops (via runner.stop())
    await this.runner.task();
  }

  async stop(): Promise<void> {
    logger.info('Stopping Telegram bot...');
    await this.sessionManager.destroyAll();
    if (this.runner?.isRunning()) {
      this.runner.stop();
    }
    logger.info('Telegram bot stopped.');
  }

  private setupMiddleware(allowedUsers?: number[]): void {
    // Sequentialize: messages in the same chat run serially,
    // but /cancel gets its own key so it bypasses the queue.
    this.bot.use(sequentialize(getSequentialKey));

    if (allowedUsers && allowedUsers.length > 0) {
      const allowedSet = new Set(allowedUsers);
      this.bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId || !allowedSet.has(userId)) {
          logger.warn(`Unauthorized access attempt from user ${userId}`);
          await ctx.reply(
            'Unauthorized. Your user ID is not in the allowed list.',
          );
          return;
        }
        await next();
      });
      logger.info(
        `Access restricted to ${allowedUsers.length} user(s): ${allowedUsers.join(', ')}`,
      );
    } else {
      logger.warn(
        'No allowed users configured. Bot is accessible to everyone.',
      );
    }
  }

  private setupMessageHandler(): void {
    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text;
      if (text.startsWith('/')) return;

      await withSession(
        this.sessionManager,
        ctx,
        this.defaultOptions,
        async (session, channelReply) => {
          await processMessage(
            session,
            { text },
            channelReply,
            telegramFormatter,
          );
        },
      );
    });

    this.bot.on('message:photo', async (ctx) => {
      await this.handleMediaMessage(ctx, 'photo');
    });

    this.bot.on('message:voice', async (ctx) => {
      await this.handleMediaMessage(ctx, 'voice');
    });

    this.bot.on('message:audio', async (ctx) => {
      await this.handleMediaMessage(ctx, 'audio');
    });

    this.bot.on('message:video', async (ctx) => {
      await this.handleMediaMessage(ctx, 'video');
    });

    this.bot.on('message:document', async (ctx) => {
      await this.handleMediaMessage(ctx, 'document');
    });

    this.bot.catch((err) => {
      logger.error(`Bot error: ${err.message}`);
    });
  }

  private async handleMediaMessage(
    ctx: Context,
    mediaType: TelegramMediaType,
  ): Promise<void> {
    const info = extractMediaInfo(ctx, mediaType);
    if (!info) {
      await ctx.reply(`Could not retrieve ${mediaType} file info.`);
      return;
    }

    let tempFilePath: string | undefined;

    await withSession(
      this.sessionManager,
      ctx,
      this.defaultOptions,
      async (session, channelReply) => {
        tempFilePath = await downloadTelegramFile(ctx, info.fileId);

        const multimodalInput: MultimodalInput = {
          text: info.caption,
          media: [
            {
              type: mediaType,
              path: tempFilePath,
              mimeType: info.mimeType,
              fileName: info.fileName,
            },
          ],
        };

        try {
          await processMessage(
            session,
            multimodalInput,
            channelReply,
            telegramFormatter,
          );
        } finally {
          if (tempFilePath) {
            await fs
              .unlink(tempFilePath)
              .catch((e) =>
                logger.warn(`Failed to delete temp file: ${e}`),
              );
          }
        }
      },
    );
  }
}
