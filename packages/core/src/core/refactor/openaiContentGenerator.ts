import { ContentGenerator } from '../contentGenerator.js';
import { Config } from '../../config/config.js';
import { type OpenAICompatibleProvider } from './provider/index.js';
import {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import { ContentGenerationPipeline, PipelineConfig } from './pipeline.js';
import { DefaultTelemetryService } from './telemetryService.js';
import { EnhancedErrorHandler } from './errorHandler.js';
import { ContentGeneratorConfig } from '../contentGenerator.js';

export class OpenAIContentGenerator implements ContentGenerator {
  protected pipeline: ContentGenerationPipeline;

  constructor(
    contentGeneratorConfig: ContentGeneratorConfig,
    cliConfig: Config,
    provider: OpenAICompatibleProvider,
  ) {
    // Create pipeline configuration
    const pipelineConfig: PipelineConfig = {
      cliConfig,
      provider,
      contentGeneratorConfig,
      telemetryService: new DefaultTelemetryService(
        cliConfig,
        contentGeneratorConfig.enableOpenAILogging,
      ),
      errorHandler: new EnhancedErrorHandler(
        (error: unknown, request: GenerateContentParameters) =>
          this.shouldSuppressErrorLogging(error, request),
      ),
    };

    this.pipeline = new ContentGenerationPipeline(pipelineConfig);
  }

  /**
   * Hook for subclasses to customize error handling behavior
   * @param error The error that occurred
   * @param request The original request
   * @returns true if error logging should be suppressed, false otherwise
   */
  protected shouldSuppressErrorLogging(
    _error: unknown,
    _request: GenerateContentParameters,
  ): boolean {
    return false; // Default behavior: never suppress error logging
  }

  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    return this.pipeline.execute(request, userPromptId);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return this.pipeline.executeStream(request, userPromptId);
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    return this.pipeline.countTokens(request);
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    return this.pipeline.embedContent(request);
  }
}
