# sergent-ts-runtime knowledge

`sergent-ts-runtime` turns one configured Run into one bounded transaction over a Scene. This
document explains how the component materializes the Sergent execution model in TypeScript.

## One Run from beginning to end

The [execution model](../../sergent/docs/execution-model.md#the-sergent-run-flow), in "The Sergent
Run flow", lists every step in order, and its
[Stages and Status](../../sergent/docs/execution-model.md#stages-and-status) section fixes the
stage names and the terminal statuses. What follows names the pieces that carry each move.

### Construction fixes the shape

Two builders cover the three Run Kinds. `configureIntentOnlyRun` returns an
`IntentOnlyConfiguredRun`; `configurePlanCapableRun` returns a `PlanCapableConfiguredRun`, and the
Intent source it receives decides between the two model-backed phases and the pass-through fast
path. What a builder fixes as a type, never as a runtime check, is whether the Execution Plan
phase is reachable at all: an Intent-only configuration accepts only a Recipe whose Intent type is
fixed to stop.

Construction copies every fact execution can later reach: the model invocation method bound from
the `ModelClient`, the model name, the Intent and Execution Plan `ModelSettings`, the proposal
schema and decoder or the deterministic pass-through proposal, the Recipe methods, the Operation
Registry with its Plan Proposal Schema, the `SceneActions` methods including the optional rebase,
the optional embedded-identity check, and the observer slots in their configured order.

Copying binds method identities. Replacing a method on the Recipe, on `SceneActions`, or on the
`ModelClient` after a builder returned does not change a configured Run. Schemas and settings stay
the exact core values the caller handed in, never a re-derivation, which is how this component
keeps the unchanged-schema promise of
[Construction-time capture](../../sergent/docs/execution-model.md#construction-time-capture).
Those copies guard against a later caller change. They are not a deep freeze of trusted readonly
values, and they do not pretend to be one.

The Recipe authors messages, never a request. Runtime combines them with the captured model name,
settings, and schema, so a substituted schema has no way in and needs no separate check.

The pass-through proposal travels under a private module symbol, so `passThroughIntentSource` is
the only producer of that source. Application code cannot forge one.

Wiring mistakes fail at the line that made them. A second `invokeRun` on the same configured Run
throws, and so do an embedded-identity delta other than one and a shared revision that is not a
nonnegative safe integer. These are construction errors, not a new input boundary, a distinction
the [trust boundary specification](../../sergent/docs/trust-boundaries.md#the-trust-rule) draws
in "The trust rule".

### Scene identity comes first

`invokeRun` consumes the single-use executor, mints the Run ID, creates the delivery object, emits
queued progress, and starts the pipeline before handing back the handle. The pipeline runs
synchronously up to its first await, so Scene binding, Run Record opening, the observation, and
Target selection are already done when the caller receives the handle.

Binding comes before anything else. A plain value is cloned through `SceneActions` into the Run
base snapshot. A `SharedSceneAuthority` answers with one isolated read: the base snapshot plus the
external revision. The recorded identity then pairs the Scene ID from the Scene's embedded
identity with that external revision, and the embedded identity is kept separately for the
optional consistency check.

This ordering has one consequence worth memorizing. A binding failure is the only failure the
design admits as a rejection of the result Promise, because inventing a Scene identity would make
the evidence false. Progress stays at queued, so a caller inspecting the handle after a rejection
sees a Run that never started. Once binding succeeds, the Run Record builder from
`sergent-ts-observability` opens, the Run can always close truthfully, and every later exception
becomes a contained internal error inside a resolved result.

### Observation, Target, and the two model crossings

Runtime calls `MindBuf.export()` once and captures the rendered text as evidence on the Run's
first step. `SceneActions.selectTarget` then picks one Target from the Run base, and that value
reaches Intent derivation, Execution Plan derivation, Patch validation, `apply`, `verify`, and any
rebase unchanged. The [framework](../../sergent/docs/framework.md#target-ownership), in "Target
ownership", fixes why it is never reselected. When selection returns nothing, the Run fails at the
`started` stage with the error the Recipe declares, before any model call and before any mutation.

Both model crossings follow one path. Runtime builds an immutable request from the captured schema
and settings through core's `createModelRequest`, opens a model call record on the current Step
Record, and races the `ModelClient` Promise against the caller's `AbortSignal`. A successful
transport outcome still carries untrusted parsed JSON, so the captured decoder admits it once, and
only then does the record hold a typed proposal. The stage stays at the call through that
crossing, which is why invalid model output fails at `intent_call` or `plan_call` with provider
evidence and no proposal evidence.

A pass-through source skips the Intent crossing entirely and hands over its trusted proposal.
Derivation and validation then run identically for both sources. A validated stop closes the Run
successfully at the `intent` stage with the base revision unchanged.

### Checks, rehearsal, and commit

After a continuing Intent, core's Operation Registry decodes the Plan Proposal envelope into
ordered steps and mints one Operation ID per step, so the model chooses which Operations to
request but never supplies their identities. The Recipe derives the Execution Plan. Admissibility
then visits each step in order, hands every registry callback an isolated step and a fresh clone
of the same base Scene, and stops at the first rejection. The Recipe judges the whole Execution
Plan afterwards. Keeping those two judgements separate is what the
[Operation Admissibility flow](../../sergent/docs/execution-model.md#operation-admissibility-flow)
section asks for.

The Recipe compiles the validated Execution Plan into a Patch. Runtime isolates that Patch and
captures one Patch summary at that moment through observability's `projectPatchSummary`. The
summary stays authoritative for the Run Record and for conflict evidence even if an application
callback later mutates the operands it received. Validation then proves that the script is
nonempty, that the Execution Plan and Patch bases equal the Run base, that every planned step
survives in order with its call and its Operation ID, and that the exact Target still exists.

The dry run clones the base once, hands `SceneActions.apply` an isolated complete Patch, and lets
application code walk the ordered script over that single evolving candidate. `SceneActions.verify`
then judges the whole before-and-after transition. The optional embedded-identity check runs here
too, under the rule in
[Revision representation](../../sergent/docs/execution-model.md#revision-representation). It is
independent of stale protection: enforcing the embedded advance and guarding shared live state are
separate choices, and picking one buys nothing from the other.

Everything from Patch validation to the end of commit is synchronous. No `await` sits in that
region, so a caller abort can never land in the middle of a commit, and no cancellation checkpoint
belongs there.

### Who commits

A plain Scene is already a private snapshot, so a successful dry run becomes the returned Scene
under the `plain` commit kind, with no comparison against live state. Excluding other writers for
the whole Run is then the application's duty; the
[Writer model and revision policy](../../sergent/docs/framework.md#writer-model-and-revision-policy)
section explains why serializing completed writes alone does not make overlapping Runs serial.

`SharedSceneAuthority` is the alternative. You construct it with the initial Scene, its revision,
the `strict` or `rebase` policy, and a clone function, and all four are fixed before any other
holder of that authority exists. Its public surface offers `read` and `advance` only. Installation
and policy reading stay inside the `scene-authority` unit, which narrows authority by construction
identity rather than by a permission check. Every successful install or advance raises the
external revision exactly once, and installation compares the revision again after cloning, so an
advance landing inside the install still loses the commit.

When the external revision still equals the Patch base, runtime installs the rehearsed candidate
as an `exact` commit. Under `strict`, any advance produces a stale-Patch failure with no mutation.
Under `rebase`, `SceneActions.rebase` may replace operands deterministically against current state
while runtime keeps authority over the result: the replacement base must equal current identity,
the call and Operation ID sequence must be unchanged, every replacement Operation must decode
through its original registry definition, and the exact Target must still exist. Admissibility
reruns against the current Scene, and the replacement is rehearsed and verified there. The model
never takes part; the
[Patch rebase on shared live state](../../sergent/docs/execution-model.md#patch-rebase-on-shared-live-state)
section fixes that rule.

Five situations reach the merge-conflict vocabulary: a `rebase` policy whose `SceneActions`
supplies no rebase method, an application that declares a conflict, a rejected replacement, a
failed replacement rehearsal, and an advance landing after the rebase read. Each one carries the
base revision, the current live revision, and the Patch summary captured before any application
callback ran, beside whatever Scene facts the rejecting step produced. A rejected check nests its
evidence under a name for the rejecting check, `patch_validation`, `operation_admissibility`, or
`dry_run`, rather than a Run error kind, so nothing flattens into the framework mapping.

Whatever path a Run takes, a failure or cancellation before commit returns the Run base snapshot.
Shared state may already hold newer unrelated work, but that work is not this Run's result.

### Closing out

Runtime builds the Sergent Result from the closed Run Record. Delivery drives progress and the
finished callbacks on the way out, under the rules in
[Observer delivery](../../sergent/docs/observability.md#observer-delivery) and
[Progress snapshots](../../sergent/docs/observability.md#progress-snapshots); runtime neither
extends nor trims the snapshot fields.

## Architecture and dependencies

Four units stand behind one package facade, and each answers a different question.

- `execution` is responsible for the configured Run and its single-use lifecycle. It captures
  configuration, starts invocation, advances stages, drives both proposal phases, coordinates
  cancellation, and keeps the open Step Record aligned with the terminal result. It coordinates
  only: no proposal schema, no Scene behavior, no exception projection, no evidence shape, no
  transport.
- `scene-authority` is responsible for the mutation boundary. It binds a plain snapshot or a
  shared live authority, isolates Patch data before every application callback, validates Patch
  identity, rehearses the transition, and performs plain, exact, or rebased commit.
- `exception-evidence` is responsible for projecting a contained thrown value into a structured
  error. It renders the native type and message, bounds the stack tail, guards the cause chain
  against cycles, and builds the metadata the specification names for an internal error and for an
  observer error. It decides nothing about what to contain.
- `delivery` is responsible for the Run handle, the current sanitized progress, the ordered
  observer slots, terminal result construction, and observer-error accumulation. It carries
  evidence outward and can never change execution truth.

One responsibility never spreads across two units. A change that fits no unit is a sign that the
responsibility itself needs rethinking.

The dependency list is short on purpose. Runtime depends on
[sergent-ts-core](../../sergent-ts-core/README.md) and
[sergent-ts-observability](../../sergent-ts-observability/README.md), and on no third-party
package at all. It uses standard Web APIs only, so the same source type-checks for a browser main
thread and for a worker as well as for a server, and it ships TypeScript source through a single
package entry.

Two absences matter as much as the dependencies. No provider SDK enters the import graph: an
application injects its adapter through core's `ModelClient` interface, which is why
[sergent-ts-providers](../../sergent-ts-providers/README.md) and
[sergent-ts-webllm](../../sergent-ts-webllm/README.md) can serve the same Run without runtime
knowing that either exists. No filesystem enters it either:
[sergent-ts-run-record](../../sergent-ts-run-record/README.md) joins a Run as an ordinary observer
and writes Run Record files from outside.

Applications supply the rest: concrete Scenes, Recipes, Targets, MindBuf snapshots, observers,
loops, budgets, human waiting, persistence, and fan-out. An application fans out by starting
separate Runs, which leaves this component responsible for exactly one bounded transaction.

## Working with the core component

The split between core and runtime is easy to state. Core supplies the vocabulary and the strict
decoders: immutable requests, the `ModelClient` interface, proposal definitions with their
decoders, the Operation Registry, the Recipe interfaces, and the `SceneActions` interface. Runtime
supplies order, timing, cancellation, isolation, and commit authority. Core runs no pipeline and
reads no clock; runtime defines no schema dialect and no domain semantics.

Model output is where the two meet. Core performs the strict admission, and runtime decides when
that admission happens and what a rejection means for the Run. Runtime never re-validates a value
core already admitted, never reparses a core value, and never re-proves a schema it captured at
construction.

That restraint follows the
[trust boundary specification](../../sergent/docs/trust-boundaries.md#the-five-boundaries). Of the
five listed in "The five boundaries", runtime stands at exactly two. Model output is the first:
provider JSON becomes typed values at most twice per Run. Shared live state at commit is the
second, and it is the framework's single sanctioned re-validation. When a validated Patch meets a
revision it did not observe, this component repeats admissibility and rehearsal because the Scene
changed, not because the earlier types became doubtful; the
[Fourth, shared live state at commit](../../sergent/docs/trust-boundaries.md#fourth-shared-live-state-at-commit)
section states that case.

Isolation is a separate idea, and confusing the two produces defensive code that earns nothing.
Runtime clones Patches, steps, and Scenes before application callbacks so that a mutation cannot
rewrite evidence or the input of the next check. Scene binding and shared reads return isolated
clones, a shared install keeps the retained copy separate from the returned one, and a rebase
preserves the exact Target and the Operation ID sequence while cloning replacement data. None of
that expresses distrust of the typed values, and none of it adds a boundary. Transient contexts
and result envelopes need nothing beyond readonly construction, because runtime assembles them
from values that are already isolated and discards them with the Run.

## Side effects and reliability

Expected failure is a value here, never an exception. A rejected proposal, a failed semantic
validation, a stale Patch, a merge conflict, and a cancellation all resolve the result Promise
with a Sergent Result that names the terminal status, the last reached stage, and a structured Run
error. Scene binding, described above, is the one case the design admits as a rejection.

Unexpected exceptions are contained rather than propagated. The `exception-evidence` unit turns a
thrown value into an internal error carrying the native type, a rendered message, a bounded stack
tail, and a cycle-guarded cause chain, correlated with whichever step was open. A throwing
observer callback becomes an observer error recorded beside the closed Run Record. Delivery
continues to the later slots, the errors accumulate, and each finished callback sees the ones
recorded before it.

`AbortSignal` is the only cancellation vocabulary, and its checkpoints are named values rather
than scattered checks: `before_intent` for a model-backed Intent call, `after_intent_validation`
between Intent validation and the stop-or-continue decision, `before_dry_run`, `before_commit`,
and `task_cancelled` for either model await. The Run Record stores the reached checkpoint, so a
reader learns exactly where cancellation landed. During a model await, a provider adapter may
answer with a cancellation outcome carrying evidence from an earlier completed attempt, and
runtime lets that mapped outcome settle before falling back to its own interruption result. When
the provider call stays parked instead, the Run closes with request-only evidence and fabricates
no attempt.

Runtime itself retries nothing, and that is a deliberate division. In-call retry belongs to the
provider transport, where the fault is visible. Run-level retry belongs to the application, which
starts a fresh, full-strength Run and decides its budget. The reliability guide sets the options
out in
[Run-level retry postures](../../sergent/docs/reliability-best-practices.md#run-level-retry-postures),
and its [Execution engine](../../sergent/docs/reliability-best-practices.md#execution-engine)
section explains why containment replaces retry once a call enters the engine.

### How the promises are proven

Runtime's promises are about ordering and concurrency, which makes timing-based tests worthless.
Every concurrency case is proven with parked Promises and deterministic gates instead of sleeps,
so a proof either holds on every machine or fails on every machine. Tests enter through the
package facade wherever a behavior is visible there, and assert results, committed Scene state,
stage and Step Record order, progress snapshots, and the shape of outgoing model requests. Fakes
stand in for providers and Scenes, and each one behaves like the interface it replaces, so no live
provider, credential, network, or filesystem is ever involved.
