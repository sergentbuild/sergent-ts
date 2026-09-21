import {
  createMessages,
  createModelRequest,
  createModelSettings,
  createProposalDefinition,
  createUserMessage,
  Type,
} from "sergent-ts-core";
import type { ModelRequest } from "sergent-ts-core";
import type { ChatOptions } from "@mlc-ai/web-llm/lib/config.js";
import type {
  ChatCompletion,
  ChatCompletionFinishReason,
  CompletionUsage,
} from "@mlc-ai/web-llm/lib/openai_api_protocols/chat_completion.js";
import type {
  NativeEngine,
  NativeRequest,
  WebLlmDiagnostic,
  WebLlmProfile,
  WebLlmProgress,
} from "./native/index.js";
import { FakeClock } from "./clock-fixture.test.js";
import { FakeWorker } from "./worker-fixture.test.js";
import { Session } from "./session.js";
import type { WebLlmSessionConfig, WebLlmState } from "./types.js";

/** Tiny deterministic candidate profile independent of application-specific pins. */
export const PROFILE: WebLlmProfile = {
  modelId: "local-test",
  modelUrl: "https://example.test/model/",
  modelLibraryUrl: "https://example.test/model.wasm",
  contextWindowSize: 4096,
  maxHistorySize: 1,
  temperature: 0.1,
  stopTokenIds: [7, 8],
  roleEmptySeparator: "\n",
};

/** A legitimate canonical request used to enter the session's native boundary. */
export function request(): ModelRequest {
  const proposal = createProposalDefinition(
    "text",
    Type.Object({ text: Type.String() }, { additionalProperties: false }),
  );
  return createModelRequest(
    `webllm/${PROFILE.modelId}`,
    createMessages([createUserMessage("Fix this text.")]),
    proposal.proposal_schema,
    createModelSettings(128, 100, "low"),
  );
}

/** Complete native usage permits only numerical variations at the evidence boundary. */
export function tokenUsage(
  input: number = 20,
  output: number = 8,
  total: number = input + output,
): CompletionUsage {
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: total,
    extra: {
      e2e_latency_s: 1,
      prefill_tokens_per_s: 100,
      decode_tokens_per_s: 10,
      time_to_first_token_s: 0.2,
      time_per_output_token_s: 0.1,
    },
  };
}

/** Native response producer exposes real supported and failed semantic shapes. */
export function response(
  content = '{"text":"Fixed."}',
  finish: ChatCompletionFinishReason = "stop",
): ChatCompletion {
  return {
    model: PROFILE.modelId,
    id: "native-local-id",
    object: "chat.completion",
    created: 1_783_123_200,
    choices: [
      {
        finish_reason: finish,
        index: 0,
        logprobs: null,
        message: { role: "assistant", content },
      },
    ],
    usage: tokenUsage(),
  };
}

/** Native-shaped lifecycle producer with explicit stage entry and settlement gates. */
export class FakeEngine implements NativeEngine {
  readonly reloadEntered: PromiseWithResolvers<void> = Promise.withResolvers<void>();
  readonly resetEntered: PromiseWithResolvers<void> = Promise.withResolvers<void>();
  readonly completionEntered: PromiseWithResolvers<void> = Promise.withResolvers<void>();
  readonly requests: NativeRequest[] = [];
  readonly resets: [boolean, string][] = [];
  loadOptions: ChatOptions | null = null;
  reloadResult: Promise<void> = Promise.resolve();
  resetResult: Promise<void> = Promise.resolve();
  completionResult: Promise<ChatCompletion> = Promise.resolve(response());
  /** Records the actual captured overrides and parks only when the scenario requests it. */
  reload(_model: string, options: ChatOptions): Promise<void> {
    this.loadOptions = options;
    this.reloadEntered.resolve();
    return this.reloadResult;
  }
  /** Announces reset before settling its independent preflight result. */
  resetChat(keepStats: boolean, model: string): Promise<void> {
    this.resets.push([keepStats, model]);
    this.resetEntered.resolve();
    return this.resetResult;
  }
  /** Records each dispatch so forbidden retry or overlap remains observable. */
  chatCompletion(value: NativeRequest): Promise<ChatCompletion> {
    this.requests.push(value);
    this.completionEntered.resolve();
    return this.completionResult;
  }
}

/** The owned test boundaries and externally observable session state. */
export interface Fixture {
  readonly session: Session;
  readonly engine: FakeEngine;
  readonly worker: FakeWorker;
  readonly clock: FakeClock;
  readonly states: WebLlmState[];
  readonly diagnostics: WebLlmDiagnostic[];
  readonly progress: (report: WebLlmProgress) => void;
}

/** Before proxy construction there is no native progress callback to deliver. */
function ignoreProgress(): void {}

/** Builds one independent session over deterministic external and timing boundaries. */
export function fixture(
  probe: () => Promise<"webgpu_unavailable" | null> = () => Promise.resolve(null),
  notify: (state: WebLlmState) => void = () => {},
  diagnose: (event: WebLlmDiagnostic) => void = () => {},
): Fixture {
  const engine = new FakeEngine();
  const worker = new FakeWorker();
  const clock = new FakeClock();
  const states: WebLlmState[] = [];
  const diagnostics: WebLlmDiagnostic[] = [];
  let progress: (report: WebLlmProgress) => void = ignoreProgress;
  const config: WebLlmSessionConfig = {
    profile: PROFILE,
    workerFactory: () => worker,
    loadTimeoutMs: 1000,
    onStateChange: (state) => {
      states.push(state);
      notify(state);
    },
    onDiagnostic: (event) => {
      diagnostics.push(event);
      diagnose(event);
    },
  };
  const session = new Session(config, {
    clock,
    probe,
    createEngine: (_worker, _profile, report) => {
      progress = report;
      return engine;
    },
  });
  return {
    session,
    engine,
    worker,
    clock,
    states,
    diagnostics,
    progress: (report) => progress(report),
  };
}

/** Loads one healthy fake worker before the invocation-specific scenario begins. */
export async function ready(): Promise<Fixture> {
  const value = fixture();
  await value.session.load(new AbortController().signal);
  return value;
}
