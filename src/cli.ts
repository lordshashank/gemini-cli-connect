#!/usr/bin/env node

/**
 * gemini-cli-connect — Connect Gemini CLI to messaging platforms.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { runSetup, type SetupStep } from './setup.js';
import {
  loadUserConfig,
  configExists,
  CONFIG_DIR,
  PID_PATH,
  LOG_PATH,
} from './config/userConfig.js';
import { startTelegramDaemon } from './index.js';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'setup') {
  const VALID_STEPS: SetupStep[] = ['token', 'users', 'model', 'auth'];
  const step = args[1] as SetupStep | undefined;
  if (step && !VALID_STEPS.includes(step)) {
    console.log(`Unknown setup step: ${step}`);
    console.log(`Valid steps: ${VALID_STEPS.join(', ')}`);
    process.exit(1);
  }
  await runSetup(step);
  process.exit(0);
}

if (command === 'stop') {
  if (!fs.existsSync(PID_PATH)) {
    console.log('No running daemon found.');
    process.exit(0);
  }
  const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 'SIGTERM');
    fs.unlinkSync(PID_PATH);
    console.log(`Daemon (pid ${pid}) stopped.`);
  } catch {
    fs.unlinkSync(PID_PATH);
    console.log('Daemon was not running. Cleaned up stale pid file.');
  }
  process.exit(0);
}

if (command === 'status') {
  if (!fs.existsSync(PID_PATH)) {
    console.log('Daemon is not running.');
    process.exit(0);
  }
  const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 0); // signal 0 = check if alive
    console.log(`Daemon is running (pid ${pid}).`);
  } catch {
    fs.unlinkSync(PID_PATH);
    console.log('Daemon is not running (cleaned up stale pid file).');
  }
  process.exit(0);
}

if (command === 'logs') {
  if (!fs.existsSync(LOG_PATH)) {
    console.log('No log file found.');
    process.exit(0);
  }
  // Tail the last 50 lines
  const content = fs.readFileSync(LOG_PATH, 'utf-8');
  const lines = content.split('\n');
  const tail = lines.slice(-50).join('\n');
  console.log(tail);
  process.exit(0);
}

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`gemini-cli-connect — Connect Gemini CLI to Telegram

Usage:
  gemini-cli-connect                  Start daemon in background (default)
  gemini-cli-connect --foreground     Start daemon in foreground
  gemini-cli-connect stop             Stop the background daemon
  gemini-cli-connect status           Check if daemon is running
  gemini-cli-connect logs             Show recent daemon logs
  gemini-cli-connect setup            Run the full setup wizard
  gemini-cli-connect setup token      Change bot token only
  gemini-cli-connect setup users      Change allowed users only
  gemini-cli-connect setup model      Change default model only
  gemini-cli-connect setup auth       Set up Gemini authentication
  gemini-cli-connect help             Show this help message`);
  process.exit(0);
}

// --- Ensure config exists ---

if (!configExists()) {
  console.log('No configuration found. Running setup...\n');
  await runSetup();
  console.log();
}

const config = loadUserConfig();
if (!config) {
  console.error('Failed to load config. Run: gemini-cli-connect setup');
  process.exit(1);
}

// --- Foreground mode: run directly ---

const isForeground =
  args.includes('--foreground') ||
  args.includes('-f') ||
  process.env['_GEMINI_CLI_CONNECT_DAEMON'] === '1';

if (isForeground) {
  // Write PID file for status/stop commands
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(PID_PATH, process.pid.toString());

  const cleanup = () => {
    try { fs.unlinkSync(PID_PATH); } catch { /* ignore */ }
  };
  process.once('exit', cleanup);
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });
  process.once('SIGINT', () => { cleanup(); process.exit(0); });

  await startTelegramDaemon({
    token: config.telegramBotToken,
    model: config.model,
    allowedUsers: config.allowedUsers,
    cwd: process.cwd(),
  });

  process.exit(0);
}

// --- Background mode (default): spawn detached child ---

if (fs.existsSync(PID_PATH)) {
  const existingPid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10);
  try {
    process.kill(existingPid, 0);
    console.log(`Daemon is already running (pid ${existingPid}). Use 'gemini-cli-connect stop' first.`);
    process.exit(1);
  } catch {
    // Stale pid file, continue
  }
}

fs.mkdirSync(CONFIG_DIR, { recursive: true });
const logFd = fs.openSync(LOG_PATH, 'a');

const scriptPath = path.resolve(
  new URL(import.meta.url).pathname,
);

const child = spawn(process.execPath, [scriptPath, '--foreground'], {
  detached: true,
  stdio: ['ignore', logFd, logFd],
  env: {
    ...process.env,
    _GEMINI_CLI_CONNECT_DAEMON: '1',
  },
  cwd: process.cwd(),
});

child.unref();
fs.closeSync(logFd);

console.log(`Daemon started in background (pid ${child.pid}).`);
console.log(`Logs: ${LOG_PATH}`);
console.log(`Stop:  gemini-cli-connect stop`);
