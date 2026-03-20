/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const CONFIG_DIR = path.join(os.homedir(), '.gemini-cli-connect');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const PID_PATH = path.join(CONFIG_DIR, 'daemon.pid');
export const LOG_PATH = path.join(CONFIG_DIR, 'daemon.log');

export interface UserConfig {
  telegramBotToken: string;
  allowedUsers: number[];
  model?: string;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

export function loadUserConfig(): UserConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(content) as UserConfig;
}

export function saveUserConfig(config: UserConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const content = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(CONFIG_PATH, content, { mode: 0o600 });
}
