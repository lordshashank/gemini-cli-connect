/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processMessage } from './messageLoop.js';
import type { MultimodalInput } from './types.js';
import { GeminiEventType } from '@google/gemini-cli-core';
import * as fs from 'fs/promises';

vi.mock('fs/promises');

describe('processMessage', () => {
  let mockSession: any;
  let mockReply: any;
  let mockFormatter: any;
  let mockGeminiClient: any;

  beforeEach(() => {
    vi.resetAllMocks();

    mockGeminiClient = {
      sendMessageStream: vi.fn(),
      getChat: vi.fn().mockReturnValue({
        recordCompletedToolCalls: vi.fn(),
      }),
      getCurrentSequenceModel: vi.fn(),
    };

    mockSession = {
      sessionId: 'test-session',
      geminiClient: mockGeminiClient,
      scheduler: {
        schedule: vi.fn(),
      },
      abortController: new AbortController(),
      config: {
        getModel: vi.fn().mockReturnValue('test-model'),
      },
      turnCount: 0,
    };

    mockReply = {
      send: vi.fn().mockResolvedValue(123),
      edit: vi.fn(),
      sendDocument: vi.fn(),
    };

    mockFormatter = {
      chunkText: vi.fn((text) => [text]),
      truncateForEdit: vi.fn((text) => text),
    };
  });

  it('should process text-only input', async () => {
    const input: MultimodalInput = { text: 'hello' };
    
    mockGeminiClient.sendMessageStream.mockReturnValue((async function* () {
      yield { type: GeminiEventType.Content, value: 'Hi there!' };
    })());

    await processMessage(mockSession, input, mockReply, mockFormatter);

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      expect.arrayContaining([{ text: 'hello' }]),
      expect.any(AbortSignal),
      'daemon-test-session',
      undefined,
      false,
      input
    );
    expect(mockReply.send).toHaveBeenCalledWith('Hi there!');
  });

  it('should process multimodal input with images', async () => {
    const input: MultimodalInput = {
      text: 'What is this?',
      media: [{ type: 'photo', path: 'test.jpg', mimeType: 'image/jpeg' }]
    };

    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('fake-image-data'));

    mockGeminiClient.sendMessageStream.mockReturnValue((async function* () {
      yield { type: GeminiEventType.Content, value: 'It is a test image.' };
    })());

    await processMessage(mockSession, input, mockReply, mockFormatter);

    expect(fs.readFile).toHaveBeenCalledWith('test.jpg');
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      expect.arrayContaining([
        { text: 'What is this?' },
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: Buffer.from('fake-image-data').toString('base64'),
          }
        }
      ]),
      expect.any(AbortSignal),
      'daemon-test-session',
      undefined,
      false,
      input
    );
    expect(mockReply.send).toHaveBeenCalledWith('It is a test image.');
  });

  it('should process multimodal input with audio', async () => {
    const input: MultimodalInput = {
      media: [{ type: 'voice', path: 'test.ogg', mimeType: 'audio/ogg' }]
    };

    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('fake-audio-data'));

    mockGeminiClient.sendMessageStream.mockReturnValue((async function* () {
      yield { type: GeminiEventType.Content, value: 'I heard some audio.' };
    })());

    await processMessage(mockSession, input, mockReply, mockFormatter);

    expect(fs.readFile).toHaveBeenCalledWith('test.ogg');
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          inlineData: {
            mimeType: 'audio/ogg',
            data: Buffer.from('fake-audio-data').toString('base64'),
          }
        }
      ]),
      expect.any(AbortSignal),
      'daemon-test-session',
      undefined,
      false,
      input
    );
    expect(mockReply.send).toHaveBeenCalledWith('I heard some audio.');
  });

  it('should handle file read errors gracefully', async () => {
    const input: MultimodalInput = {
      media: [{ type: 'photo', path: 'invalid.jpg', mimeType: 'image/jpeg' }]
    };

    vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

    mockGeminiClient.sendMessageStream.mockReturnValue((async function* () {
      yield { type: GeminiEventType.Content, value: 'I see nothing.' };
    })());

    await processMessage(mockSession, input, mockReply, mockFormatter);

    expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('Failed to process media file'));
    // It should still continue with the parts it has (which might be empty if only one part failed)
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalled();
  });
});
