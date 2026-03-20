/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { InputFile } from 'grammy';
import type { Api } from 'grammy';
import { markdownToHtml } from './formatter.js';
import { logger } from '../../utils/logger.js';

export type MediaType =
  | 'photo'
  | 'voice'
  | 'audio'
  | 'video'
  | 'animation'
  | 'document'
  | 'auto';

export type SendMediaFn = (
  filePath: string,
  type: MediaType,
  caption?: string,
) => Promise<void>;

const EXTENSION_TO_MEDIA_TYPE: Record<string, MediaType> = {
  // Photos
  '.jpg': 'photo',
  '.jpeg': 'photo',
  '.png': 'photo',
  '.webp': 'photo',
  // Voice
  '.ogg': 'voice',
  '.opus': 'voice',
  // Audio
  '.mp3': 'audio',
  '.m4a': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  // Video
  '.mp4': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  // Animation
  '.gif': 'animation',
};

function detectMediaType(filePath: string): MediaType {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return EXTENSION_TO_MEDIA_TYPE[ext] ?? 'document';
}

/**
 * Creates a bound send function for a specific Telegram chat.
 * Uses bot.api directly (stable for session lifetime), not per-request ctx.
 */
export function createTelegramSendMedia(
  api: Api,
  chatId: number,
): SendMediaFn {
  return async (
    filePath: string,
    type: MediaType,
    caption?: string,
  ): Promise<void> => {
    const resolvedType = type === 'auto' ? detectMediaType(filePath) : type;
    const file = new InputFile(filePath);
    const opts = caption
      ? { caption: markdownToHtml(caption), parse_mode: 'HTML' as const }
      : {};

    logger.debug(
      `Sending ${resolvedType} to chat ${chatId}: ${filePath}`,
    );

    switch (resolvedType) {
      case 'photo':
        await api.sendPhoto(chatId, file, opts);
        break;
      case 'voice':
        await api.sendVoice(chatId, file, opts);
        break;
      case 'audio':
        await api.sendAudio(chatId, file, opts);
        break;
      case 'video':
        await api.sendVideo(chatId, file, opts);
        break;
      case 'animation':
        await api.sendAnimation(chatId, file, opts);
        break;
      case 'document':
      default:
        await api.sendDocument(chatId, file, opts);
        break;
    }
  };
}
