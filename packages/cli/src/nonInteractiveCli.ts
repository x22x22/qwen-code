/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, ToolCallRequestInfo } from '@qwen-code/qwen-code-core';
import {
  executeToolCall,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  parseAndFormatApiError,
  FatalInputError,
  FatalTurnLimitedError,
} from '@qwen-code/qwen-code-core';
import type { Content, Part } from '@google/genai';

import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';
import { StreamJsonWriter } from './streamJson/writer.js';

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
): Promise<void> {
  const consolePatcher = new ConsolePatcher({
    stderr: true,
    debugMode: config.getDebugMode(),
  });

  const isStreamJsonOutput = config.getOutputFormat() === 'stream-json';
  const streamJsonWriter = isStreamJsonOutput
    ? new StreamJsonWriter(config, config.getIncludePartialMessages())
    : undefined;
  const startTime = Date.now();
  let turnCount = 0;

  try {
    consolePatcher.patch();
    // Handle EPIPE errors when the output is piped to a command that closes early.
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Exit gracefully if the pipe is closed.
        process.exit(0);
      }
    });

    const geminiClient = config.getGeminiClient();

    const abortController = new AbortController();

    const { processedQuery, shouldProceed } = await handleAtCommand({
      query: input,
      config,
      addItem: (_item, _timestamp) => 0,
      onDebugMessage: () => {},
      messageId: Date.now(),
      signal: abortController.signal,
    });

    if (!shouldProceed || !processedQuery) {
      // An error occurred during @include processing (e.g., file not found).
      // The error message is already logged by handleAtCommand.
      throw new FatalInputError(
        'Exiting due to an error processing the @ command.',
      );
    }

    const initialParts = processedQuery as Part[];
    let currentMessages: Content[] = [{ role: 'user', parts: initialParts }];

    if (isStreamJsonOutput) {
      streamJsonWriter?.emitUserMessageFromParts(initialParts);
    }

    while (true) {
      turnCount++;
      if (
        config.getMaxSessionTurns() >= 0 &&
        turnCount > config.getMaxSessionTurns()
      ) {
        throw new FatalTurnLimitedError(
          'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
        );
      }
      const toolCallRequests: ToolCallRequestInfo[] = [];

      const responseStream = geminiClient.sendMessageStream(
        currentMessages[0]?.parts || [],
        abortController.signal,
        prompt_id,
      );

      const assistantBuilder = streamJsonWriter?.createAssistantBuilder();

      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        if (event.type === GeminiEventType.Content) {
          if (isStreamJsonOutput) {
            assistantBuilder?.appendText(event.value);
          } else {
            process.stdout.write(event.value);
          }
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          toolCallRequests.push(event.value);
          if (isStreamJsonOutput) {
            assistantBuilder?.appendToolUse(event.value);
          }
        }
      }

      assistantBuilder?.finalize();

      if (toolCallRequests.length > 0) {
        const toolResponseParts: Part[] = [];
        for (const requestInfo of toolCallRequests) {
          const toolResponse = await executeToolCall(
            config,
            requestInfo,
            abortController.signal,
          );

          if (toolResponse.error) {
            const message =
              toolResponse.resultDisplay || toolResponse.error.message;
            console.error(
              `Error executing tool ${requestInfo.name}: ${message}`,
            );
            if (isStreamJsonOutput) {
              streamJsonWriter?.emitSystemMessage('tool_error', {
                tool: requestInfo.name,
                message,
              });
            }
          }

          if (isStreamJsonOutput) {
            streamJsonWriter?.emitToolResult(requestInfo, toolResponse);
          }

          if (toolResponse.responseParts) {
            toolResponseParts.push(...toolResponse.responseParts);
          }
        }
        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        if (isStreamJsonOutput) {
          streamJsonWriter?.emitResult({
            isError: false,
            durationMs: Date.now() - startTime,
            numTurns: turnCount,
          });
        } else {
          process.stdout.write('\n'); // Ensure a final newline
        }
        return;
      }
    }
  } catch (error) {
    const formattedError = parseAndFormatApiError(
      error,
      config.getContentGeneratorConfig()?.authType,
    );
    console.error(formattedError);
    if (isStreamJsonOutput) {
      streamJsonWriter?.emitResult({
        isError: true,
        durationMs: Date.now() - startTime,
        numTurns: turnCount,
        errorMessage: formattedError,
      });
    }
    throw error;
  } finally {
    consolePatcher.cleanup();
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }
  }
}
