# sergent-ts-webllm knowledge

This component turns a browser-local WebLLM engine into an ordinary Sergent model client. One
session is one worker: loaded once, used while ready, closed for good.

## Goal and design choices

The goal is narrow and strict. Give a Run a model that runs on the visitor's machine, and weaken
no rule the framework places on a model call while doing it. Every choice below follows from that
one sentence.

### The shape of a session

An application supplies two things: a factory that creates the dedicated worker, and a
`WebLlmProfile` naming the model assets and the load settings it has qualified. In return,
`createWebLlmSession` hands back a `WebLlmSession` carrying one cancellable load, a readable
state, core's `ModelClient`, and a final close. Construction captures that policy immutably and
creates nothing; the first worker appears when the caller asks for a load.

A session has no recovery path, by design. It loads once, serves calls while ready, and closes
for good. There is no replacement worker, no reconnect, and no second load. Recovery means a
fresh session, and the application decides when to build one.

### The line between this component and the rest

This component handles the native side of one model call: request translation, the compatibility
subset it promises, one exact parse of one response, worker lifetime, and the local timing that
arbitrates every result. [sergent-ts-core](../../sergent-ts-core/README.md) builds the canonical
Proposal Schema, admits the typed proposal, and defines the outcome vocabulary. The runtime
decides what a Run does next.

It adds no retry, no response repair, no prompt text describing response structure, no queue, no
worker replacement, and no model selection policy. Those decisions belong to the application or
to the runtime.

The dependency list is short for the same reason: core and the official WebLLM engine, and
nothing else. No runtime, no observability, no Node.

### Four units

The component splits into four units, each a directory behind one small facade.

- The root unit keeps the session: captured policy, the capability probe, the single load, the
  published readiness state, and disposal.
- `native` holds everything the engine SDK touches: the official worker proxy and its handler,
  request translation and compatibility, response admission, endpoint identity, and diagnostic
  events.
- `call` drives one invocation, from exclusive reset through the terminal outcome.
- `lifecycle` decides locally which result settled first, and keeps time behind an injectable
  clock.

Only serializable data crosses the worker seam: the native request and its schema string, the
load options, the native response, and the progress reports. Decoders, Recipes, Scenes,
Operations, abort signals, and core outcomes all stay on the main thread.

## Bridging into a Sergent Run

Nothing in the framework knows about WebLLM, and nothing here knows about a Run. The two meet at
one small interface, core's `ModelClient`, which is what lets a browser-local engine and a hosted
endpoint serve the same execution model with neither side bending for the other.

### What the application wires up

A dedicated worker entry does exactly one thing: call `installWebLlmWorker` on the worker global,
which installs the engine's official protocol handler. On the main thread, a factory creates that
worker, and the session takes charge of its lifetime from there.

A `WebLlmProfile` names the model id, the weights location, the compiled model library, the
context window, the history bound, the temperature, the tokenizer stop token ids, and the
assistant input separator. These are application assets; this component never picks a model.
Session construction copies the profile and rejects a load timeout or a context window that is
not a positive safe integer, so nothing later has to re-check them.

The browser must cooperate too: a secure context and a real WebGPU adapter, both checked before
anything is downloaded.

The application then passes `session.client` to the runtime as the model client of its Sergent
Instance, and names the model `webllm/` followed by the profile's model id. Every call checks
that name.

### One call, end to end

A Run asks for a model call, and the session admits the request before touching the worker. The
request must name this session's model, carry text-only messages, ask for low thinking effort,
bound its output below the loaded context window, and carry a Proposal Schema inside the
qualified subset described below. A request that fails any of those is rejected with no attempt,
and the session stays ready.

Low thinking effort is not a reasoning budget here, because the engine has none. It is the
application's statement that this request was sized for a small local model.

An admitted call takes the worker exclusively. It resets conversation and usage statistics first,
so no earlier request's history or cached-token accounting can enter this call's evidence, then
dispatches once and admits the response. A session serves one call at a time; its state moves to
running, and back to ready when the call completes.

The request's timeout covers the dispatched completion alone. The reset ahead of it carries a
fixed bound that no setting reaches, so a wedged reset cannot hold a call open and a timeout
sized for generation is never quietly spent on setup.

