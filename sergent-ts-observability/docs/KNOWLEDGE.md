# sergent-ts-observability knowledge

This component is the memory of a Sergent Run. What follows is a guided tour of how that
memory is built in TypeScript.

## The big picture

A Sergent Run is a short, transactional piece of work. While it advances it touches an
Observation, a model, an Execution Plan, a Patch, and a Scene. Afterwards someone needs to know
exactly what it touched and how it ended.

The memory has two halves. The durable half is the Run Record: inert data that the runtime
returns once a Run closes. The live half is transient: one progress snapshot per reached
stage, and the Sergent Result at the end. Both halves only describe. Neither steers a Run, and
neither can fail one.

Recording happens during the work rather than after it. Runtime opens a builder before the
first step and feeds it each fact as the Run reaches it. A builder accepts facts only forward,
so the closed record cannot disagree with what actually happened. Nothing here keeps a second,
richer trace that an export step would trim on the way out; there is one evidence path, and
what a consumer receives is the whole of it.

Four units stand behind the package entry.

- `records` defines the inert evidence shapes. It carries no lifecycle; its few functions only
  build isolated values that a builder then embeds.
- `observer` defines the live in-process shapes: `ProgressSnapshot`, the `SergentResult`
  union, and the `RunObserver` callback interface.
- `capture` projects reached values into JSON-shaped evidence.
- `recording` holds the mutable builders and the clock. It is the only unit with a lifecycle,
  and the only unit here that drives capture.

`sergent-ts-core` supplies the typed values those shapes quote: identities, model evidence,
Execution Plans, Patches, JSON values, and errors. Nothing else enters the dependency graph.
`sergent-ts-runtime` drives every builder and delivers every callback.

### Read each shape where it is defined

The framework fixes these shapes so that every implementation reports the same facts, in the
same form, for the same Run. This file explains how they are produced and does not restate
them.

