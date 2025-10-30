/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@qwen-code/qwen-code-core';
import { runStreamJsonSession } from './session.js';
import { StreamJsonController } from './controller.js';
import { StreamJsonWriter } from './writer.js';
import type { LoadedSettings } from '../config/settings.js';

vi.mock('../nonInteractiveCli.js', () => ({
  runNonInteractive: vi.fn().mockResolvedValue(undefined),
}));

function createConfig(): Config {
  return {
    getIncludePartialMessages: () => false,
    getSessionId: () => 'session-test',
    getModel: () => 'model-test',
  } as unknown as Config;
}

describe('runStreamJsonSession', () => {
  let settings: LoadedSettings;

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    settings = {} as LoadedSettings;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates incoming control requests to the controller', async () => {
    const controllerPrototype = StreamJsonController.prototype as unknown as {
      handleIncomingControlRequest: (...args: unknown[]) => unknown;
    };
    const handleSpy = vi.spyOn(
      controllerPrototype,
      'handleIncomingControlRequest',
    );

    const inputStream = new PassThrough();
    const config = createConfig();

    const controlRequest = {
      type: 'control_request',
      request_id: 'req-1',
      request: { subtype: 'initialize' },
    };

    inputStream.end(`${JSON.stringify(controlRequest)}\n`);

    await runStreamJsonSession(config, settings, undefined, {
      input: inputStream,
      writer: new StreamJsonWriter(config, false),
    });

    expect(handleSpy).toHaveBeenCalledTimes(1);
    const firstCall = handleSpy.mock.calls[0] as unknown[] | undefined;
    expect(firstCall?.[1]).toMatchObject(controlRequest);
  });
});
