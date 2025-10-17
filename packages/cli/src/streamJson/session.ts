/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import readline from 'node:readline';
import type { Config } from '@qwen-code/qwen-code-core';
import { logUserPrompt } from '@qwen-code/qwen-code-core';
import {
  parseStreamJsonEnvelope,
  type StreamJsonEnvelope,
  type StreamJsonControlRequestEnvelope,
  type StreamJsonOutputEnvelope,
  type StreamJsonUserEnvelope,
} from './types.js';
import { extractUserMessageText } from './input.js';
import { StreamJsonWriter } from './writer.js';
import { runNonInteractive } from '../nonInteractiveCli.js';

export interface StreamJsonSessionOptions {
  input?: NodeJS.ReadableStream;
  writer?: StreamJsonWriter;
}

export async function runStreamJsonSession(
  config: Config,
  initialPrompt: string | undefined,
  options: StreamJsonSessionOptions = {},
): Promise<void> {
  const inputStream = options.input ?? process.stdin;
  const writer =
    options.writer ??
    new StreamJsonWriter(config, config.getIncludePartialMessages());

  if (initialPrompt && initialPrompt.trim().length > 0) {
    await handleUserPrompt(config, writer, initialPrompt.trim());
  }

  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Number.POSITIVE_INFINITY,
    terminal: false,
  });

  try {
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      let envelope: StreamJsonEnvelope;
      try {
        envelope = parseStreamJsonEnvelope(line);
      } catch (error) {
        writer.emitResult({
          isError: true,
          numTurns: 0,
          errorMessage:
            error instanceof Error ? error.message : 'Failed to parse JSON',
        });
        continue;
      }

      switch (envelope.type) {
        case 'user':
          await handleStreamUserEnvelope(config, writer, envelope);
          break;
        case 'control_request':
          if (handleControlRequest(envelope, writer)) {
            return;
          }
          break;
        case 'control_response':
        case 'control_cancel_request':
          // No action required at the moment.
          break;
        default: {
          writer.emitResult({
            isError: true,
            numTurns: 0,
            errorMessage: `Unsupported stream-json input type: ${envelope.type}`,
          });
        }
      }
    }
  } finally {
    rl.close();
  }
}

async function handleStreamUserEnvelope(
  config: Config,
  writer: StreamJsonWriter,
  envelope: StreamJsonUserEnvelope,
): Promise<void> {
  const prompt = extractUserMessageText(envelope).trim();
  if (!prompt) {
    return;
  }
  await handleUserPrompt(config, writer, prompt);
}

async function handleUserPrompt(
  config: Config,
  writer: StreamJsonWriter,
  prompt: string,
): Promise<void> {
  const prompt_id = Math.random().toString(16).slice(2);
  logUserPrompt(config, {
    'event.name': 'user_prompt',
    'event.timestamp': new Date().toISOString(),
    prompt,
    prompt_id,
    auth_type: config.getContentGeneratorConfig()?.authType,
    prompt_length: prompt.length,
  });

  try {
    await runNonInteractive(config, prompt, prompt_id);
  } catch (error) {
    writer.emitResult({
      isError: true,
      numTurns: 1,
      errorMessage:
        error instanceof Error ? error.message : 'Failed to process prompt',
    });
  }
}

function handleControlRequest(
  envelope: StreamJsonControlRequestEnvelope,
  writer: StreamJsonWriter,
): boolean {
  const subtype = envelope.request?.subtype;
  if (subtype === 'initialize') {
    writer.writeEnvelope({
      type: 'control_response',
      request_id: envelope.request_id,
      success: true,
      response: {
        subtype,
        capabilities: {},
      },
    } satisfies StreamJsonOutputEnvelope);
    return false;
  }

  if (subtype === 'interrupt') {
    writer.writeEnvelope({
      type: 'control_response',
      request_id: envelope.request_id,
      success: true,
      response: { subtype },
    });
    return true;
  }

  writer.writeEnvelope({
    type: 'control_response',
    request_id: envelope.request_id,
    success: false,
    error: `Unsupported control_request subtype: ${subtype ?? 'unknown'}`,
  });
  return false;
}
