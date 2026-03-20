/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Bot, Context } from 'grammy';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_MODEL_AUTO,
  PREVIEW_GEMINI_MODEL,
  PREVIEW_GEMINI_3_1_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  PREVIEW_GEMINI_MODEL_AUTO,
  getDisplayString,
} from '@google/gemini-cli-core';
import type { SessionManager } from '../../core/session.js';
import type { SessionOptions } from '../../core/types.js';
import { listAvailableSessions, resumeSession } from '../../core/resume.js';
import { logger } from '../../utils/logger.js';

const AVAILABLE_MODELS = [
  DEFAULT_GEMINI_MODEL_AUTO,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  PREVIEW_GEMINI_MODEL_AUTO,
  PREVIEW_GEMINI_MODEL,
  PREVIEW_GEMINI_3_1_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
];

/**
 * Register Telegram slash command handlers on the bot.
 */
export function registerCommands(
  bot: Bot,
  sessionManager: SessionManager,
  defaultOptions: SessionOptions,
): void {
  bot.command('new', async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      await sessionManager.reset(chatId, defaultOptions);
      await ctx.reply('New session started.');
    } catch (e) {
      logger.error(`Error resetting session for chat ${chatId}: ${e}`);
      await ctx.reply('Failed to start new session.');
    }
  });

  bot.command('cancel', async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const session = sessionManager.getSession(chatId);
    if (!session) {
      await ctx.reply('No active session.');
      return;
    }

    if (session.busy) {
      // Clear typing indicator immediately
      if (session.typingInterval) {
        clearInterval(session.typingInterval);
        session.typingInterval = undefined;
      }
      session.abortController.abort();
      session.abortController = new AbortController();
      session.busy = false;
      await ctx.reply('Current operation cancelled.');
    } else {
      await ctx.reply('Nothing to cancel.');
    }
  });

  bot.command('resume', async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const arg = typeof ctx.match === 'string' ? ctx.match.trim() : '';

    // Ensure we have a session (needed to access config/storage paths)
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
        'Session is busy. Use /cancel first, then /resume.',
      );
      return;
    }

    // No argument: list available sessions
    if (!arg) {
      try {
        const sessions = await listAvailableSessions(session.config);
        if (sessions.length === 0) {
          await ctx.reply('No sessions found.');
          return;
        }

        const lines = [
          'Available sessions:',
          '',
          ...sessions.slice(-15).map(
            (s) =>
              `${s.index}. ${s.title.substring(0, 60)}${s.title.length > 60 ? '...' : ''}\n   ${s.messageCount} msgs, ${s.relativeTime}`,
          ),
          '',
          'Usage: /resume <number> or /resume latest',
        ];
        await ctx.reply(lines.join('\n'));
      } catch (e) {
        logger.error(`Error listing sessions for chat ${chatId}: ${e}`);
        await ctx.reply(`Failed to list sessions: ${e}`);
      }
      return;
    }

    // Resume the specified session
    try {
      const message = await resumeSession(session, arg);
      await ctx.reply(message);
    } catch (e) {
      logger.error(`Error resuming session for chat ${chatId}: ${e}`);
      await ctx.reply(
        `Failed to resume: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  bot.command('model', async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const arg = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (!arg) {
      const session = sessionManager.getSession(chatId);
      const currentModel = session?.config.getModel() || 'unknown';

      const lines = [
        `Current model: ${currentModel}`,
        '',
        'Available models:',
        ...AVAILABLE_MODELS.map((m, i) => {
          const display = getDisplayString(m);
          const marker = m === currentModel ? ' (active)' : '';
          return display !== m
            ? `  ${i + 1}. ${m} — ${display}${marker}`
            : `  ${i + 1}. ${m}${marker}`;
        }),
        '',
        'Usage: /model <number or name>',
      ];
      await ctx.reply(lines.join('\n'));
      return;
    }

    // Resolve number to model name
    const num = parseInt(arg, 10);
    const modelName =
      !isNaN(num) && num >= 1 && num <= AVAILABLE_MODELS.length
        ? AVAILABLE_MODELS[num - 1]
        : arg;

    try {
      const session = await sessionManager.getOrCreate(chatId, defaultOptions);
      session.config.setModel(modelName, false);
      await ctx.reply(`Switched to model: ${modelName}.`);
    } catch (e) {
      logger.error(`Error switching model for chat ${chatId}: ${e}`);
      await ctx.reply(`Failed to switch model: ${e}`);
    }
  });

  bot.command('compact', async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const session = sessionManager.getSession(chatId);
    if (!session) {
      await ctx.reply('No active session.');
      return;
    }

    try {
      await session.geminiClient.tryCompressChat(
        `daemon-${session.sessionId}`,
        true,
      );
      await ctx.reply('Chat history compacted.');
    } catch (e) {
      logger.error(`Error compacting chat for chat ${chatId}: ${e}`);
      await ctx.reply(`Failed to compact: ${e}`);
    }
  });

  bot.command('stats', async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const session = sessionManager.getSession(chatId);
    if (!session) {
      await ctx.reply('No active session.');
      return;
    }

    const uptime = Math.floor(
      (Date.now() - session.createdAt.getTime()) / 1000,
    );
    const minutes = Math.floor(uptime / 60);
    const seconds = uptime % 60;

    const stats = [
      `Session: ${session.sessionId.slice(0, 8)}`,
      `Model: ${session.config.getModel()}`,
      `Turns: ${session.turnCount}`,
      `Duration: ${minutes}m ${seconds}s`,
      `Busy: ${session.busy}`,
      `Active sessions: ${sessionManager.getSessionCount()}`,
    ];

    await ctx.reply(stats.join('\n'));
  });

  bot.command('addfolder', async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const arg = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (!arg) {
      await ctx.reply('Usage: /addfolder <path>');
      return;
    }

    const session = sessionManager.getSession(chatId);
    if (!session) {
      await ctx.reply('No active session. Send a message first.');
      return;
    }

    try {
      session.config.getWorkspaceContext().addDirectory(arg);
      await ctx.reply(`Added ${arg} (read+write) to this session.`);
    } catch (e) {
      await ctx.reply(`Failed to add folder: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  bot.command('id', async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const session = sessionManager.getSession(chatId);
    if (!session) {
      await ctx.reply('No active session.');
      return;
    }

    await ctx.reply(`Session ID: ${session.sessionId}`);
  });

  bot.command('help', async (ctx: Context) => {
    const help = [
      'Gemini CLI Telegram Bot',
      '',
      'Commands:',
      '/new - Start a fresh session',
      '/cancel - Cancel current operation',
      '/resume - List sessions or resume one',
      '/model <number or name> - Switch model (starts new session)',
      '/compact - Compress chat history',
      '/addfolder <path> - Add folder for read+write access',
      '/stats - Show session statistics',
      '/id - Show current session ID',
      '/help - Show this help message',
      '',
      'Send any text message to interact with Gemini.',
    ];

    await ctx.reply(help.join('\n'));
  });
}
