/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import readline from 'node:readline';
import {
  TelegramBot,
  type TelegramBotOptions,
} from './channels/telegram/bot.js';
import { coreEvents, CoreEvent } from '@google/gemini-cli-core';
import { loadDaemonConfig } from './config/config.js';
import { logger } from './utils/logger.js';

export type { ChannelReply, DaemonSession, SessionOptions, MessageFormatter } from './core/types.js';
export { SessionManager } from './core/session.js';
export { processMessage } from './core/messageLoop.js';
export { listAvailableSessions, resumeSession } from './core/resume.js';

export interface DaemonOptions extends TelegramBotOptions {
  token: string;
}

/**
 * Register a ConsentRequest listener so the core library's OAuth flow
 * can prompt the user for consent on stdin (instead of throwing
 * FatalAuthenticationError when no listener is registered).
 */
function registerConsentHandler(): void {
  coreEvents.on(CoreEvent.ConsentRequest, (payload) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${payload.prompt} [Y/n]: `, (answer) => {
      rl.close();
      payload.onConfirm(['y', ''].includes(answer.trim().toLowerCase()));
    });
  });
}

export async function startTelegramDaemon(
  options: DaemonOptions,
): Promise<void> {
  if (!options.token) {
    throw new Error(
      'Telegram bot token is required. Set TELEGRAM_BOT_TOKEN or pass --token.',
    );
  }

  // Allow the core library's OAuth flow to prompt for consent on stdin.
  registerConsentHandler();

  // Validate Gemini auth before starting the bot.
  // Creates a throwaway config to trigger the auth flow — if OAuth tokens
  // are missing or the API key is invalid, this fails fast instead of
  // silently accepting messages we can't handle.
  logger.info('Validating Gemini authentication...');
  const probeConfig = await loadDaemonConfig('auth-probe', {
    cwd: options.cwd || process.cwd(),
    model: options.model,
  });
  await probeConfig.dispose();
  logger.info('Gemini authentication validated.');

  const bot = new TelegramBot(options.token, options);

  const shutdown = async () => {
    logger.info('Shutting down...');
    await bot.stop();
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  await bot.start();
}
