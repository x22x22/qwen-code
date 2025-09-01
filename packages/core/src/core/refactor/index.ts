/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../contentGenerator.js';
import { Config } from '../../config/config.js';
import { OpenAIContentGenerator } from './openaiContentGenerator.js';
import {
  DashScopeOpenAICompatibleProvider,
  OpenRouterOpenAICompatibleProvider,
  type OpenAICompatibleProvider,
  DefaultOpenAICompatibleProvider,
} from './provider/index.js';

// Main classes
export { OpenAIContentGenerator } from './openaiContentGenerator.js';
export { ContentGenerationPipeline, type PipelineConfig } from './pipeline.js';

// Providers
export {
  type OpenAICompatibleProvider,
  DashScopeOpenAICompatibleProvider,
  OpenRouterOpenAICompatibleProvider,
} from './provider/index.js';

// Utilities
export { Converter } from './converter.js';
export { StreamingManager } from './streamingManager.js';

// Factory utility functions
/**
 * Create an OpenAI-compatible content generator with the appropriate provider
 */
export function createContentGenerator(
  contentGeneratorConfig: ContentGeneratorConfig,
  cliConfig: Config,
): ContentGenerator {
  const provider = determineProvider(contentGeneratorConfig, cliConfig);
  return new OpenAIContentGenerator(
    contentGeneratorConfig,
    cliConfig,
    provider,
  );
}

/**
 * Determine the appropriate provider based on configuration
 */
export function determineProvider(
  contentGeneratorConfig: ContentGeneratorConfig,
  cliConfig: Config,
): OpenAICompatibleProvider {
  const config =
    contentGeneratorConfig || cliConfig.getContentGeneratorConfig();

  // Check for DashScope provider
  if (DashScopeOpenAICompatibleProvider.isDashScopeProvider(config)) {
    return new DashScopeOpenAICompatibleProvider(
      contentGeneratorConfig,
      cliConfig,
    );
  }

  // Check for OpenRouter provider
  if (OpenRouterOpenAICompatibleProvider.isOpenRouterProvider(config)) {
    return new OpenRouterOpenAICompatibleProvider(
      contentGeneratorConfig,
      cliConfig,
    );
  }

  // Default provider for standard OpenAI-compatible APIs
  return new DefaultOpenAICompatibleProvider(contentGeneratorConfig, cliConfig);
}

// Services
export {
  type TelemetryService,
  type RequestContext,
  DefaultTelemetryService,
} from './telemetryService.js';

export { type ErrorHandler, EnhancedErrorHandler } from './errorHandler.js';
