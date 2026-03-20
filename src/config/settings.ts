/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  type MCPServerConfig,
  debugLogger,
  GEMINI_DIR,
  getErrorMessage,
  type TelemetrySettings,
  homedir,
} from '@google/gemini-cli-core';
import stripJsonComments from 'strip-json-comments';

export const USER_SETTINGS_DIR = path.join(homedir(), GEMINI_DIR);
export const USER_SETTINGS_PATH = path.join(USER_SETTINGS_DIR, 'settings.json');

export interface SummarizeToolOutputSettings {
  tokenBudget?: number;
}

export interface Settings {
  model?: {
    name?: string;
    maxSessionTurns?: number;
    summarizeToolOutput?: Record<string, SummarizeToolOutputSettings>;
    compressionThreshold?: number;
  };
  context?: {
    fileName?: string | string[];
    importFormat?: 'flat' | 'tree';
    loadMemoryFromIncludeDirectories?: boolean;
    includeDirectories?: string[];
    discoveryMaxDirs?: number;
    fileFiltering?: {
      respectGitIgnore?: boolean;
      respectGeminiIgnore?: boolean;
      maxFileCount?: number;
      searchTimeout?: number;
      customIgnoreFilePaths?: string[];
    };
  };
  mcpServers?: Record<string, MCPServerConfig>;
  coreTools?: string[];
  excludeTools?: string[];
  allowedTools?: string[];
  tools?: {
    allowed?: string[];
    exclude?: string[];
    core?: string[];
    discoveryCommand?: string;
    callCommand?: string;
  };
  telemetry?: TelemetrySettings;
  showMemoryUsage?: boolean;
  checkpointing?: CheckpointingSettings;
  folderTrust?: boolean;

  fileFiltering?: {
    respectGitIgnore?: boolean;
    respectGeminiIgnore?: boolean;
    enableRecursiveFileSearch?: boolean;
    customIgnoreFilePaths?: string[];
  };
}

export interface SettingsError {
  message: string;
  path: string;
}

export interface CheckpointingSettings {
  enabled?: boolean;
}

export function loadSettings(workspaceDir: string): Settings {
  let userSettings: Settings = {};
  let workspaceSettings: Settings = {};
  const settingsErrors: SettingsError[] = [];

  try {
    if (fs.existsSync(USER_SETTINGS_PATH)) {
      const userContent = fs.readFileSync(USER_SETTINGS_PATH, 'utf-8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const parsedUserSettings = JSON.parse(
        stripJsonComments(userContent),
      ) as Settings;
      userSettings = resolveEnvVarsInObject(parsedUserSettings);
    }
  } catch (error: unknown) {
    settingsErrors.push({
      message: getErrorMessage(error),
      path: USER_SETTINGS_PATH,
    });
  }

  const workspaceSettingsPath = path.join(
    workspaceDir,
    GEMINI_DIR,
    'settings.json',
  );

  try {
    if (fs.existsSync(workspaceSettingsPath)) {
      const projectContent = fs.readFileSync(workspaceSettingsPath, 'utf-8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const parsedWorkspaceSettings = JSON.parse(
        stripJsonComments(projectContent),
      ) as Settings;
      workspaceSettings = resolveEnvVarsInObject(parsedWorkspaceSettings);
    }
  } catch (error: unknown) {
    settingsErrors.push({
      message: getErrorMessage(error),
      path: workspaceSettingsPath,
    });
  }

  if (settingsErrors.length > 0) {
    debugLogger.error('Errors loading settings:');
    for (const error of settingsErrors) {
      debugLogger.error(`  Path: ${error.path}`);
      debugLogger.error(`  Message: ${error.message}`);
    }
  }

  return {
    ...userSettings,
    ...workspaceSettings,
  };
}

function resolveEnvVarsInString(value: string): string {
  const envVarRegex = /\$(?:(\w+)|{([^}]+)})/g;
  return value.replace(envVarRegex, (match, varName1, varName2) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const varName = varName1 || varName2;
    if (process && process.env && typeof process.env[varName] === 'string') {
      return process.env[varName];
    }
    return match;
  });
}

function resolveEnvVarsInObject<T>(obj: T): T {
  if (
    obj === null ||
    obj === undefined ||
    typeof obj === 'boolean' ||
    typeof obj === 'number'
  ) {
    return obj;
  }

  if (typeof obj === 'string') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return resolveEnvVarsInString(obj) as unknown as T;
  }

  if (Array.isArray(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-unsafe-return
    return obj.map((item) => resolveEnvVarsInObject(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const newObj = { ...obj } as T;
    for (const key in newObj) {
      if (Object.prototype.hasOwnProperty.call(newObj, key)) {
        newObj[key] = resolveEnvVarsInObject(newObj[key]);
      }
    }
    return newObj;
  }

  return obj;
}
