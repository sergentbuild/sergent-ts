import type { JsonObject, ModelIdentity, ModelTokens, TransportError } from "sergent-ts-core";

/** Raw response facts reached after a provider returns an envelope. */
export interface NativeResponseEvidence {
  readonly rawResponse: string;
  readonly tokens: ModelTokens | null;
  readonly requestId: string | null;
}

/** A provider envelope admitted as exactly one semantic response text. */
interface NativeAdmissionSuccess {
  readonly status: "admitted";
  readonly response: NativeResponseEvidence;
}

/** A provider or envelope failure reached by one native invocation. */
interface NativeAdmissionFailure {
  readonly status: "rejected";
  readonly error: TransportError<"invalid_response">;
  readonly response: NativeResponseEvidence | null;
}

/** The provider-specific result before strict JSON object parsing. */
export type NativeAdmission = NativeAdmissionSuccess | NativeAdmissionFailure;

/** Time and timeout services used by the shared transport lifecycle. */
export interface TransportClock {
  /** Returns the current wall-clock instant. */
  wallNow(): Date;
  /** Returns a monotonic millisecond reading. */
  monotonicNow(): number;
  /** Creates the timeout signal for one provider attempt. */
  timeoutSignal(timeoutMs: number): AbortSignal;
}

/** Whole-call timing captured before provider selection and request building. */
export interface TransportCall {
  readonly clock: TransportClock;
  readonly startedMonotonic: number;
}

/** Provider-owned invocation and classification supplied to shared sequencing. */
export interface TransportExecution {
  readonly call: TransportCall;
  readonly identity: ModelIdentity;
  readonly timeoutMs: number;
  readonly callerSignal: AbortSignal;
  readonly invoke: (signal: AbortSignal) => Promise<NativeAdmission>;
  readonly classify: (error: unknown) => TransportError;
}

/** Strict parse success retained only inside one completed attempt. */
export interface ParsedNativeResponse extends NativeResponseEvidence {
  readonly parsedJson: JsonObject;
}
