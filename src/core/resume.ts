/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  SESSION_FILE_PREFIX,
  convertSessionToClientHistory,
  partListUnionToString,
  type ConversationRecord,
  type ResumedSessionData,
  type Config,
} from '@google/gemini-cli-core';
import { logger } from '../utils/logger.js';
import type { DaemonSession } from './types.js';

export interface SessionListEntry {
  index: number;
  id: string;
  fileName: string;
  title: string;
  messageCount: number;
  lastUpdated: string;
  relativeTime: string;
}

/**
 * List available sessions from the chats directory.
 */
export async function listAvailableSessions(
  config: Config,
): Promise<SessionListEntry[]> {
  const chatsDir = path.join(
    config.storage.getProjectTempDir(),
    'chats',
  );

  let files: string[];
  try {
    files = await fs.readdir(chatsDir);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return [];
    }
    throw e;
  }

  const sessionFiles = files
    .filter((f) => f.startsWith(SESSION_FILE_PREFIX) && f.endsWith('.json'))
    .sort();

  const entries: SessionListEntry[] = [];

  for (const fileName of sessionFiles) {
    try {
      const raw = await fs.readFile(path.join(chatsDir, fileName), 'utf8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const record: ConversationRecord = JSON.parse(raw);

      if (
        !record.sessionId ||
        !record.messages ||
        !Array.isArray(record.messages) ||
        !record.startTime ||
        !record.lastUpdated
      ) {
        continue;
      }

      // Skip empty sessions and subagent sessions
      const hasContent = record.messages.some(
        (m) => m.type === 'user' || m.type === 'gemini',
      );
      if (!hasContent || record.kind === 'subagent') {
        continue;
      }

      // Extract first user message as title
      const userMsg = record.messages.find((m) => {
        if (m.type !== 'user') return false;
        const text = partListUnionToString(m.content);
        return !text.startsWith('/') && text.trim().length > 0;
      });
      const title = userMsg
        ? partListUnionToString(userMsg.content)
            .replace(/\n+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 80)
        : record.summary || 'Empty conversation';

      entries.push({
        index: 0, // set after sorting
        id: record.sessionId,
        fileName,
        title,
        messageCount: record.messages.length,
        lastUpdated: record.lastUpdated,
        relativeTime: formatRelativeTime(record.lastUpdated),
      });
    } catch {
      // Skip corrupted files
    }
  }

  // Deduplicate by session ID (keep most recent)
  const deduped = new Map<string, SessionListEntry>();
  for (const entry of entries) {
    const existing = deduped.get(entry.id);
    if (
      !existing ||
      new Date(entry.lastUpdated) > new Date(existing.lastUpdated)
    ) {
      deduped.set(entry.id, entry);
    }
  }

  // Sort oldest first, assign 1-based indices
  const sorted = Array.from(deduped.values()).sort(
    (a, b) =>
      new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime(),
  );
  sorted.forEach((entry, i) => {
    entry.index = i + 1;
  });

  return sorted;
}

/**
 * Resume a session by index or UUID into the given DaemonSession.
 * Loads the conversation history into the GeminiClient.
 */
export async function resumeSession(
  session: DaemonSession,
  identifier: string,
): Promise<string> {
  const { config, geminiClient } = session;
  const sessions = await listAvailableSessions(config);

  if (sessions.length === 0) {
    throw new Error('No sessions found to resume.');
  }

  let target: SessionListEntry | undefined;

  if (identifier === 'latest' || identifier === '') {
    target = sessions[sessions.length - 1];
  } else {
    // Try UUID first
    target = sessions.find((s) => s.id === identifier);
    if (!target) {
      // Try index
      const idx = parseInt(identifier, 10);
      if (!isNaN(idx) && idx > 0 && idx <= sessions.length) {
        target = sessions[idx - 1];
      }
    }
  }

  if (!target) {
    throw new Error(
      `Session "${identifier}" not found. Use /resume to list sessions.`,
    );
  }

  // Load the full session data
  const chatsDir = path.join(
    config.storage.getProjectTempDir(),
    'chats',
  );
  const sessionPath = path.join(chatsDir, target.fileName);
  const raw = await fs.readFile(sessionPath, 'utf8');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const record: ConversationRecord = JSON.parse(raw);

  const resumedData: ResumedSessionData = {
    conversation: record,
    filePath: sessionPath,
  };

  // Restore chat history
  const history = convertSessionToClientHistory(record.messages);
  await geminiClient.resumeChat(history, resumedData);

  // Update session ID to match the resumed session
  config.setSessionId(record.sessionId);
  session.sessionId = record.sessionId;

  logger.info(
    `Resumed session ${target.index}: "${target.title}" (${target.messageCount} messages)`,
  );

  return `Resumed session ${target.index}: ${target.title} (${target.messageCount} messages, ${target.relativeTime})`;
}

function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const time = new Date(timestamp);
  const diffMs = now.getTime() - time.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}
