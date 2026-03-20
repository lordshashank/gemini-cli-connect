/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  GeminiClient,
  Scheduler,
} from '@google/gemini-cli-core';
import type { SendMediaFn } from '../channels/telegram/outbound.js';

export type { SendMediaFn, MediaType } from '../channels/telegram/outbound.js';

export interface MultimodalInput {
  text?: string;
  media?: MediaPart[];
}

export interface MediaPart {
  type: 'photo' | 'voice' | 'audio' | 'video' | 'document';
  path: string; // Local path to the downloaded file
  mimeType?: string; // Optional: detected mime type
  fileName?: string; // Original file name (for documents)
}

/**
 * Channel-agnostic reply interface.
 * Each channel (Telegram, Discord, etc.) implements this to bridge
 * the core message loop to its own messaging API.
 */
export interface ChannelReply {
  send(text: string): Promise<number>;
  edit(messageId: number, text: string): Promise<void>;
  sendPlain(text: string): Promise<number>;
  editPlain(messageId: number, text: string): Promise<void>;
  sendDocument(path: string, caption?: string): Promise<void>;
}

/**
 * Channel-agnostic session — one per conversation/chat.
 */
export interface DaemonSession {
  sessionId: string;
  config: Config;
  geminiClient: GeminiClient;
  scheduler: Scheduler;
  abortController: AbortController;
  busy: boolean;
  turnCount: number;
  createdAt: Date;
  /** Active typing indicator interval, if any. Cleared on cancel/completion. */
  typingInterval?: ReturnType<typeof setInterval>;
  /** Outbound media send function for tool-initiated file delivery. */
  sendMedia?: SendMediaFn;
}

/**
 * Options for creating a new session.
 */
export interface SessionOptions {
  cwd?: string;
  model?: string;
}

/**
 * Channel-specific formatter for message size limits.
 */
export interface MessageFormatter {
  chunkText(text: string): string[];
  truncateForEdit(text: string): string;
}
