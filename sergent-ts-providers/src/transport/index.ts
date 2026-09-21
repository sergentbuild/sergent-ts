/**
 * Provider-neutral client setup, boundary narrowing, in-call retry, cancellation,
 * timeout, timing, strict parse, and outcome evidence construction.
 */
export {
  isExternalObject,
  isTokenCount,
  reportedTokenCounts,
  sdkSchemaRecord,
} from "./boundary.js";
export type { ExternalObject } from "./boundary.js";
export { createTransportClient, executeTransport, startTransportCall } from "./transport.js";
export type {
  NativeAdmission,
  NativeResponseEvidence,
} from "./types.js";
