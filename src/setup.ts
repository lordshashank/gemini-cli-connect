/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as readline from 'node:readline';
import { runAuthProbe } from './index.js';
import {
  saveApiKey,
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
import {
  saveUserConfig,
  loadUserConfig,
  configExists,
  CONFIG_PATH,
  type UserConfig,
} from './config/userConfig.js';

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

export type SetupStep = 'token' | 'users' | 'model' | 'auth';

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function validateBotToken(token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; result?: { username?: string } };
    return data.ok ? (data.result?.username ?? null) : null;
  } catch {
    return null;
  }
}

async function setupToken(rl: readline.Interface): Promise<string> {
  console.log('Telegram Bot Token');
  console.log('  1. Open Telegram and search for @BotFather');
  console.log('  2. Send /newbot and follow the prompts to create a bot');
  console.log('  3. Copy the token BotFather gives you\n');

  while (true) {
    const token = await ask(rl, 'Bot token: ');
    if (!token) {
      console.log('Token is required.\n');
      continue;
    }
    console.log('Validating...');
    const username = await validateBotToken(token);
    if (username) {
      console.log(`Verified: @${username}\n`);
      return token;
    }
    console.log('Invalid token or network error. Try again.\n');
  }
}

async function setupUsers(rl: readline.Interface): Promise<number[]> {
  console.log('Allowed Users');
  console.log('  1. Open Telegram and search for @userinfobot');
  console.log('  2. Send /start — it will reply with your user ID');
  console.log('  3. Repeat for any other users you want to allow\n');

  while (true) {
    const input = await ask(rl, 'User IDs (comma-separated): ');
    const users = input
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);
    if (users.length > 0) {
      console.log(`Allowed users: ${users.join(', ')}\n`);
      return users;
    }
    console.log('At least one valid user ID is required.\n');
  }
}

async function setupModel(rl: readline.Interface): Promise<string | undefined> {
  console.log('Default Model');
  console.log('  Override the model used for Telegram sessions.\n');

  console.log('  0. Use Gemini CLI default (skip)');
  for (let i = 0; i < AVAILABLE_MODELS.length; i++) {
    const m = AVAILABLE_MODELS[i]!;
    const display = getDisplayString(m);
    const label = display !== m ? `${m} — ${display}` : m;
    console.log(`  ${i + 1}. ${label}`);
  }
  console.log();

  while (true) {
    const input = await ask(rl, 'Choose a model [0]: ');
    if (!input || input === '0') {
      return undefined;
    }
    const num = parseInt(input, 10);
    if (num >= 1 && num <= AVAILABLE_MODELS.length) {
      const model = AVAILABLE_MODELS[num - 1];
      console.log(`Selected: ${model}\n`);
      return model;
    }
    if (input && isNaN(num)) {
      console.log(`Selected: ${input}\n`);
      return input;
    }
    console.log('Invalid choice. Try again.\n');
  }
}

/**
 * Run the auth step. Accepts the readline interface so it can be closed
 * before triggering OAuth (which needs its own stdin access).
 * Returns a new readline interface if one was closed and reopened.
 */
async function setupAuth(rl: readline.Interface): Promise<readline.Interface> {
  console.log('Gemini Authentication');
  console.log('  Checking existing credentials...');

  // Close readline before probing — the probe may trigger a consent
  // prompt via its own readline, which conflicts with ours.
  rl.close();

  // Try existing auth silently — if it works, skip.
  try {
    await runAuthProbe();
    console.log('  Authenticated. Skipping.\n');
    return readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  } catch {
    // Auth not configured — ask user to set it up.
  }

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('  Choose how to authenticate:');
  console.log('  (1) OAuth — opens your browser to sign in with Google');
  console.log('  (2) API Key — paste a key or set GEMINI_API_KEY env var\n');

  const authChoice = await ask(rl, 'Auth method [1]: ');

  if (authChoice === '2') {
    console.log('  Get a key from https://aistudio.google.com/apikey\n');
    console.log('  You can either paste it here to save it securely,');
    console.log('  or set GEMINI_API_KEY in your environment and press Enter to skip.\n');
    const key = await ask(rl, 'Gemini API key (or Enter to skip): ');
    if (key) {
      await saveApiKey(key);
      console.log('API key saved.\n');
    } else {
      console.log('Skipped. Make sure GEMINI_API_KEY is set in your environment.\n');
    }
    return rl;
  }

  // OAuth: close readline so the auth probe can use stdin exclusively.
  rl.close();

  console.log('  Opening browser for Google sign-in...\n');
  try {
    await runAuthProbe();
    console.log('OAuth authentication complete.\n');
  } catch (e) {
    console.log(`OAuth failed: ${e instanceof Error ? e.message : String(e)}`);
    console.log('You can retry with: gemini-cli-connect setup auth\n');
  }

  // Reopen readline for any remaining steps.
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Run the setup wizard.
 * If `only` is specified, only that step runs and the rest is preserved from existing config.
 * If `only` is undefined, runs all steps (full setup).
 */
export async function runSetup(only?: SetupStep): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('gemini-cli-connect setup\n');

  const existing = loadUserConfig();

  // Full setup: confirm overwrite if config exists
  if (!only && configExists()) {
    const overwrite = await ask(rl, 'Config already exists. Overwrite? [y/N]: ');
    if (!['y', 'yes'].includes(overwrite.toLowerCase())) {
      console.log('Setup cancelled.');
      rl.close();
      return;
    }
    console.log();
  }

  // Single step with no existing config for required fields
  if (only && !existing && only !== 'auth') {
    console.log('No existing config. Run full setup first: gemini-cli-connect setup');
    rl.close();
    return;
  }

  if (only === 'auth') {
    const finalRl = await setupAuth(rl);
    finalRl.close();
    return;
  }

  let currentRl = rl;

  const token = only === 'token' || !only
    ? await setupToken(currentRl)
    : existing!.telegramBotToken;

  const allowedUsers = only === 'users' || !only
    ? await setupUsers(currentRl)
    : existing!.allowedUsers;

  const model = only === 'model' || !only
    ? await setupModel(currentRl)
    : existing?.model;

  if (!only) {
    currentRl = await setupAuth(currentRl);
  }

  const config: UserConfig = {
    telegramBotToken: token,
    allowedUsers,
    ...(model && { model }),
  };

  saveUserConfig(config);
  currentRl.close();

  console.log(`Config saved to ${CONFIG_PATH}`);
}
