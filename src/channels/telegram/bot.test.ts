/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramBot } from './bot.js';
import { processMessage } from '../../core/messageLoop.js';
import * as fs from 'fs/promises';

const mockBot = {
  use: vi.fn(),
  on: vi.fn(),
  command: vi.fn(),
  api: {
    setMyCommands: vi.fn().mockResolvedValue(true),
    getFile: vi.fn().mockResolvedValue({ file_path: 'fake/path.jpg' }),
  },
  catch: vi.fn(),
};

vi.mock('grammy', () => {
  return {
    Bot: vi.fn(() => mockBot),
  };
});

vi.mock('@grammyjs/runner', () => ({
  run: vi.fn(),
  sequentialize: vi.fn(),
}));

vi.mock('../../core/messageLoop.js');
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../utils/logger.js');

describe('TelegramBot', () => {
  let botInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TELEGRAM_BOT_TOKEN'] = 'fake-token';
    botInstance = new TelegramBot('fake-token');
  });

  it('should register handlers for photo, voice, and audio', () => {
    const registeredEvents = mockBot.on.mock.calls.map((call: any) => call[0]);
    expect(registeredEvents).toContain('message:text');
    expect(registeredEvents).toContain('message:photo');
    expect(registeredEvents).toContain('message:voice');
    expect(registeredEvents).toContain('message:audio');
  });

  it('should handle photo messages', async () => {
    const photoHandlerCall = mockBot.on.mock.calls.find((call: any) => call[0] === 'message:photo');
    expect(photoHandlerCall).toBeDefined();
    const photoHandler = photoHandlerCall![1];
    
    const mockCtx = {
      chat: { id: 123 },
      message: { 
        photo: [{ file_id: 'photo-id-1' }, { file_id: 'photo-id-2' }],
        caption: 'look at this'
      },
      reply: vi.fn().mockResolvedValue({ message_id: 456 }),
      replyWithChatAction: vi.fn().mockResolvedValue(true),
      api: mockBot.api,
      session: { busy: false },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
    });

    vi.spyOn(botInstance.sessionManager, 'getOrCreate').mockResolvedValue(mockCtx.session);

    await photoHandler(mockCtx);

    expect(mockBot.api.getFile).toHaveBeenCalledWith('photo-id-2');
    expect(fs.writeFile).toHaveBeenCalled();
    expect(processMessage).toHaveBeenCalledWith(
      mockCtx.session,
      expect.objectContaining({
        text: 'look at this',
        media: [expect.objectContaining({ type: 'photo' })]
      }),
      expect.any(Object),
      expect.any(Object)
    );
    expect(fs.unlink).toHaveBeenCalled();
  });

  it('should handle voice messages', async () => {
    const voiceHandlerCall = mockBot.on.mock.calls.find((call: any) => call[0] === 'message:voice');
    expect(voiceHandlerCall).toBeDefined();
    const voiceHandler = voiceHandlerCall![1];
    
    const mockCtx = {
      chat: { id: 123 },
      message: { 
        voice: { file_id: 'voice-id', mime_type: 'audio/ogg' },
      },
      reply: vi.fn().mockResolvedValue({ message_id: 456 }),
      replyWithChatAction: vi.fn().mockResolvedValue(true),
      api: mockBot.api,
      session: { busy: false },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
    });

    vi.spyOn(botInstance.sessionManager, 'getOrCreate').mockResolvedValue(mockCtx.session);

    await voiceHandler(mockCtx);

    expect(mockBot.api.getFile).toHaveBeenCalledWith('voice-id');
    expect(processMessage).toHaveBeenCalledWith(
      mockCtx.session,
      expect.objectContaining({
        media: [expect.objectContaining({ type: 'audio', mimeType: 'audio/ogg' })]
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });
});
