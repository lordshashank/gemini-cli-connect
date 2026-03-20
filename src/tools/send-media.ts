/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from '@google/gemini-cli-core';
import type { MessageBus } from '@google/gemini-cli-core';
import * as fs from 'node:fs/promises';
import type { SendMediaFn, MediaType } from '../channels/telegram/outbound.js';

export const SEND_MEDIA_TOOL_NAME = 'send_media';

interface SendMediaParams {
  file_path: string;
  type?: MediaType;
  caption?: string;
}

const SEND_MEDIA_SCHEMA = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description:
        'Absolute path to the file on the local filesystem to send to the user.',
    },
    type: {
      type: 'string',
      description:
        'Media type. Use "auto" to detect from file extension, or specify: "photo", "document", "voice", "audio", "video", "animation". Defaults to "auto".',
    },
    caption: {
      type: 'string',
      description: 'Optional caption or description for the media.',
    },
  },
  required: ['file_path'],
};

class SendMediaInvocation extends BaseToolInvocation<
  SendMediaParams,
  ToolResult
> {
  constructor(
    params: SendMediaParams,
    messageBus: MessageBus,
    private readonly sendMedia: SendMediaFn,
    toolName?: string,
    displayName?: string,
  ) {
    super(params, messageBus, toolName, displayName);
  }

  getDescription(): string {
    return `Send media: ${this.params.file_path}`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const { file_path, type, caption } = this.params;

    try {
      await fs.access(file_path);
    } catch {
      return {
        llmContent: `File not found: ${file_path}`,
        returnDisplay: `File not found: ${file_path}`,
        error: { message: `File not found: ${file_path}` },
      };
    }

    try {
      await this.sendMedia(file_path, type ?? 'auto', caption);
      return {
        llmContent: `File sent successfully: ${file_path}`,
        returnDisplay: `File sent: ${file_path}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Failed to send file: ${msg}`,
        returnDisplay: `Failed to send file: ${msg}`,
        error: { message: msg },
      };
    }
  }
}

export class SendMediaTool extends BaseDeclarativeTool<
  SendMediaParams,
  ToolResult
> {
  constructor(
    messageBus: MessageBus,
    private readonly sendMedia: SendMediaFn,
  ) {
    super(
      SEND_MEDIA_TOOL_NAME,
      'SendMedia',
      'Send a file, image, audio, video, or voice message to the user via their messaging channel. ' +
        'Use this when the user asks you to share, send, or deliver a file. ' +
        'The file must exist on disk. Use type "auto" (default) to detect from file extension, ' +
        'or specify "photo", "document", "voice", "audio", "video", or "animation" explicitly.',
      Kind.Communicate,
      SEND_MEDIA_SCHEMA,
      messageBus,
      false, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  protected createInvocation(
    params: SendMediaParams,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ): ToolInvocation<SendMediaParams, ToolResult> {
    return new SendMediaInvocation(
      params,
      messageBus,
      this.sendMedia,
      toolName ?? this.name,
      displayName ?? this.displayName,
    );
  }
}
