import { describe, expect, test } from "bun:test";

import { encodeRunRecordLine } from "./encoder.js";

describe("canonical Run Record encoding", () => {
  test("sorts all keys by code point and escapes UTF-16 units in lowercase", () => {
    const emoji = String.fromCodePoint(0x1f600);
    const privateUse = String.fromCodePoint(0xe000);
    const value = {
      [emoji]: emoji,
      "2": 2,
      [privateUse]: privateUse,
      "10": 10,
      nested: { "2": "second", "10": "first" },
    };

    expect(encodeRunRecordLine(value)).toBe(
      '{"10":10,"2":2,"nested":{"10":"first","2":"second"},' +
        '"\\ue000":"\\ue000","\\ud83d\\ude00":"\\ud83d\\ude00"}\n',
    );
  });

  test("uses compact ECMAScript number rendering and one final LF", () => {
    expect(
      encodeRunRecordLine({ negativeZero: -0, small: 1e-7, threshold: 1e21, integer: 1e20 }),
    ).toBe('{"integer":100000000000000000000,"negativeZero":0,"small":1e-7,"threshold":1e+21}\n');
  });

  test("rejects non-finite numbers and cycles", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => encodeRunRecordLine({ value: Number.NaN })).toThrow();
    expect(() => encodeRunRecordLine({ value: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => encodeRunRecordLine({ value: 1n })).toThrow();
    expect(() => encodeRunRecordLine(cyclic)).toThrow();
  });
});
