/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';

import {
  AuthType,
  Config,
  FileDiscoveryService,
  ApprovalMode,
  PolicyDecision,
  loadServerHierarchicalMemory,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
  startupProfiler,
  PREVIEW_GEMINI_MODEL_AUTO,
  GEMINI_MODEL_ALIAS_AUTO,
  GitService,
  fetchAdminControlsOnce,
  getCodeAssistServer,
  ExperimentFlags,
  FatalAuthenticationError,
  isCloudShell,
  isHeadlessMode,
  ASK_USER_TOOL_NAME,
  SimpleExtensionLoader,
  setGeminiMdFilename,
  type TelemetryTarget,
  type ConfigParameters,
  type ExtensionLoader,
} from '@google/gemini-cli-core';

import { logger } from '../utils/logger.js';
import { loadSettings } from './settings.js';
import { loadExtensions } from './extension.js';

export interface DaemonConfigOptions {
  cwd?: string;
  model?: string;
}

export async function loadDaemonConfig(
  sessionId: string,
  options: DaemonConfigOptions = {},
): Promise<Config> {
  const workspaceDir = options.cwd || process.cwd();

  const settings = loadSettings(workspaceDir);
  const extensions = loadExtensions(workspaceDir);
  const extensionLoader: ExtensionLoader = new SimpleExtensionLoader(
    extensions,
  );

  const adcFilePath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];

  const folderTrust =
    settings.folderTrust === true ||
    process.env['GEMINI_FOLDER_TRUST'] === 'true';

  let checkpointing = process.env['CHECKPOINTING']
    ? process.env['CHECKPOINTING'] === 'true'
    : settings.checkpointing?.enabled;

  if (checkpointing) {
    if (!(await GitService.verifyGitAvailability())) {
      logger.warn(
        'Checkpointing is enabled but git is not installed. Disabling checkpointing.',
      );
      checkpointing = false;
    }
  }

  // Compute excludeTools: always exclude ASK_USER in daemon mode
  const excludeTools = [
    ...(settings.excludeTools || settings.tools?.exclude || []),
    ASK_USER_TOOL_NAME,
  ];

  const defaultModel = PREVIEW_GEMINI_MODEL_AUTO;
  const specifiedModel =
    options.model || process.env['GEMINI_MODEL'] || settings.model?.name;
  const resolvedModel =
    specifiedModel === GEMINI_MODEL_ALIAS_AUTO
      ? defaultModel
      : specifiedModel || defaultModel;

  // Set the context filename BEFORE loading memory so it picks up AGENTS.md etc.
  // Default to both GEMINI.md and AGENTS.md so either convention works.
  if (settings.context?.fileName) {
    setGeminiMdFilename(settings.context.fileName);
  } else {
    setGeminiMdFilename(['GEMINI.md', 'AGENTS.md']);
  }

  const configParams: ConfigParameters = {
    sessionId,
    model: resolvedModel,
    embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
    sandbox: undefined,
    targetDir: workspaceDir,
    debugMode: process.env['DEBUG'] === 'true' || false,
    question: '',

    coreTools: settings.coreTools || settings.tools?.core || undefined,
    excludeTools,
    allowedTools: settings.allowedTools || settings.tools?.allowed || undefined,
    showMemoryUsage: settings.showMemoryUsage || false,
    maxSessionTurns: settings.model?.maxSessionTurns,
    summarizeToolOutput: settings.model?.summarizeToolOutput,
    compressionThreshold: settings.model?.compressionThreshold,
    toolDiscoveryCommand: settings.tools?.discoveryCommand,
    toolCallCommand: settings.tools?.callCommand,
    contextFileName: settings.context?.fileName,
    // Always YOLO in daemon mode — tools auto-execute, no user confirmation
    approvalMode: ApprovalMode.YOLO,
    policyEngineConfig: {
      defaultDecision: PolicyDecision.ALLOW,
    },
    mcpServers: settings.mcpServers,
    cwd: workspaceDir,
    telemetry: {
      enabled: settings.telemetry?.enabled,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      target: settings.telemetry?.target as TelemetryTarget,
      otlpEndpoint:
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ??
        settings.telemetry?.otlpEndpoint,
      logPrompts: settings.telemetry?.logPrompts,
    },
    fileFiltering: {
      respectGitIgnore: settings.fileFiltering?.respectGitIgnore,
      respectGeminiIgnore: settings.fileFiltering?.respectGeminiIgnore,
      enableRecursiveFileSearch:
        settings.fileFiltering?.enableRecursiveFileSearch,
      customIgnoreFilePaths: [
        ...(settings.fileFiltering?.customIgnoreFilePaths || []),
        ...(process.env['CUSTOM_IGNORE_FILE_PATHS']
          ? process.env['CUSTOM_IGNORE_FILE_PATHS'].split(path.delimiter)
          : []),
      ],
    },
    ideMode: false,
    folderTrust,
    trustedFolder: true,
    extensionLoader,
    checkpointing,
    // interactive: true so the system prompt includes YOLO autonomous mode
    // instructions. The user IS interactive (via Telegram), just not a TTY.
    interactive: true,
    enableInteractiveShell: false,
    ptyInfo: 'auto',
  };

  const fileService = new FileDiscoveryService(workspaceDir, {
    respectGitIgnore: configParams?.fileFiltering?.respectGitIgnore,
    respectGeminiIgnore: configParams?.fileFiltering?.respectGeminiIgnore,
    customIgnoreFilePaths: configParams?.fileFiltering?.customIgnoreFilePaths,
  });

  const memoryImportFormat = settings.context?.importFormat || 'tree';
  const memoryFileFiltering = {
    ...DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
    ...settings.context?.fileFiltering,
  };
  const includeDirectories =
    settings.context?.loadMemoryFromIncludeDirectories
      ? (settings.context?.includeDirectories || []).map((d) =>
          path.resolve(workspaceDir, d),
        )
      : [];

  const { memoryContent, fileCount, filePaths } =
    await loadServerHierarchicalMemory(
      workspaceDir,
      includeDirectories,
      fileService,
      extensionLoader,
      folderTrust,
      memoryImportFormat,
      memoryFileFiltering,
      settings.context?.discoveryMaxDirs,
    );
  configParams.userMemory = memoryContent;
  configParams.geminiMdFileCount = fileCount;
  configParams.geminiMdFilePaths = filePaths;

  const initialConfig = new Config({
    ...configParams,
  });

  const codeAssistServer = getCodeAssistServer(initialConfig);

  const adminControlsEnabled =
    initialConfig.getExperiments()?.flags[ExperimentFlags.ENABLE_ADMIN_CONTROLS]
      ?.boolValue ?? false;

  const finalConfigParams = { ...configParams };
  if (adminControlsEnabled) {
    const adminSettings = await fetchAdminControlsOnce(
      codeAssistServer,
      adminControlsEnabled,
    );

    if (Object.keys(adminSettings).length !== 0) {
      finalConfigParams.disableYoloMode = !adminSettings.strictModeDisabled;
      finalConfigParams.mcpEnabled = adminSettings.mcpSetting?.mcpEnabled;
      finalConfigParams.extensionsEnabled =
        adminSettings.cliFeatureSetting?.extensionsSetting?.extensionsEnabled;
    }
  }

  const config = new Config(finalConfigParams);

  await config.initialize();
  await config.waitForMcpInit();
  startupProfiler.flush(config);

  await refreshAuthentication(config, adcFilePath);

  return config;
}

