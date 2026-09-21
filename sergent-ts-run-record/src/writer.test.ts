import { Buffer } from "node:buffer";

import { describe, expect, test } from "bun:test";

import type { FileAdapter } from "./writer.js";
import { RunRecordWriter } from "./writer.js";

/** Creates a recording adapter with an optional short-write bound. */
function recordingAdapter(maximumWrite: number = Number.POSITIVE_INFINITY) {
  const state = {
    openCalls: 0,
    writeCalls: 0,
    fsyncCalls: 0,
    closeCalls: 0,
    flags: "",
    mode: 0,
    text: "",
  };
  const adapter: FileAdapter = {
    open: (_path, flags, mode): number => {
      state.openCalls += 1;
      state.flags = flags;
      state.mode = mode;
      return 7;
    },
    write: (_descriptor, bytes, offset, length): number => {
      state.writeCalls += 1;
      const accepted = Math.min(length, maximumWrite);
      state.text += Buffer.from(bytes.slice(offset, offset + accepted)).toString("ascii");
      return accepted;
    },
    fsync: (): void => {
      state.fsyncCalls += 1;
    },
    close: (): void => {
      state.closeCalls += 1;
    },
  };
  return { adapter, state };
}

describe("RunRecordWriter", () => {
  test("completes short writes and fsyncs before a write returns", () => {
    const { adapter, state } = recordingAdapter(3);
    const writer = new RunRecordWriter("unused.jsonl", adapter);

    writer.write({ value: "complete" });

    expect(state).toMatchObject({
      openCalls: 1,
      flags: "wx",
      mode: 0o600,
      fsyncCalls: 1,
      closeCalls: 0,
      text: '{"value":"complete"}\n',
    });
    expect(state.writeCalls).toBeGreaterThan(1);
  });

  test("permanently disables after the first I/O failure", () => {
    const firstFailure = new Error("disk failed");
    let writeCalls = 0;
    let closeCalls = 0;
    const adapter: FileAdapter = {
      open: (): number => 8,
      write: (): never => {
        writeCalls += 1;
        throw firstFailure;
      },
      fsync: (): void => undefined,
      close: (): void => {
        closeCalls += 1;
      },
    };
    const writer = new RunRecordWriter("unused.jsonl", adapter);

    expect(() => writer.write({ first: true })).toThrow("disk failed");
    try {
      writer.write({ second: true });
      throw new Error("Expected disabled writer failure");
    } catch (reason) {
      if (!(reason instanceof Error)) throw reason;
      expect(reason.cause).toBe(firstFailure);
    }
    writer.close();

    expect(writeCalls).toBe(1);
    expect(closeCalls).toBe(1);
  });

  test("healthy close fsyncs once and is idempotent", () => {
    const { adapter, state } = recordingAdapter();
    const writer = new RunRecordWriter("unused.jsonl", adapter);

    writer.close();
    writer.close();

    expect(state.fsyncCalls).toBe(1);
    expect(state.closeCalls).toBe(1);
  });
});
