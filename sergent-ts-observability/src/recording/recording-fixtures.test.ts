/** Shared deterministic fixtures for recording unit tests. */
import {
  createMessages,
  createModelRequest,
  createModelSettings,
  createModelSuccess,
  createProposalDefinition,
  createSuccessfulModelAttempt,
  createUserMessage,
  Type,
} from "sergent-ts-core";
import type { ModelIdentity, ModelRequest, ModelSuccess, SceneIdentity } from "sergent-ts-core";

import type { CapturedValue, ModelCallRecord, ProposalSchemaRecord } from "../records/index.js";
import { RunRecordBuilder } from "./run.js";
import type { RecordClock } from "./time.js";

/** Stable identifiers used across recording lifecycle scenarios. */
export const RUN_ID = "run_00000000000000000000000000000000" as const;
export const SCENE: SceneIdentity = Object.freeze({
  scene_id: "scene_00000000000000000000000000000000" as const,
  revision: 7,
});

/** Stable resolved provider identity used by exact model-call scenarios. */
export const MODEL_IDENTITY: ModelIdentity = Object.freeze({
  provider: "provider",
  model: "model",
  sdkPackage: "provider-sdk",
  sdkVersion: "1.2.3",
});

/** Creates a clock whose wall and monotonic values advance deterministically. */
export function tickingClock(): RecordClock {
  let wallMilliseconds = 0;
  let monotonic = 0;
  return {
    wallNow: (): Date => new Date(Date.UTC(2026, 8, 1, 0, 0, 0, wallMilliseconds++)),
    monotonicNow: (): number => monotonic++,
  };
}

/** Creates one portable model request for model-call recording evidence. */
export function requestFixture(): ModelRequest {
  const proposal = createProposalDefinition(
    "RecordProposal",
    Type.Object({ decision: Type.String() }, { additionalProperties: false }),
  );
  return createModelRequest(
    "provider/model",
    createMessages([createUserMessage("decide")]),
    proposal.proposal_schema,
    createModelSettings(64, 1000, "low"),
  );
}

/** Exact schema record expected from the request fixture. */
export function expectedProposalSchema(): ProposalSchemaRecord {
  return {
    name: "RecordProposal",
    json_schema: {
      type: "object",
      required: ["decision"],
      properties: { decision: { type: "string" } },
      additionalProperties: false,
    },
  };
}

/** Exact captured request expected from the request fixture. */
export function expectedRequestCapture(): CapturedValue {
  return {
    value: {
      model_name: "provider/model",
      messages: [{ role: "user", content: "decide" }],
      model_settings: {
        maxOutputTokens: 64,
        timeoutMs: 1000,
        thinkingEffort: "low",
      },
    },
    value_type: "Object",
    error: null,
    status: "captured",
  };
}

/** Creates the successful provider outcome used by typed-crossing scenarios. */
export function successfulOutcome(): ModelSuccess {
  return createModelSuccess(
    MODEL_IDENTITY,
    [
      createSuccessfulModelAttempt(
        Object.freeze({
          startedAt: "2026-09-01T00:00:01.000000Z",
          finishedAt: "2026-09-01T00:00:01.004000Z",
          durationMs: 4,
        }),
      ),
    ],
    '{"decision":"continue"}',
    Object.freeze({ decision: "continue" }),
    Object.freeze({
      latencyMs: 9,
      tokens: Object.freeze({ input: 2, output: 1 }),
      requestId: "req-1",
    }),
  );
}

/** Exact successful provider evidence with optional typed-crossing capture. */
export function expectedSuccessfulModelCall(parsedProposal: CapturedValue | null): ModelCallRecord {
  return {
    proposal_schema: expectedProposalSchema(),
    model_name: "provider/model",
    identity: {
      provider: "provider",
      model: "model",
      sdk_package: "provider-sdk",
      sdk_version: "1.2.3",
    },
    payloads: {
      request: expectedRequestCapture(),
      raw_response: '{"decision":"continue"}',
      parsed_json: { decision: "continue" },
      parsed_proposal: parsedProposal,
    },
    usage: { latency_ms: 9, tokens: { input: 2, output: 1 }, request_id: "req-1" },
    attempts: [
      {
        timing: {
          started_at: "2026-09-01T00:00:01.000000Z",
          finished_at: "2026-09-01T00:00:01.004000Z",
          duration_ms: 4,
        },
        status: "success",
        retryable: null,
        error: null,
      },
    ],
  };
}

/** Records deterministic process-input evidence for a reached run. */
export function recordProcessInput(recording: RunRecordBuilder): void {
  const processInput = recording.startStep("process_input");
  processInput.captureInput({ observation: "recent context" });
  processInput.addOutput("selected_target", { target_id: "item-1" });
  processInput.succeed();
}

/** Records one successful model-backed Intent step. */
export function recordIntent(recording: RunRecordBuilder): void {
  const intent = recording.startStep("intent");
  const call = intent.openModelCall(requestFixture());
  call.complete(successfulOutcome());
  call.recordParsedProposal({ decision: "continue" });
  intent.addOutput("derived_intent", { flow: "continue", reason: "needed" });
  intent.addOutput("flow", "continue");
  intent.succeed();
}

/** Records deterministic Plan, Patch, dry-run, and commit evidence. */
export function recordDeterministicTail(recording: RunRecordBuilder): void {
  const plan = recording.startStep("execution_plan");
  const planCall = plan.openModelCall(requestFixture());
  planCall.complete(successfulOutcome());
  planCall.recordParsedProposal({ operations: [{ call: "replace", value: "new" }] });
  plan.addOutput("derived_execution_plan", { base: SCENE, steps: [{ call: "replace" }] });
  plan.succeed();
  const patch = recording.startStep("patch");
  patch.addOutput("compiled_patch", { operation_count: 1 });
  patch.addOutput("dry_run", { after_identity: { ...SCENE, revision: 8 } });
  patch.succeed();
  const commit = recording.startStep("commit");
  commit.addOutput("commit_kind", "plain");
  commit.addOutput("metadata", {});
  commit.succeed();
}