- The Run Record specification defines the record itself in
  ["The Run Record"](../../sergent/docs/run-record-spec.md#the-run-record), the projection
  envelope in ["Captured values"](../../sergent/docs/run-record-spec.md#captured-values), and
  the result in
  ["The Sergent Result structure"](../../sergent/docs/run-record-spec.md#the-sergent-result-structure).
- The observability specification defines the value conventions in
  ["Data conventions"](../../sergent/docs/observability.md#data-conventions), the live view in
  ["Progress snapshots"](../../sergent/docs/observability.md#progress-snapshots), the delivery
  sequence and its exception containment in
  ["Observer delivery"](../../sergent/docs/observability.md#observer-delivery), and the
  handling rules in ["Sensitivity"](../../sergent/docs/observability.md#sensitivity).
- The execution model defines the stage vocabulary in
  ["Stages and Status"](../../sergent/docs/execution-model.md#stages-and-status), and the
  Sergent Result at a terminal outcome, cancellation included, in
  ["Cancellation and the Sergent Result"](../../sergent/docs/execution-model.md#cancellation-and-the-sergent-result).
- The Run Record file format specification defines the persisted line in
  ["Line envelope"](../../sergent/docs/run-record-file-format.md#line-envelope) and the file
  rules in ["File discipline"](../../sergent/docs/run-record-file-format.md#file-discipline).
  Both belong to a sibling component.

## TypeScript design choices

### Two components instead of one

Everything in memory lives here; writing Run Record files lives in
[`sergent-ts-run-record`](../../sergent-ts-run-record/README.md). That boundary earns its place
twice.

The split buys isolation. This component reaches for standard Web APIs and nothing else:
platform wall time, the monotonic performance clock, and standard base64 decoding for image
byte counts. No Bun or Node ambient type is required, so the same sources type-check for the
browser main thread and for workers, and a browser application never drags filesystem code it
cannot use into its graph.

The split buys encapsulation. Line encoding, directory choice, and file lifecycle stay behind
the observer seam, so a change to the file format cannot reach the record shapes, and a Run
behaves identically whether or not anything is persisting it. The harness needs no privileged
hook; it implements `RunObserver` exactly as an application would.

Beyond that interface, four small pieces cross on purpose: `RecordClock`, its default
`SYSTEM_CLOCK`, the timestamp formatter `formatTimestamp`, and the native type namer
`capturedTypeName`. The formatter is the least obvious of the four and the reason the sharing
matters: the specification asks for exactly six fractional digits while the platform date
object carries three, so `formatTimestamp` pads the missing three. Every timestamp either
component formats therefore ends in the same three zeros.

### A builder tree that only moves forward

Three levels of builder mirror three levels of evidence. `RunRecordBuilder` holds the Scene
binding, the ordered step list, and the single terminal action. `StepRecordBuilder` holds one
step's input, its merged output, its timing, and at most one model call.
`ModelCallRecordBuilder` holds the request capture, the canonical Proposal Schema, and
whatever the provider returned. `createRunRecordBuilder` opens the tree with a Run ID, the
caller's model selection, and a clock; every other fact arrives as the Run reaches it.

Closure flows upward and only upward. A model call builder closes into its step builder. A
step builder closes into a Step Record and hands that record to the run builder, which appends
it. Until that moment the step is an active builder and not an element of anything, so
in-flight construction and recorded evidence never share a place.

The builders refuse any construction that could produce an untruthful record.

- Scene identity binds exactly once.
- Only the next step in the fixed order may start, and only one step may be active.
- Input evidence belongs to the first step alone, and a model call may open only on the two
  model-backed steps.
- A successful Execution Plan step must carry its model call, and a model call whose provider
  succeeded must carry its typed proposal unless its step fails.
- A child that ends in failure or cancellation fixes the Run's terminal state and error, and
  prevents later steps.
- A model call's evidence and its enclosing step must name the same error.
- A completed commit cannot be reversed into failure or cancellation.
- A closed builder refuses further evidence.

When a Run ends while a step is still open, that step closes with the Run's terminal state
before it is appended. Every fact the Run reached survives, and no step that never ran is
invented to hold it.

### Capture projects outward and never inward

Capture converts values this component already trusts into JSON-shaped evidence. It admits no
input and opens no trust boundary, and evidence never travels back into a Run. That framing
decides the failure policy: a projection problem is recorded inside its own envelope and never
reaches the Run outcome.

Generic capture walks a value. Finite JSON primitives, arrays, and the enumerable fields of
ordinary objects and class instances pass through. A leaf that no rule covers degrades into a
native type name plus a bounded rendering, and that degradation is a successful capture. Only
a conversion that actually fails produces a capture error: a cycle on the active traversal
path, a property accessor that throws, or a native rendering that throws.

Two construction choices explain most observed behavior. A step's output is a single capture
over the merged raw facts, recaptured on every addition, so one failing fact replaces that
step's entire output envelope and replacing that fact restores the whole output. The terminal
message and the terminal metadata are two separate captures rather than one merged capture, so
a failure in either leaves the other intact.

Some captured data is deliberately not portable. Captured model settings keep this
implementation's native member names, `maxOutputTokens`, `timeoutMs`, and `thinkingEffort`,
which the [Run Record specification](../../sergent/docs/run-record-spec.md#captured-values)
permits in "Captured values", and captured type names are diagnostic only. Beside generic
capture sit exact projections for the shapes the specification pins: the model request, one
message, the Execution Plan evidence through `executionPlanEvidence`, and the Patch summary
through `projectPatchSummary`. Runtime calls those two directly, because it assembles those
step outputs itself.

### Values are isolated rather than defended

Records, results, progress snapshots, and builder outputs are readonly, and every value that
could otherwise alias live state is copied or rebuilt on the way in: Scene identities, the
step list, parsed JSON, commit metadata, token counts, collected observer errors, and each
provider attempt row. Refusing a caller's mutation is not the promise. Not sharing the object
is.

`SergentResult` is generic over the application's Scene type, because it carries the final
Scene. That is exactly why it stays outside the portable Run Record, which must have one shape
in every implementation. Observer delivery errors also reach the application through the
result, in its `observer_errors` field; the
[execution model](../../sergent/docs/execution-model.md#run-record-ownership-and-observer-delivery),
in "Run Record ownership and observer delivery", explains why they stay beside the record
rather than inside it.

The clock is an injected seam. `RecordClock` asks for wall time and monotonic time, and
`SYSTEM_CLOCK` supplies the platform answer. Handing a builder tree a scripted clock instead
makes recorded timing deterministic without changing the code under test.

### Where a change belongs

- An inert evidence shape belongs to `records`.
- A live view or a callback interface belongs to `observer`.
- A projection rule belongs to `capture`.
- A construction or lifecycle rule belongs to `recording`.
- Execution order, cancellation authority, commit, and callback delivery belong to
  [`sergent-ts-runtime`](../../sergent-ts-runtime/README.md).
- Line encoding, application and user event lines, and file lifecycle belong to
  [`sergent-ts-run-record`](../../sergent-ts-run-record/README.md).
- Identities, typed model evidence, Execution Plans, and Patches belong to
  [`sergent-ts-core`](../../sergent-ts-core/README.md).

The same division decides where each behavior is proven. Tests here establish that
construction stays truthful: that each Run shape produces the record the specification
requires, that refused constructions stay refused, and that capture degrades and fails exactly
where it should. Delivery order and exception containment are proven in runtime, and
persistence in the harness component. When one of those behaves unexpectedly, the answer is in
that component, not in this one.

## Observability practices

### Watch a Run without steering it

Implement `RunObserver`. It has two synchronous methods. `progress` receives a snapshot for
each stage the Run reaches, plus one final snapshot that repeats the last stage with the
terminal status; `finished` receives the `SergentResult` once. The
[observability specification](../../sergent/docs/observability.md#observer-delivery) fixes that
order in "Observer delivery". Pass your observers to the runtime when you configure a Run.

Keep the callbacks quick, because they run synchronously inside the Run. An observer cannot
change a stage, cancel work, or alter a record. A callback that throws is contained: the
failure is collected as an observer error beside the record in the result, the remaining
observers still receive the value, and the Run's outcome does not change.

### Read progress while the work is going

`ProgressSnapshot` is the view for a caller who started a Run and wants to show something
before it finishes. `createProgressSnapshot` fills a small fixed set of fields and copies only
the Scene ID and the revision out of the Scene identity, so no Scene content, prompt, or model
output can reach a snapshot by construction. That makes it safe to put on a screen or into an
ordinary application log. Runtime also exposes the current snapshot on the handle it returns,
so a caller can read progress without registering an observer at all.

### Read the closed record from the result

`SergentResult` has three shapes: successful, failed, and cancelled. Nothing on the result
itself marks which one you hold, so read the closed record's outcome status to learn how the
Run ended. That check narrows the outcome value alone and not the result, so code that needs a
specific record shape selects it with a type predicate over the record, the way
`createSergentResult` picks the shape it builds. For the ending message and metadata, read
`terminal_message` and `terminal_metadata` directly, remembering that a successful Run may
carry no message.

### Persist records by adding the harness

File persistence is opt-in and needs the Node file APIs that a runtime such as Bun supplies,
so it belongs outside the browser. An application on such a runtime adds the harness from
`sergent-ts-run-record` to the same observer list, and Run Record files start appearing.
Nothing here learns about files.

### Handle records as sensitive material

The [observability specification](../../sergent/docs/observability.md#sensitivity) lists what
a record can contain in "Sensitivity" and leaves directory, access, retention, and redaction
to the application. Progress is the counterpart meant for wider display. Persisted records are
evidence to read, never values to load back into a running program.