async function refreshAuthentication(
  config: Config,
  adcFilePath: string | undefined,
): Promise<void> {
  if (process.env['USE_CCPA']) {
    logger.info('Using CCPA Auth');
    try {
      if (adcFilePath) {
        path.resolve(adcFilePath);
      }
    } catch (e) {
      logger.error(
        `USE_CCPA env var is true but unable to resolve GOOGLE_APPLICATION_CREDENTIALS file path ${adcFilePath}. Error ${e}`,
      );
    }

    const useComputeAdc = process.env['GEMINI_CLI_USE_COMPUTE_ADC'] === 'true';
    const isHeadless = isHeadlessMode();
    const shouldSkipOauth = isHeadless || useComputeAdc;

    if (shouldSkipOauth) {
      if (isCloudShell() || useComputeAdc) {
        logger.info(
          `Skipping LOGIN_WITH_GOOGLE due to ${isHeadless ? 'headless mode' : 'GEMINI_CLI_USE_COMPUTE_ADC'}. Attempting COMPUTE_ADC.`,
        );
        try {
          await config.refreshAuth(AuthType.COMPUTE_ADC);
          logger.info('COMPUTE_ADC successful.');
        } catch (adcError) {
          const adcMessage =
            adcError instanceof Error ? adcError.message : String(adcError);
          throw new FatalAuthenticationError(
            `COMPUTE_ADC failed: ${adcMessage}. (Skipped LOGIN_WITH_GOOGLE due to ${isHeadless ? 'headless mode' : 'GEMINI_CLI_USE_COMPUTE_ADC'})`,
          );
        }
      } else {
        throw new FatalAuthenticationError(
          'Interactive terminal required for LOGIN_WITH_GOOGLE. Run in an interactive terminal or set GEMINI_CLI_USE_COMPUTE_ADC=true to use Application Default Credentials.',
        );
      }
    } else {
      try {
        await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
      } catch (e) {
        if (
          e instanceof FatalAuthenticationError &&
          (isCloudShell() || useComputeAdc)
        ) {
          logger.warn(
            'LOGIN_WITH_GOOGLE failed. Attempting COMPUTE_ADC fallback.',
          );
          try {
            await config.refreshAuth(AuthType.COMPUTE_ADC);
            logger.info('COMPUTE_ADC fallback successful.');
          } catch (adcError) {
            logger.error(`COMPUTE_ADC fallback failed: ${adcError}`);
            const originalMessage = e instanceof Error ? e.message : String(e);
            const adcMessage =
              adcError instanceof Error ? adcError.message : String(adcError);
            throw new FatalAuthenticationError(
              `${originalMessage}. Fallback to COMPUTE_ADC also failed: ${adcMessage}`,
            );
          }
        } else {
          throw e;
        }
      }
    }
    logger.info(
      `GOOGLE_CLOUD_PROJECT: ${process.env['GOOGLE_CLOUD_PROJECT']}`,
    );
  } else if (process.env['GEMINI_API_KEY']) {
    logger.info('Using Gemini API Key');
    await config.refreshAuth(AuthType.USE_GEMINI);
  } else if (process.env['GOOGLE_GENAI_USE_GCA'] === 'true') {
    logger.info('Using Login with Google (OAuth)');
    await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
  } else {
    // No explicit auth configured — fall back to OAuth (Login with Google)
    logger.info('No GEMINI_API_KEY or USE_CCPA set. Falling back to Login with Google (OAuth).');
    await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
  }
}
