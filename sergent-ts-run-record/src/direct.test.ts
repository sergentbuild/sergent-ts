import { describe, expect, test } from "bun:test";

import { directValue } from "./direct.js";

describe("direct event conversion", () => {
  test("converts temporal, binary, exception, and unsupported native values", () => {
    const payload = {
      when: new Date("2026-09-01T02:03:04.005Z"),
      binary: new Uint8Array([1, 2, 3]),
      failure: new TypeError("bad input"),
      unsupported: new Set([1, 2]),
    };

    expect(directValue(payload)).toEqual({
      when: "2026-09-01T02:03:04.005Z",
      binary: "AQID",
      failure: { type: "TypeError", message: "bad input" },
      unsupported: { type: "Set", repr: "[object Set]" },
    });
  });

  test("rejects cycles and non-finite values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => directValue(cyclic)).toThrow("cycle");
    expect(() => directValue({ value: Number.NaN })).toThrow("finite");
  });

  test("bounds exception and fallback text while retaining ordinary application text", () => {
    const character = String.fromCodePoint(0x1f600);
    const text = character.repeat(2050);
    const unsupported = new Set([1]);
    unsupported.toString = (): string => text;

    expect(directValue({ failure: new Error(text), unsupported, text })).toEqual({
      failure: { type: "Error", message: character.repeat(2048) },
      unsupported: { type: "Set", repr: character.repeat(2048) },
      text,
    });
  });

  test("preserves own enumerable prototype-named fields", () => {
    const payload: Record<string, unknown> = {};
    Object.defineProperty(payload, "__proto__", {
      value: Object.freeze({ kept: true }),
      enumerable: true,
    });
    const projected = directValue(payload);
    if (typeof projected !== "object" || projected === null || Array.isArray(projected)) {
      throw new Error("Expected an object projection");
    }
    expect(Object.hasOwn(projected, "__proto__")).toBe(true);
    expect(Reflect.get(projected, "__proto__")).toEqual({ kept: true });
  });
});
