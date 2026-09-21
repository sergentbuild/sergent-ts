# sergent-ts knowledge

This document gives you the whole project in one sitting: what sergent-ts is, how its six
components divide the work, and where to continue reading.

## sergent-ts in 30 seconds

sergent-ts is the TypeScript reference implementation of the Sergent Specification, a rulebook for
agentic applications in which the model only proposes and deterministic code decides. The
[specification overview](../sergent/docs/KNOWLEDGE.md) explains the idea; its section "The Story
of One Run" is the shortest way in.

The implementation materializes that rulebook as six components. A few design choices give it
its character:

- One Run is one transaction. `invokeRun` observes a Scene, lets the model propose at most twice,
  rehearses the proposed change on an isolated copy, and commits only when every check passes.
  In every other case the application receives its Scene back unchanged.
- One TypeBox object is the whole Proposal Schema. It is the static TypeScript type, the JSON
  Schema the model receives, and the strict decoder for the model's answer, so generation and
  admission cannot drift apart.
- The framework fits the browser. Core, observability, and runtime use standard Web APIs only,
  so the same code serves a browser tab, a worker, and Bun.
- `sergent-ts-webllm` runs the model inside the browser too, on the visitor's GPU, so an
  application can ship as a static site with no model server and no API key behind it. This
  component is unique to the TypeScript implementation.
- Run Record persistence is a first-class component, `sergent-ts-run-record`, and not a runtime
  option. Its harness is an ordinary `RunObserver`; runtime never depends on it. Persistence stays
  opt-in, and Node file APIs stay out of every browser dependency graph.
- Every component is strict TypeScript shipped as source, with explicit exported types and one
  curated entry, so an application compiles against the same types the framework is checked with.

## A walk through the whole project

### Six components and the specification subjects they materialize

Each component takes one subject of the specification and turns it into TypeScript. Read a
component's README for its role, then its knowledge file for its design.

- Core ([README](../sergent-ts-core/README.md),
  [knowledge](../sergent-ts-core/docs/KNOWLEDGE.md)) materializes the
  [framework specification](../sergent/docs/framework.md) and the vocabulary of the
  [terminology](../sergent/docs/terminology.md): `createProposalDefinition`, `defineOperation`,
  `createOperationRegistry`, the Recipe factories, and the types an application implements or
  consumes: `SceneActions`, `MindBuf`, `Target`, and `ModelClient`.
- Runtime ([README](../sergent-ts-runtime/README.md),
  [knowledge](../sergent-ts-runtime/docs/KNOWLEDGE.md)) materializes the
  [execution model](../sergent/docs/execution-model.md): `configureIntentOnlyRun`,
  `configurePlanCapableRun`, `invokeRun`, `RunHandle`, and `SharedSceneAuthority`.
- Observability ([README](../sergent-ts-observability/README.md),
  [knowledge](../sergent-ts-observability/docs/KNOWLEDGE.md)) materializes the
  [observability specification](../sergent/docs/observability.md) and the
  [Run Record specification](../sergent/docs/run-record-spec.md): the `RunRecord` and its
  builders, `ProgressSnapshot`, `SergentResult`, and `RunObserver`.
- Run Record ([README](../sergent-ts-run-record/README.md),
  [knowledge](../sergent-ts-run-record/docs/KNOWLEDGE.md)) materializes the
  [Run Record file format](../sergent/docs/run-record-file-format.md): `createRunRecordHarness`.
