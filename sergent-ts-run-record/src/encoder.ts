import { configure } from "safe-stable-stringify";

/** Compares object keys lexicographically by Unicode code point. */
function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

/** Strict deterministic stringify configured for the portable Run Record format. */
const stringify = configure({
  bigint: false,
  strict: true,
  circularValue: TypeError,
  deterministic: compareCodePoints,
});

/** Escapes each literal non-ASCII UTF-16 code unit with lowercase hex. */
function escapeNonAscii(value: string): string {
  return value.replace(/[\u0080-\uffff]/g, (unit) => {
    const codeUnit = unit.charCodeAt(0).toString(16).padStart(4, "0");
    return `\\u${codeUnit}`;
  });
}

/** Encodes one complete canonical ASCII JSONL line in memory. */
export function encodeRunRecordLine(value: unknown): string {
  const encoded = stringify(value);
  if (encoded === undefined) throw new TypeError("Run Record line must encode as a JSON object");
  return `${escapeNonAscii(encoded)}\n`;
}
