import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { Buffer } from "node:buffer";

import { encodeRunRecordLine } from "./encoder.js";

/** Synchronous filesystem operations owned by the Run Record writer boundary. */
export interface FileAdapter {
  /** Exclusively opens the final Run Record path. */
  open(path: string, flags: string, mode: number): number;

  /** Writes a bounded slice and reports bytes accepted. */
  write(descriptor: number, bytes: Uint8Array, offset: number, length: number): number;

  /** Synchronizes acknowledged bytes to storage. */
  fsync(descriptor: number): void;

  /** Closes the owned descriptor. */
  close(descriptor: number): void;
}

/** Native synchronous file adapter for one JavaScript isolate. */
export const NODE_FILE_ADAPTER: FileAdapter = {
  open: (path: string, flags: string, mode: number): number => openSync(path, flags, mode),
  write: (descriptor: number, bytes: Uint8Array, offset: number, length: number): number =>
    writeSync(descriptor, bytes, offset, length),
  fsync: (descriptor: number): void => fsyncSync(descriptor),
  close: (descriptor: number): void => closeSync(descriptor),
};

/** Converts an arbitrary external-system failure to a chainable Error. */
function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** Synchronous write/fsync owner with permanent disable on first I/O failure. */
export class RunRecordWriter {
  readonly #adapter: FileAdapter;
  readonly #descriptor: number;
  #state: "healthy" | "disabled" | "closed" = "healthy";
  #firstFailure: Error | null = null;

  /** Exclusively creates one owner-only final file immediately. */
  public constructor(path: string, adapter: FileAdapter = NODE_FILE_ADAPTER) {
    this.#adapter = adapter;
    this.#descriptor = adapter.open(path, "wx", 0o600);
  }

  /** Encodes before I/O, writes every byte, and fsyncs before acknowledgment. */
  public write(value: unknown): void {
    this.assertWritable();
    const line = encodeRunRecordLine(value);
    const bytes = Buffer.from(line, "ascii");
    try {
      this.writeAll(bytes);
      this.#adapter.fsync(this.#descriptor);
    } catch (reason) {
      const failure = asError(reason);
      this.disable(failure);
      throw failure;
    }
  }

  /** Rejects unavailable operations before callers perform value conversion. */
  public ensureAvailable(): void {
    this.assertWritable();
  }

  /** Synchronizes and closes a healthy file once. */
  public close(): void {
    if (this.#state !== "healthy") return;
    let failure: Error | null = null;
    try {
      this.#adapter.fsync(this.#descriptor);
    } catch (reason) {
      failure = asError(reason);
    }
    try {
      this.#adapter.close(this.#descriptor);
    } catch (reason) {
      failure ??= asError(reason);
    }
    this.#state = "closed";
    if (failure !== null) throw failure;
  }

  /** Rejects disabled and closed writes without touching the file. */
  private assertWritable(): void {
    if (this.#state === "healthy") return;
    if (this.#state === "disabled") {
      throw new Error("Run Record is unavailable after its first persistence failure", {
        cause: this.#firstFailure,
      });
    }
    throw new Error("Run Record is closed");
  }

  /** Completes short writes until the whole encoded line is accepted. */
  private writeAll(bytes: Uint8Array): void {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = this.#adapter.write(
        this.#descriptor,
        bytes,
        offset,
        bytes.byteLength - offset,
      );
      if (written <= 0) throw new Error("Run Record write made no progress");
      offset += written;
    }
  }

  /** Retains the first I/O failure and best-effort closes the descriptor. */
  private disable(failure: Error): void {
    this.#state = "disabled";
    this.#firstFailure = failure;
    try {
      this.#adapter.close(this.#descriptor);
    } catch {
      // The first persistence failure remains authoritative.
    }
  }
}
