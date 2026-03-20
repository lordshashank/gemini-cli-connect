/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const levels = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof levels)[number];

function isLogLevel(value: string): value is LogLevel {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return levels.includes(value as LogLevel);
}

const envLevel = process.env['LOG_LEVEL'] || 'info';
const currentLevel: LogLevel = isLogLevel(envLevel) ? envLevel : 'info';
const currentLevelIndex = levels.indexOf(currentLevel);

function formatTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (levels.indexOf(level) < currentLevelIndex) {
    return;
  }
  const prefix = `[${level.toUpperCase()}] ${formatTimestamp()} --`;
  const line =
    args.length > 0
      ? `${prefix} ${message} ${args.map((a) => String(a)).join(' ')}`
      : `${prefix} ${message}`;
  process.stderr.write(line + '\n');
}

export const logger = {
  debug: (message: string, ...args: unknown[]) =>
    log('debug', message, ...args),
  info: (message: string, ...args: unknown[]) =>
    log('info', message, ...args),
  warn: (message: string, ...args: unknown[]) =>
    log('warn', message, ...args),
  error: (message: string, ...args: unknown[]) =>
    log('error', message, ...args),
};