- Providers ([README](../sergent-ts-providers/README.md),
  [knowledge](../sergent-ts-providers/docs/KNOWLEDGE.md)) stands at the external-systems boundary
  of the [trust boundary specification](../sergent/docs/trust-boundaries.md#fifth-external-systems),
  in "Fifth, external systems": one `ModelClient` factory for each of four official SDKs.
- WebLLM ([README](../sergent-ts-webllm/README.md),
  [knowledge](../sergent-ts-webllm/docs/KNOWLEDGE.md)) stands at the same boundary inside the
  browser: `createWebLlmSession` returns a session whose `client` is a `ModelClient`, backed by
  one dedicated worker running the WebLLM engine.

Dependencies point one way. Every component builds on core. Runtime and Run Record also build on
observability. Nothing depends on runtime, providers, WebLLM, or Run Record: the application
composes them. The
[For Implementers](../sergent/docs/for-implementers.md#recommended-implementation-layering) guide,
in "Recommended implementation layering", asks for an acyclic one-directional layering and leaves
the split to the implementation. This implementation separates observability from runtime so that
recording stays portable, and separates Run Record from both so that Node file APIs stay out of
the execution path.

### One Run through the components

The [execution model](../sergent/docs/execution-model.md#the-sergent-run-flow), in "The Sergent
Run flow", defines the order of a Run. This is how the components carry it:

1. The application prepares its policy with core: Proposal Schemas, an Operation Registry, a
   Recipe, and a `SceneActions` object for its Scene. It creates a `ModelClient` with providers
   or WebLLM.
2. A runtime builder captures that policy once, together with an Intent source: the model, or
   `passThroughIntentSource`, which supplies the Intent Proposal without a model call.
   `invokeRun` then takes the configured Run, a Scene or a `SharedSceneAuthority`, a `MindBuf`,
   and an `AbortSignal`, and returns a `RunHandle` at once.
3. Runtime binds the Scene identity, reads the `MindBuf` text once, and asks `SceneActions` for
   the one Target of this Run.
4. For each model call, the Recipe writes the messages and runtime adds the captured schema and
   settings. The `ModelClient` returns a parsed JSON object, and core's strict decoder admits it
   as a typed proposal or rejects it.
5. Deterministic code does everything else. Once an Intent Proposal exists, the Recipe derives
   and validates the Intent; after the Plan Proposal, it derives the Execution Plan. Runtime
   checks Operation Admissibility before the Recipe validates the whole Execution Plan and
   compiles the Patch, with core supplying the default derivation and compilation. Runtime then
   rehearses the Patch through `SceneActions` and commits the result, either on the Run's
   snapshot or through the `SharedSceneAuthority` under its `strict` or `rebase` policy.
6. All along, runtime feeds the observability builders. Each `RunObserver` receives a
   `ProgressSnapshot` per reached stage and, at the end, the `SergentResult` with the closed
   `RunRecord`. A Run Record harness is one such observer.

### Where untrusted input is admitted

The [trust boundary specification](../sergent/docs/trust-boundaries.md#the-five-boundaries), in
"The five boundaries", names the only places where a Run may validate runtime input. This
implementation assigns them as follows:

- model output: core performs the strict admission, and runtime invokes it;
- human input: the application, at its entry points;
- persistence load: the application, for its durable state; Run Record files are inspection
  evidence and never turn back into runtime objects;
- shared live state at commit: runtime, through `SharedSceneAuthority`;
- external systems: providers and WebLLM for model transport, the Run Record harness for the
  filesystem.

Outside these five places a Run admits nothing new. The
[same specification](../sergent/docs/trust-boundaries.md#the-method-to-discard-redundant-validation),
in "The method to discard redundant validation", gives the three questions that decide whether a
check belongs.

### Where each component runs

Core, observability, and runtime run in a browser tab, in a worker, and under Bun. WebLLM needs a
browser page with a secure context and working WebGPU. Providers and Run Record need Node APIs,
and a browser application imports neither.

`just lint` proves the import side of this split. It type-checks the workspace under Bun, then
checks the facades of core, observability, runtime, and WebLLM again as a browser program and as
a worker program, without Bun or Node types. Browser execution, GPU support, and model behavior
need a person and the playground `sergent-ts-examples:grammary-x`.

### Implementation-native facts

The specification lets an implementation keep native names for captured values. Captured model
settings therefore keep the TypeScript names `maxOutputTokens`, `timeoutMs`, and
`thinkingEffort`, as the [Run Record specification](../sergent/docs/run-record-spec.md#captured-values)
permits in "Captured values". Every field the specification defines keeps the specification's
name.

### Tests

Unit tests sit beside the code they exercise. They use scripted model clients, parked promises,
isolated Scenes, injected clocks and abort signals, and temporary paths, so they need no network,
no credentials, and no sleeps. Each component's knowledge file explains what its tests establish
and what they cannot.
