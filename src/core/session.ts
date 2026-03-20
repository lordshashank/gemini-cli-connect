/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { Scheduler, ROOT_SCHEDULER_ID } from '@google/gemini-cli-core';
import {
  loadDaemonConfig,
  type DaemonConfigOptions,
} from '../config/config.js';
import { logger } from '../utils/logger.js';
import type { DaemonSession, SessionOptions, SendMediaFn } from './types.js';
import { SendMediaTool } from '../tools/send-media.js';

export type SendMediaFactory = (chatId: number) => SendMediaFn;

/**
 * Channel-agnostic session manager.
 * Maps a channel-specific chat identifier (number) to a DaemonSession.
 */
export class SessionManager {
  private sessions: Map<number, DaemonSession> = new Map();
  private sendMediaFactory?: SendMediaFactory;

  constructor(sendMediaFactory?: SendMediaFactory) {
    this.sendMediaFactory = sendMediaFactory;
  }

  async getOrCreate(
    chatId: number,
    options: SessionOptions,
  ): Promise<DaemonSession> {
    const existing = this.sessions.get(chatId);
    if (existing) {
      logger.debug(`Reusing existing session ${existing.sessionId} for chat ${chatId}`);
      return existing;
    }
    logger.debug(`No existing session for chat ${chatId}, creating new one`);
    return this.createSession(chatId, options);
  }

  async reset(
    chatId: number,
    options: SessionOptions,
  ): Promise<DaemonSession> {
    await this.destroy(chatId);
    return this.createSession(chatId, options);
  }

  async destroy(chatId: number): Promise<void> {
    const session = this.sessions.get(chatId);
    if (session) {
      session.abortController.abort();
      try {
        await session.config.dispose();
      } catch (e) {
        logger.warn(`Error disposing session for chat ${chatId}: ${e}`);
      }
      this.sessions.delete(chatId);
      logger.info(`Session destroyed for chat ${chatId}`);
    }
  }

  async destroyAll(): Promise<void> {
    const chatIds = Array.from(this.sessions.keys());
    for (const chatId of chatIds) {
      await this.destroy(chatId);
    }
    logger.info('All sessions destroyed');
  }

  getSession(chatId: number): DaemonSession | undefined {
    return this.sessions.get(chatId);
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  private async createSession(
    chatId: number,
    options: SessionOptions,
  ): Promise<DaemonSession> {
    const sessionId = crypto.randomUUID();
    logger.info(`Creating session ${sessionId} for chat ${chatId}`);

    const configOptions: DaemonConfigOptions = {
      cwd: options.cwd,
      model: options.model,
    };

    logger.debug(`Loading daemon config for session ${sessionId}...`);
    const config = await loadDaemonConfig(sessionId, configOptions);
    logger.debug(`Config loaded. Model: ${config.getModel()}`);

    // Allow read access to the user's home directory so the daemon can
    // browse and reference files (write access stays scoped to cwd).
    const workspace = config.getWorkspaceContext();
    workspace.addReadOnlyPath(os.homedir());

    const geminiClient = config.getGeminiClient();
    logger.debug('Initializing Gemini client...');
    await geminiClient.initialize();
    logger.debug('Gemini client initialized');

    const scheduler = new Scheduler({
      config: config,
      messageBus: config.getMessageBus(),
      getPreferredEditor: () => undefined,
      schedulerId: ROOT_SCHEDULER_ID,
    });

    // Register daemon-specific tools
    const sendMedia = this.sendMediaFactory?.(chatId);
    if (sendMedia) {
      const sendMediaTool = new SendMediaTool(
        config.getMessageBus(),
        sendMedia,
      );
      config.getToolRegistry().registerTool(sendMediaTool);
      logger.debug('Registered send_media tool');
    }

    const session: DaemonSession = {
      sessionId,
      config,
      geminiClient,
      scheduler,
      abortController: new AbortController(),
      busy: false,
      turnCount: 0,
      createdAt: new Date(),
      sendMedia,
    };

    this.sessions.set(chatId, session);
    logger.info(`Session ${sessionId} created for chat ${chatId}`);

    return session;
  }
}
