/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@qwen-code/qwen-code-core';
import { runStreamJsonSession } from './session.js';
import type { StreamJsonWriter } from './writer.js';
import { validateNonInteractiveAuth } from '../validateNonInterActiveAuth.js';

const runNonInteractiveMock = vi.fn();
const logUserPromptMock = vi.fn();

vi.mock('../nonInteractiveCli.js', () => ({
  runNonInteractive: (...args: unknown[]) => runNonInteractiveMock(...args),
}));

vi.mock('@qwen-code/qwen-code-core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@qwen-code/qwen-code-core')>();
  return {
    ...original,
    logUserPrompt: (...args: unknown[]) => logUserPromptMock(...args),
  };
});

function createConfig(): Config {
  return {
    getIncludePartialMessages: () => false,
    getContentGeneratorConfig: () => ({ authType: 'test' }),
    getOutputFormat: () => 'stream-json',
  } as unknown as Config;
}

function createWriter() {
  return {
    emitResult: vi.fn(),
    writeEnvelope: vi.fn(),
  } as unknown as StreamJsonWriter;
}

describe('runStreamJsonSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes initial prompt before reading stream', async () => {
    const config = createConfig();
    const writer = createWriter();
    const stream = Readable.from([]);
    runNonInteractiveMock.mockResolvedValueOnce(undefined);

    await runStreamJsonSession(config, 'Hello world', {
      input: stream,
      writer,
    });

    expect(runNonInteractiveMock).toHaveBeenCalledTimes(1);
    expect(runNonInteractiveMock).toHaveBeenCalledWith(
      config,
      'Hello world',
      expect.any(String),
    );
    expect(logUserPromptMock).toHaveBeenCalledTimes(1);
  });

  it('responds to initialize control request and handles user message', async () => {
    const config = createConfig();
    const writer = createWriter();
    const lines = [
      JSON.stringify({
        type: 'control_request',
        request_id: 'req-1',
        request: { subtype: 'initialize' },
      }) + '\n',
      JSON.stringify({
        type: 'user',
        message: { content: 'Second prompt' },
      }) + '\n',
    ];
    const stream = Readable.from(lines);
    runNonInteractiveMock.mockResolvedValueOnce(undefined);

    await runStreamJsonSession(config, undefined, {
      input: stream,
      writer,
    });

    expect(writer.writeEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'control_response',
        request_id: 'req-1',
        success: true,
      }),
    );
    expect(runNonInteractiveMock).toHaveBeenCalledTimes(1);
    expect(runNonInteractiveMock).toHaveBeenCalledWith(
      config,
      'Second prompt',
      expect.any(String),
    );
  });

  it('supports multiple sequential user prompts in persistent session', async () => {
    const config = createConfig();
    const writer = createWriter();
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { content: 'first request' },
      }) + '\n',
      JSON.stringify({
        type: 'user',
        message: { content: 'second request' },
      }) + '\n',
    ];
    const stream = Readable.from(lines);
    runNonInteractiveMock.mockResolvedValue(undefined);

    await runStreamJsonSession(config, undefined, {
      input: stream,
      writer,
    });

    expect(runNonInteractiveMock).toHaveBeenCalledTimes(2);
    expect(runNonInteractiveMock.mock.calls[0][1]).toBe('first request');
    expect(runNonInteractiveMock.mock.calls[1][1]).toBe('second request');
  });

  it('honours interrupt control request and stops session', async () => {
    const config = createConfig();
    const writer = createWriter();
    const lines = [
      JSON.stringify({
        type: 'control_request',
        request_id: 'req-interrupt',
        request: { subtype: 'interrupt' },
      }) + '\n',
      JSON.stringify({
        type: 'user',
        message: { content: 'should not run' },
      }) + '\n',
    ];
    const stream = Readable.from(lines);

    await runStreamJsonSession(config, undefined, {
      input: stream,
      writer,
    });

    expect(writer.writeEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'control_response',
        request_id: 'req-interrupt',
        success: true,
      }),
    );
    expect(runNonInteractiveMock).not.toHaveBeenCalled();
  });

  it('emits error result when JSON parsing fails', async () => {
    const config = createConfig();
    const writer = createWriter();
    const stream = Readable.from(['{invalid json']);

    await runStreamJsonSession(config, undefined, {
      input: stream,
      writer,
    });

    expect(writer.emitResult).toHaveBeenCalledWith(
      expect.objectContaining({
        isError: true,
      }),
    );
    expect(runNonInteractiveMock).not.toHaveBeenCalled();
  });
});
