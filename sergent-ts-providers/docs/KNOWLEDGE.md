# sergent-ts-providers knowledge

Model providers are the most valuable and the least predictable part of a Sergent Run. This
component gathers that unpredictability into one place and gives it a shape you can reason about.

## The crossing and the choices behind it

The runtime builds one immutable `ModelRequest` from core's constructor: a full model name,
constructed messages, the canonical Proposal Schema, and the settings for one phase. It then
invokes the client with that request and a caller abort signal. The component resolves to a
`ModelOutcome`, which is a success, a failure, or a cancellation, and it throws nothing for an
expected provider failure. Observability turns the evidence inside that outcome into model call
records, which the
[Run Record specification](../../sergent/docs/run-record-spec.md#model-call-records) defines in
"Model call records".

All of that happens at a single boundary. The
[trust boundary specification](../../sergent/docs/trust-boundaries.md#fifth-external-systems), in
"Fifth, external systems", fixes what a transport may and may not do with a provider response.
Read it before changing admission. Two consequences run through every decision here:

- Values from core arrive constructed by deterministic code and are trusted. Values from a provider
  stay untrusted until one admission step narrows them.
- A parsed JSON object is not a proposal. Typed proposal admission belongs to the model-output
  boundary, which the runtime performs later in the Run.

This component depends on core alone, and the runtime never depends on it. The two meet only
through core's `ModelClient` interface, which keeps the dependency graph acyclic; the
"Recommended implementation layering" section of the advisory
[implementer guide](../../sergent/docs/for-implementers.md#recommended-implementation-layering)
recommends exactly that shape.

### The choices that shape every adapter

**Official SDKs.** The advisory
[implementer guide](../../sergent/docs/for-implementers.md#interact-with-the-model-providers), in
"Interact with the model providers", recommends the vendor's SDK. Each SDK version is pinned
exactly, because each translation is written against one published request shape.

**One shared lifecycle, and differences kept where they belong.** Everything provider-neutral
belongs to the `transport` unit, so a vendor quirk has exactly one place to live: the unit for that
provider. That containment is what lets four very different APIs present one interface.

**Composition, not inheritance.** A factory captures its configuration in a closure and hands the
shared lifecycle its per-call body. Inside that body it supplies two more functions for the attempt
loop: an invocation that performs one native call under a given abort signal, and a classifier that
maps a thrown value to one closed failure kind. No adapter base class exists, and no registry
decides at runtime which adapter runs.

**`unknown` at the seam, typed values inward.** The SDK's promises are trusted, such as
authentication, serialization, and its error classes. What the provider put inside the envelope is
not, so each adapter takes the response as `unknown` and narrows it once. A declared response type
still admits a semantically wrong runtime value. What survives narrowing is exactly one semantic
response text plus the facts the attempt reached, trusted inward from there.

**Failure is a value.** Core's transport failure vocabulary is a closed set of kinds, and an
adapter constructs one of them and resolves. Core, not this component, decides which kinds
permit an identical second attempt: timeout, rate limiting, and provider unavailability. Every
other kind stops after one attempt.

**One strict parse, and no rescue.** Admitted text is parsed once into one non-null, non-array JSON
object. Arrays, scalars, malformed JSON, code fences, and text wrapped around JSON all fail as an
invalid response. Repair in every form is absent, because repair turns a provider failure into a
success the Run never earned. Streaming and tool calls are absent for the same kind of reason: a
stream would force a decision about half a JSON object, and a tool-call path would open a second
route to execution authority, which
[The model only proposes](../../sergent/docs/framework.md#the-model-only-proposes) forbids. The
advisory
[reliability guidance](../../sergent/docs/reliability-best-practices.md#model-transport-and-provider-adapters),
in "Model transport and provider adapters", sets the attempt bound and the identical-retry rule
this component follows.

**Only reached evidence.** Every value in an outcome is a fact some attempt produced. Each known
token direction survives independently, including a reported zero; an unknown direction is omitted;
a derived count needs every operand and safe arithmetic, following the
[Token counts](../../sergent/docs/observability.md#token-counts) convention. Credentials,
credential-bearing headers, and endpoint secrets never enter an error or an outcome.

Provider selection policy, availability policy, whole-Run retry, and provider fallback stay with
the application. This component answers one question at a time: what did this provider do with
this request?

### Where the browser-local component sits

[`sergent-ts-webllm`](../../sergent-ts-webllm/README.md) is the browser-local sibling. It drives
the official WebLLM SDK, with model weights fetched into the browser and generation running on a
dedicated worker. It reaches the runtime through the same `ModelClient` interface from core, but by
a different route: the application creates a session, awaits an explicit load, and hands the
session's client to the runtime.

The split is not cloud against local, as Ollama shows: an Ollama server on your laptop is still an
HTTP endpoint reached through a vendor SDK, so it belongs here. The real line runs between an
endpoint you call and an engine you host inside the page. A worker lifetime, an explicit load with
its own deadline, session state, and disposal mean nothing to a hosted endpoint, while API keys,
HTTP status codes, and per-attempt retries mean nothing inside a browser tab. Separating the two
also keeps dependency graphs honest: Node provider SDKs never enter a browser build, and the
browser engine never enters a Node application.

## The structure, and how to add a provider

### Five units, one direction

- `transport` is provider-neutral. It captures configuration, starts whole-call timing before any
  provider work, sequences attempts, arbitrates caller cancellation against the per-attempt
  deadline, narrows external objects and token counts, performs the single strict parse, and
  constructs the outcome. Where an SDK's types demand a record shape, it also bridges the canonical
  schema into that shape without replacing the schema object. It names no provider.
- `openai`, `anthropic`, `google`, and `ollama` each serve one provider: request translation,
  native invocation, envelope admission, error classification, and token extraction.

Dependencies point one way. Each provider unit depends on `transport` and core, `transport` depends
on core alone, and no provider unit depends on another. Core is the only workspace dependency. The
package facade exposes four factories and their configuration types, and no native request or
response type.

Admission is staged on purpose. A provider unit yields either one exact semantic text or a
rejection; the shared lifecycle alone parses admitted text into a generic JSON object; core alone
admits a typed proposal, which the runtime does later.

Two timing rules inside that lifecycle surprise people. The deadline is decided by elapsed
monotonic time, not by which timer fired first: a response that arrives after its deadline is a
timeout even when it would have parsed, and a caller abort that lands after the deadline is
recorded as a timeout too. An attempt's clock also closes only after admission and the strict parse
have finished, so a recorded attempt duration covers the decision, not just the network wait.

### What a new provider unit supplies

1. A factory that takes explicit configuration and returns a client implementing core's
   `ModelClient` interface. Whole-call timing starts before credential checks, prefix resolution,
   and request building, so reported latency covers the preparation and not only the network call.
2. Preflight, in order: credential or endpoint configuration, where an explicitly blank value fails
   and an absent optional endpoint is allowed to fall back to the SDK default, then the model-name
   prefix. The prefix selects the provider and the remainder stays the native model name. A
   provider that cannot carry every canonical schema adds its compatibility check here. Every
   preflight failure carries zero attempts.
3. A resolved identity. Alongside the provider name and the native model name, it carries the SDK
   package and its version, because the model call record reports them. Some SDKs export their
   version; for one that does not, take it from the pinned dependency.
4. One native request, built once, placing the exact canonical schema into the provider's native
   schema-constrained output facility, plus the output token bound and the thinking policy. The
   per-attempt deadline reaches the provider wherever its SDK accepts one, and the shared lifecycle
   enforces it in every case. A retry sends that same request again; only the per-attempt signal is
   fresh.
5. An invocation that performs one native call under a given abort signal with the SDK's hidden
   retries disabled, and returns either an admission carrying one semantic text with the evidence
   reached, or a rejection.
6. A classifier that maps a thrown value to one closed failure kind using typed SDK error classes,
   HTTP status facts, and markers this component creates. Never the provider's message text, which
   is display material and changes freely.
7. One entry in the package facade, exporting the factory and its configuration type.
8. A hermetic test suite. Each configuration carries a narrow injection seam for it: an SDK-shaped
   client object the adapter calls directly, a fetch function that lets the real official SDK run
   against scripted HTTP responses, or both. Determinism comes from injected clocks, explicit abort
   controllers, and parked promises, never from timing. Every provider suite covers the same
   ground: one case for each failure its provider can produce, identical retry data, zero-attempt
   preflight, admission rejections, token accounting, and secret exclusion.

Then prove the unit with `just test` and `just lint` from the workspace root. Those tests cannot
prove that a given hosted model or a given installed Ollama model honors the schema it was sent.
A human qualifies that against a live model.

### Promises a new provider must keep

- Read no environment variable. Take every credential and endpoint from configuration captured at
  construction.
- Leave the SDK's automatic retries disabled, and where the SDK has none, confirm it. The shared
  lifecycle is the single in-call retry step, and it performs at most two immediate attempts with
  no delay between them.
- Send the canonical Proposal Schema unchanged. When a provider cannot carry it, fail closed before
  any attempt instead of weakening the request.
- Parse once, strictly. Add no repair, fence stripping, brace hunting, candidate merging, schema
  weakening, tool-call fallback, streaming, or second proposal decoder.
- Record only the evidence an attempt reached, and derive a count only when every operand is known.

### Differences worth knowing before you touch an adapter

**Anthropic rejects a schema instead of weakening it.** Anthropic cannot carry every canonical
schema. Before any attempt, the adapter walks the whole canonical schema graph and refuses a
numeric minimum or maximum, a maximum item count, and a minimum item count above one. The walk
only inspects; it never removes or rewrites a bound, because a silently weakened schema lets the
model produce values the application already declared invalid. The failure is an invalid payload
with zero attempts.

**Ollama builds one SDK client per attempt.** The pinned SDK's non-streaming chat call takes no
options argument and no per-call signal, so each attempt constructs a request-scoped client whose
fetch function binds that attempt's signal. A retry gets a fresh client and a fresh signal while
sending the same request data.

**Thinking policy differs, and it is part of what each adapter promises.** OpenAI passes core's
effort value through as reasoning effort. Anthropic fixes thinking to adaptive and passes the
effort through its output configuration instead, which is two decisions rather than one. Ollama's
SDK accepts the three effort names directly, and the adapter still collapses them into thinking
switched off for low effort and on otherwise, by choice rather than by limitation. Google sends no
thinking field at any effort level, which lets Gemini's native dynamic thinking decide; that
silence is the chosen policy, not an oversight waiting to be fixed. None of these may drift
quietly.

**Classification differs because provable knowledge differs.** An adapter claims a terminal
classification only when it can prove which stage failed. OpenAI creates its own marker for a
failure while reading an HTTP response body, so every remaining thrown envelope failure there is
unambiguous and terminal. Anthropic, Google, and Ollama have no such marker, so a thrown type error
names no stage and all three treat it as retryable connection unavailability. Google draws one more
line from its pinned SDK: a thrown syntax error arrives only after the body has been read whole,
which makes a non-JSON body a terminal invalid response there, while Anthropic and Ollama keep it
retryable. Ollama exposes no public error class, so its status comes from the thrown value itself.

**Derived token counts bite in two places.** Anthropic's input count is the checked sum of the
ordinary, cache-read, and cache-creation categories, so a single missing category makes the whole
input count vanish, while the output count is admitted independently. Google's output count is
derived as the total minus the prompt count, so that candidate work and thinking work each count
exactly once; that derivation survives only when the prompt count is known and the total is at
least as large. An incomplete derived count never erases an independently reported direction.

**Ollama schema adherence varies by installed model.** A later typed proposal failure is the
runtime's evidence about that model, and it never triggers a weaker mode inside this component.