The returned value is core's outcome vocabulary unchanged. That is how observability builds the
model call evidence described by the
[Run Record specification](../../sergent/docs/run-record-spec.md#model-call-records) in "Model
call records" without knowing that WebLLM exists. This component serves one trust boundary only,
the external systems boundary that
[trust boundaries](../../sergent/docs/trust-boundaries.md#fifth-external-systems) defines in
"Fifth, external systems". The parsed object crosses the model-output boundary later, inside the
runtime.

### The challenges a local engine brings

**A gate before the expensive part.** The load probes for a secure context and requests a real
WebGPU adapter before creating a worker or downloading a byte. Capability is decided by running
the actual stack, never by browser-version rules and never by quietly falling back to a smaller
model. A successful probe promises neither enough memory nor a successful initialization; only
the real load reports those.

**One deadline for the whole setup.** A single load timeout spans probing, download, and
initialization, and it is rechecked when native loading finishes, so a timer delivered late
cannot let a slow load report success.

**The schema rides alone.** The exact canonical schema is serialized once into the native
JSON-object schema field and stays the only model-facing structural representation. The adapter
adds no schema text, no response example, no field list, and no generic JSON instruction, even
though the engine's interface documentation marks that prompt instruction mandatory. The
[prompt engineering guide](../../sergent/docs/prompt-engineering.md#let-the-schema-carry-structure),
in "Let the schema carry structure", explains why the framework forbids it. Recipe-authored
message text reaches the engine word for word. A model, template, and profile that obey a schema
under semantic-only guidance are therefore something a human qualifies, never something the
adapter arranges after the fact.

**A qualified subset, not a guess.** Compatibility inspects a canonical schema that core has
already built under the closed dialect the
[framework specification](../../sergent/docs/framework.md#canonical-schema-dialect) fixes in
"Canonical schema dialect". It re-proves none of that; it asks only whether this native stack
serves the shape: closed objects, bounded arrays, strings and string enums, nested unions, and
acyclic local definitions and references. Numeric, boolean, null, and other unqualified forms are
rejected before any reset or dispatch, so a rejected request costs no attempt. The subset records
what has been qualified here, not the limits of the underlying grammar engine. Extend it by
qualifying a real consumer's exact canonical schema. Never drop a constraint to make a schema
compile: that moves an invariant away from the generator onto a later boundary that can only
reject the result.

**Worker faults are opaque.** The engine's worker stringifies native exceptions, so the exception
type is already gone on arrival and message fragments must never classify a failure. Explicit
worker error and message-error events are the only trustworthy evidence of a worker fault.

**The first settlement wins.** Local arbitration claims the result, then removes timers and
listeners. It never waits for an abandoned worker call, which may stay pending forever without
holding the caller. Elapsed monotonic time is rechecked at every return, so a throttled tab that
delivers a timer late cannot turn a timeout into a success.

**Disposal terminates.** A session ends its worker rather than interrupting it, and the pinned
0.2.84 engine release is the reason. Its interruption flag is sticky: a chat reset does not clear
it, and the non-streaming dispatch reads it before generation could clear it, so an
interrupt-drain-reuse sequence would poison the next call. Termination makes the proxy unusable,
which is exactly what a session with no recovery path wants. It promises no immediate reclamation
of GPU driver memory.

**Token evidence is complete or absent.** The pinned engine's non-streaming producer builds
prompt, completion, and total counts together, and its usage type requires all three, so this
seam never observes a half-reported call. The triple maps onto input, output, and total, keeps a
reported zero, survives only when the counts are safe nonnegative integers whose sum agrees, and
becomes null when usage is missing. No input-only or output-only record is ever built, which is
what [observability](../../sergent/docs/observability.md#token-counts) requires in "Token
counts".

**Strict module resolution.** The engine ships a root type barrel whose declaration paths carry
no file extension, which NodeNext resolution cannot follow. Type-only imports therefore name the
pinned release's published declaration files directly, while value imports use the engine root.
One source tree then type-checks for a browser main thread, a worker, and the test runner alike.

### What hermetic tests settle, and what they cannot

Tests reach the session through internal seams over the engine and the clock. Typed engine
responses can be parked, deadlines advanced, and worker faults delivered, with no test-only
configuration on the public surface. They settle request translation and the exact schema string,
capability rejection without an attempt, response admission and reached token evidence, the reset
before each dispatch, the one-shot load with progress, probe failure and cancellation during a
parked probe, elapsed-deadline arbitration, callbacks that throw and change no outcome, and
disposal even when native work never resolves.

They settle nothing about a GPU. Compiling a schema into a grammar and comparing strings proves
that a shape is expressible and no more: no tokenizer masking, no native end-of-sequence
behavior, no GPU execution, no language quality. A human with a browser qualifies the real
template, schema-only generation, context fit, model quality, and GPU behavior, and
`sergent-ts-examples:grammary-x` is where that work lives.

## Edge cases and what to do about them

**A disposed session stays disposed.** A cancelled load or call, a timeout after dispatch, a
failed reset, an explicit worker fault, and an unknown native exception all terminate the worker
and publish an unavailable state. Mitigation: watch the published state, and build a fresh
session with a fresh worker when it turns unavailable. Nothing revives the old one.

**An abort during flight ends the session, not only the call.** Local work settles at once
and records no interrupted attempt, and the worker goes with it. A signal that is already
aborted when the call arrives costs nothing: the call returns a cancellation and the session
stays ready. Mitigation: abort in flight when you mean to stop using this model, and plan for a
reload if the visitor may continue.

**A rejected response is not a broken session.** Admission requires one choice from the loaded
model, assistant text that stopped naturally, no tool-call channel, and one strict parse that
yields a JSON object. Output cut off at the token cap fails on the natural stop, before its text
is even considered. The call fails and the session stays ready, carrying what it reached: the raw
text, the token mapping, and the request identifier. Mitigation: read that failure as a semantic
one, size the output cap for the largest proposal the schema admits, and decide deliberately
whether to spend a fresh Run on it.

**An unqualified model can stall on structure alone.** The engine's documentation warns that JSON
mode without a prompt instruction can produce an unending stream of whitespace until the token
cap stops it. The schema constraint, the output cap, and the model deadline bound the damage, but
the call still costs its full budget and then fails. Mitigation: treat repeated timeouts or
cap-length failures as a signal that the model and template were never qualified for schema-only
guidance, and qualify that pair in a real browser before shipping it.

**One attempt per call, and no retry.** The
[reliability guide](../../sergent/docs/reliability-best-practices.md#model-transport-and-provider-adapters),
in "Model transport and provider adapters", allows a transport to absorb a transient fault with
one identical retry. A local engine has no rate limit and no connection to lose, and the faults
it does meet leave the worker unusable, so this session dispatches once. Mitigation: a Run-level
retry is an application decision and starts a fresh Run.

**A schema outside the qualified subset never reaches the model.** Mitigation: check the proposal
types the application registers against the subset before shipping. When a real consumer needs a
missing shape, qualify that exact canonical schema against a real model and extend the subset.

**A successful probe is not a successful load.** Memory limits, initialization failures, and
download failures surface only during the real load. Mitigation: show load progress and the load
result to the visitor, and size the load timeout for the largest asset the profile names, over
the slowest connection worth supporting.

**WebGPU support varies, and a secure context is required.** Availability differs by browser,
platform, and driver, and an insecure page is refused before anything else. Mitigation: gate the
feature on the load result, and keep a remote path behind the application's server for the
visitors this rejects.

**A session serves one call at a time.** A call while another runs, a call before the load
resolves ready, a call on a session that has turned unavailable, a call after close, and a second
load all raise a programming error instead of returning a model outcome. Mitigation: drive one
Run at a time per session, and let the published state decide when the client is usable.

**Background tabs stretch timers.** Monotonic rechecks keep arbitration honest, so a late timer
cannot rewrite a settled result, but a call in a throttled tab can still pass a deadline that the
same call would have met in the foreground. Mitigation: size model timeouts for the worst case
you intend to support. The
[execution model](../../sergent/docs/execution-model.md#per-call-sizing), in "Per-call sizing",
makes those per-request bounds the application builder's choice.

**Diagnostics are for humans, not for control.** An optional callback receives
`WebLlmDiagnostic` events: reached boundaries with timing, the phase limit, a safe finish-reason
classification, and the token mapping. An event carries no request or response text, no schema,
no credential, and no Run Record, and a callback that throws changes no deadline and no outcome.
Mitigation: use diagnostics for a progress display or a support log, and read the Run Record for
durable evidence. This component writes to no console of its own and persists nothing, so
correlating an event with a Run belongs to the application.

**The stack is experimental and moves as one piece.** The pinned engine release, the compiled
model library format, the chat template, and the qualified profile fit together or not at all.
Mitigation: re-qualify the whole set in a real browser whenever one part of it changes, and treat
source inspection and a green test suite as no substitute for that pass.
