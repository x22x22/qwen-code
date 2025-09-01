/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import OpenAI from 'openai';
import { GenerateContentResponse, Part, FinishReason } from '@google/genai';
import { Converter } from './converter.js';

export interface ToolCallAccumulator {
  id?: string;
  name?: string;
  arguments: string;
}

export class StreamingManager {
  private toolCallAccumulator = new Map<number, ToolCallAccumulator>();

  constructor(private converter: Converter) {}

  async *processStream(
    stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
  ): AsyncGenerator<GenerateContentResponse> {
    // Reset the accumulator for each new stream
    this.toolCallAccumulator.clear();

    for await (const chunk of stream) {
      const response = this.converter.convertOpenAIChunkToGemini(chunk);

      // Ignore empty responses, which would cause problems with downstream code
      // that expects a valid response.
      if (
        response.candidates?.[0]?.content?.parts?.length === 0 &&
        !response.usageMetadata
      ) {
        continue;
      }

      yield response;
    }
  }

  /**
   * Combine streaming responses for logging purposes
   */
  combineStreamResponsesForLogging(
    responses: GenerateContentResponse[],
    model: string,
  ): GenerateContentResponse {
    if (responses.length === 0) {
      return new GenerateContentResponse();
    }

    const lastResponse = responses[responses.length - 1];

    // Find the last response with usage metadata
    const finalUsageMetadata = responses
      .slice()
      .reverse()
      .find((r) => r.usageMetadata)?.usageMetadata;

    // Combine all text content from the stream
    const combinedParts: Part[] = [];
    let combinedText = '';
    const functionCalls: Part[] = [];

    for (const response of responses) {
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if ('text' in part && part.text) {
            combinedText += part.text;
          } else if ('functionCall' in part && part.functionCall) {
            functionCalls.push(part);
          }
        }
      }
    }

    // Add combined text if any
    if (combinedText) {
      combinedParts.push({ text: combinedText });
    }

    // Add function calls
    combinedParts.push(...functionCalls);

    // Create combined response
    const combinedResponse = new GenerateContentResponse();
    combinedResponse.candidates = [
      {
        content: {
          parts: combinedParts,
          role: 'model' as const,
        },
        finishReason:
          responses[responses.length - 1]?.candidates?.[0]?.finishReason ||
          FinishReason.FINISH_REASON_UNSPECIFIED,
        index: 0,
        safetyRatings: [],
      },
    ];
    combinedResponse.responseId = lastResponse?.responseId;
    combinedResponse.createTime = lastResponse?.createTime;
    combinedResponse.modelVersion = model;
    combinedResponse.promptFeedback = { safetyRatings: [] };
    combinedResponse.usageMetadata = finalUsageMetadata;

    return combinedResponse;
  }
}
