#!/usr/bin/env python3
"""Minimal stream-json client.

Inspired by the quick_start example in
`third-party/anthropics/claude-agent-sdk-python/examples/quick_start.py`.

This is a symbolic, non-official client illustrating how to drive the Qwen
Code CLI through the stream-json protocol. It spawns the CLI as a subprocess,
sends a user message, and then issues a control_request.interrupt to close the
session.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any


CLI_COMMAND = os.environ.get(
    "QWEN_STREAM_JSON_COMMAND",
    "npx tsx packages/cli/index.ts --input-format stream-json --output-format stream-json",
).split()


async def main() -> None:
    process = await asyncio.create_subprocess_exec(
        *CLI_COMMAND,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    assert process.stdin is not None
    assert process.stdout is not None

    async def send(payload: dict[str, Any]) -> None:
        line = json.dumps(payload, ensure_ascii=False)
        print("------")
        print(f"[client] {line}")
        process.stdin.write((line + "\n").encode("utf-8"))
        await process.stdin.drain()

    async def read_stdout() -> None:
        while True:
            raw = await process.stdout.readline()
            if not raw:
                break
            decoded = raw.decode("utf-8").rstrip()
            print("------")
            print(f"[cli] {decoded}")

    reader_task = asyncio.create_task(read_stdout())

    prompts = ["Hello", "Who are you", "List the tools you can use"]
    for prompt in prompts:
        await send({"type": "user", "message": {"content": prompt}})
    await send(
        {
            "type": "control_request",
            "request_id": "req-interrupt",
            "request": {"subtype": "interrupt"},
        }
    )

    await reader_task
    await process.wait()

    print(f"CLI exited with return code {process.returncode}")


if __name__ == "__main__":
    asyncio.run(main())
