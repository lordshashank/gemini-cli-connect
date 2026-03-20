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
 * Safe to call multiple times — only registers once.
 */
let consentHandlerRegistered = false;
export function registerConsentHandler(): void {
  if (consentHandlerRegistered) return;
  consentHandlerRegistered = true;
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

/**
 * Suppress core library console noise.
 * Gemini CLI's TUI uses a ConsolePatcher to route these to a debug drawer.
 * We don't have a TUI, so we mute them entirely.
 * Returns a restore function to re-enable console output.
 */
function muteConsoleLogs(): () => void {
  const originalLog = console.log;
  const originalDebug = console.debug;
  const originalWarn = console.warn;

  console.debug = () => {};
  console.log = () => {};
  console.warn = () => {};

  return () => {
    console.log = originalLog;
    console.debug = originalDebug;
    console.warn = originalWarn;
  };
}

/**
 * Run the Gemini auth flow (OAuth or API key) by creating a throwaway config.
 * Call this from an interactive terminal — it may open a browser for OAuth.
 */
export async function runAuthProbe(cwd?: string, model?: string): Promise<void> {
  registerConsentHandler();
  const restoreConsole = muteConsoleLogs();
  try {
    const probeConfig = await loadDaemonConfig('auth-probe', {
      cwd: cwd || process.cwd(),
      model,
    });
    await probeConfig.dispose();
  } finally {
    restoreConsole();
  }
}

export async function startTelegramDaemon(
  options: DaemonOptions,
): Promise<void> {
  if (!options.token) {
    throw new Error(
      'Telegram bot token is required. Set TELEGRAM_BOT_TOKEN or pass --token.',
    );
  }

  muteConsoleLogs(); // permanent — daemon output goes to log file

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
