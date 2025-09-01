/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../../config/config.js';
import { logApiError, logApiResponse } from '../../telemetry/loggers.js';
import { ApiErrorEvent, ApiResponseEvent } from '../../telemetry/types.js';
import { openaiLogger } from '../../utils/openaiLogger.js';
import { GenerateContentResponse } from '@google/genai';
import OpenAI from 'openai';

export interface RequestContext {
  userPromptId: string;
  model: string;
  authType: string;
  startTime: number;
  duration: number;
  isStreaming: boolean;
}

export interface TelemetryService {
  logSuccess(
    context: RequestContext,
    response: GenerateContentResponse,
    openaiRequest?: OpenAI.Chat.ChatCompletionCreateParams,
    openaiResponse?: OpenAI.Chat.ChatCompletion,
  ): Promise<void>;

  logError(
    context: RequestContext,
    error: unknown,
    openaiRequest?: OpenAI.Chat.ChatCompletionCreateParams,
  ): Promise<void>;

  logStreamingSuccess(
    context: RequestContext,
    responses: GenerateContentResponse[],
    openaiRequest?: OpenAI.Chat.ChatCompletionCreateParams,
    openaiResponse?: OpenAI.Chat.ChatCompletion,
  ): Promise<void>;
}

export class DefaultTelemetryService implements TelemetryService {
  constructor(
    private config: Config,
    private enableOpenAILogging: boolean = false,
  ) {}

  async logSuccess(
    context: RequestContext,
    response: GenerateContentResponse,
    openaiRequest?: OpenAI.Chat.ChatCompletionCreateParams,
    openaiResponse?: OpenAI.Chat.ChatCompletion,
  ): Promise<void> {
    // Log API response event for UI telemetry
    const responseEvent = new ApiResponseEvent(
      response.responseId || 'unknown',
      context.model,
      context.duration,
      context.userPromptId,
      context.authType,
      response.usageMetadata,
    );

    logApiResponse(this.config, responseEvent);

    // Log interaction if enabled
    if (this.enableOpenAILogging && openaiRequest && openaiResponse) {
      await openaiLogger.logInteraction(openaiRequest, openaiResponse);
    }
  }

  async logError(
    context: RequestContext,
    error: unknown,
    openaiRequest?: OpenAI.Chat.ChatCompletionCreateParams,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log API error event for UI telemetry
    const errorEvent = new ApiErrorEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).requestID || 'unknown',
      context.model,
      errorMessage,
      context.duration,
      context.userPromptId,
      context.authType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).code,
    );
    logApiError(this.config, errorEvent);

    // Log error interaction if enabled
    if (this.enableOpenAILogging && openaiRequest) {
      await openaiLogger.logInteraction(
        openaiRequest,
        undefined,
        error as Error,
      );
    }
  }

  async logStreamingSuccess(
    context: RequestContext,
    responses: GenerateContentResponse[],
    openaiRequest?: OpenAI.Chat.ChatCompletionCreateParams,
    openaiResponse?: OpenAI.Chat.ChatCompletion,
  ): Promise<void> {
    // Get final usage metadata from the last response that has it
    const finalUsageMetadata = responses
      .slice()
      .reverse()
      .find((r) => r.usageMetadata)?.usageMetadata;

    // Log API response event for UI telemetry
    const responseEvent = new ApiResponseEvent(
      responses[responses.length - 1]?.responseId || 'unknown',
      context.model,
      context.duration,
      context.userPromptId,
      context.authType,
      finalUsageMetadata,
    );

    logApiResponse(this.config, responseEvent);

    // Log interaction if enabled
    if (this.enableOpenAILogging && openaiRequest && openaiResponse) {
      await openaiLogger.logInteraction(openaiRequest, openaiResponse);
    }
  }
}
