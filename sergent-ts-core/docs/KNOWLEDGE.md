# sergent-ts-core knowledge

Core is the foundation component of the Sergent TypeScript implementation. This file explains how
it is put together and why each piece sits where it does.

## The Chi of core

Core has one character, and it is easy to state: core carries the **nouns** of a Sergent Run and none
of the **verbs**. It cannot start a Run, wait for anything, or change a Scene. Everything it produces
is either readonly data or an interface that an application or a component above core implements,
and no code path in it branches on its environment.

That restraint is what keeps the components above composable. Order, cancellation, rehearsal, and
commit authority live in the runtime component. Transport lives in the adapters. Evidence lives in
observability. Core stays the one place where all of them agree on what the words mean.

### Seven units, one direction

A unit here is a directory module that publishes a facade. A sibling unit imports that facade and
nothing behind it. Core groups its work into seven units behind one package facade, and their
dependencies point one way, from general values up to application policy.

- `values` depends on no sibling. It carries readonly JSON values, the Run ID and Operation ID the
  framework mints, the Scene ID grammar an application fills, the Intent control vocabulary,
  structured `RunError` values, and the `ValidationIssue` an application reports.
- `schema` depends on `values`. It proves that a TypeBox schema belongs to the canonical dialect,
  keeps the exact named schema a request carries, and admits untrusted model data strictly.
- `operations` depends on `schema` and `values`. It defines Operations, closes them into a
  registry, composes the Plan Proposal envelope, decodes a proposed Operation sequence, dispatches
  admissibility, and compiles an `ExecutionPlan` into a `Patch`. It also decodes one replacement
  Operation against an expected call, which is what a deterministic rebase needs in order to change
  operands without inventing a new call.
- `model-request` depends on `schema`. It builds portable messages and images, the settings for one
  model phase, and the immutable `ModelRequest`.
- `model` depends on `model-request` and `values`. It holds the closed transport failure
  vocabulary, completed attempt evidence, the truthful `ModelOutcome` states, and the asynchronous
  `ModelClient` interface. No provider SDK type reaches it.
- `scene` depends on `operations` and `values`. It declares `MindBuf`, `Target`, and the
  deterministic `SceneActions` seams, together with the result values for application,
  verification, and rebase. It supplies no Scene and no commit rule.
- `recipe` depends on `model-request`, `operations`, `schema`, `scene`, and `values`. It carries
  the two Recipe shapes, the pass-through sentinel, validation results, terminal stop data, and the
  mechanical defaults for Execution Plan derivation and Patch compilation.

One missing edge says as much as the seven present ones: `recipe` does not depend on `model`. A
Recipe authors the content of a request and interprets a decoded proposal, but it never invokes a
client and never reads an outcome. The two upper branches therefore stay independent. `model` adds
transport meaning to a request, `recipe` adds application policy around it, and the two meet at
`model-request` without either reaching into the other.

### The key values, expressed in TypeScript

A Run reaches at most two model phases, and core spends that budget through two Recipe shapes.
`createIntentOnlyRecipe` produces a Recipe with no registry that can only stop.
`createPlanCapableRecipe` produces one with a nonempty registry that may stop or continue into the
Execution Plan phase. Neither shape has a concept for fan-out or looping, because the
[framework specification](../../sergent/docs/framework.md#a-run-has-at-most-two-proposal-phases),
in "A Run has at most two proposal phases", leaves those flows to the application above. Budgets
and human approval are equally absent from both shapes.

The model proposes, and the framework keeps its own books. Registry decoding mints a fresh
Operation ID for every accepted Operation, so identity comes from `values` and never from the
answer, exactly as the
[framework specification](../../sergent/docs/framework.md#operation-identity) requires in
"Operation identity". Unknown calls, unknown fields, and invalid operands fail at that same step,
without repair.

One selected Target follows a Run from start to finish, and core expresses that rule by omission.
No Intent, `ExecutionPlan`, `Patch`, or Operation value carries Target identity or Target-specific
context. The runtime selects the Target once and then hands that same value to the Scene Actions
that act on it and to every admissibility check, beside the data. The
[framework specification](../../sergent/docs/framework.md#target-ownership), in "Target ownership",
is the normative home of that rule, and the
[execution model](../../sergent/docs/execution-model.md#the-target-during-execution), in "The
Target during execution", shows how one Run keeps one selection from one place.

Core reduces Observation to one read. `MindBuf` declares a single export that returns text, and a
Recipe hook receives that text rather than the snapshot object, so no hook can refresh or mutate it
mid-Run. Core adds no storage, refresh, or retention rule here.

Core is responsible for exactly one of the five crossings the
[trust boundary specification](../../sergent/docs/trust-boundaries.md#the-five-boundaries) lists in
"The five boundaries": model output. Human input and persistence load belong to the application,
external transport to the adapters, and shared live state at commit to the runtime. Core's
construction checks are not a sixth boundary. They prove that a developer wired the framework
correctly, and they run before any provider is called.

## The technical design

### One schema, one authority

TypeBox is the single schema author, and core re-exports its `Type`, `Static`, and `TSchema` so an
application authors schemas with the same library rather than a second copy.
`createProposalDefinition` keeps the exact object it receives by identity and compiles one
validator beside it.

Composition derives new schema objects at construction. An Operation definition renders its operand
schema into a closed Operation schema with the call discriminator in front, and the registry
renders each of those into one branch of the Plan Proposal envelope, hoisting shared local
definitions to the root. From that moment the derived object is the single authority: the registry
that composes the envelope is the registry that decodes against it, and nothing renders a second
copy of a schema already in use. That is what keeps generation and admission from drifting apart.

The canonical dialect proof runs at construction as recursive passes over the TypeBox object, one
for the keyword vocabulary, one for the local definitions, one for reference resolution, and one
for cycles. It rejects every unsupported form rather than weakening it, and it rejects a reference
that resolves to nothing along with a cycle among local definitions. Proposal and definition names
take 1 to 64 ASCII letters, digits, underscores, or hyphens. The
[framework specification](../../sergent/docs/framework.md#canonical-schema-dialect) lists the
admitted keywords in "Canonical schema dialect"; core decides only how the proof runs.

Branches that share a local definition of equal shape are merged, and two branches that give one
name to different shapes are rejected. The envelope itself, with its nonempty Operation list and
its optional maximum, belongs to the
[framework specification](../../sergent/docs/framework.md#operation-registry-and-the-plan-proposal-envelope),
in "Operation Registry and the Plan Proposal envelope".

### Construction proves; decoding admits

Core splits failure into two kinds, and the split follows a single question: can a caller branch on
it usefully?

Expected failures are values, not exceptions. Proposal decoding, Plan Proposal decoding, Recipe
validation, Operation admissibility, Scene application, rebase, and model calls each return a union
that one field selects: `ok` everywhere except two, `kind` for a rebase and `status` for a model
outcome. Verification is the one variation, since it returns a report whose issue list is empty when
the Scene is clean. A failing member carries a `RunError`, or the `ValidationIssue` an application
reported, and callers branch on that error's `kind` and `metadata`. The human-readable message is
written for people and may change.

Wiring mistakes throw. A schema outside the dialect, an invalid name, an empty call, an operand
schema that declares the reserved call field, a duplicate call in a registry, an empty registry, an
Operation maximum that is not a positive integer, two branches that give one name to different
shapes, a definition that the factory did not build, or a typed Operation dispatched to a registry
that does not contain it: each is a programming defect that no caller can handle, so it fails at
the line that made it. The request and outcome constructors fail the same way, so an application
checks human text and image bytes at its own boundary before it builds a message.

### Facades, and values only a factory can build

Each unit publishes explicit named re-exports and keeps its machinery inside. The package facade
then curates one public surface from those units. The dialect proof, the Plan Proposal schema
composer, and the registry dispatch tables stay internal; an application sees constructors,
interfaces, and result types.

Two techniques keep that surface honest. Private mechanics live in a side table keyed by the value
itself, which is how an Operation definition carries its derived Operation schema without showing
it; a definition that the factory did not build has no entry, so it cannot enter a registry. Values
whose validity depends on construction carry a private symbol as proof: Operation definitions,
messages, images, phase settings, completed attempts, model outcomes, and transport errors. A
hand-written literal cannot impersonate them, and a downstream component can therefore trust the
shape without checking it again.

### Two lifecycles meet at the request

`model-request` holds the facts that are fixed before a call: message content, model selection, the
exact Proposal Schema, and the phase settings. `model` holds the facts a call creates: endpoint
identity, completed attempts, response evidence, usage, failure kind, cancellation, and the final
outcome. `ModelRequest` is the only link between the two, which is why neither unit needs to know
the other's states.

The division also assigns authority. The runtime selects the model and the settings; a Recipe
authors messages and reads the captured Proposal Schema, and it cannot replace the model, the
settings, or the schema. Settings require a positive integral output-token bound, a positive
integral timeout, and a thinking effort of low, medium, or high. Message rules are equally plain:
an optional leading system message, one or more ordered user messages, nonempty text, and images
only on user messages. PNG is the only image media type, each image is bounded at one million
decoded bytes, and the bytes become base64 at construction so no caller keeps a mutable view of
them.

### Evidence that cannot lie

The outcome constructors make an impossible history unrepresentable. A success, and any failure
that reached the provider, records one completed attempt, or two when the first failure was
retryable. A failure takes one of three truthful shapes: one that reached no provider attempt and
carries one of the three pre-attempt transport kinds, one that completed an attempt without
response evidence, and one that retains the text, optional parsed JSON, and usage it actually
reached. Cancellation keeps no row for the interrupted attempt, may retain one earlier retryable
failure, and then requires a resolved provider identity. Evidence that was never reached is null,
never invented, and one shared projection lets consumers read those facts without restating the
state rules.

Retryability follows the closed transport kind and nothing else. Transport construction derives the
retry fact from the kind and writes it into the error metadata, so an adapter cannot widen the
framework's retry budget by describing a failure differently. `ModelClient` resolves every expected
outcome instead of rejecting, which leaves rejection to mean a genuine defect.

### Isolation is about mutation, not doubt

Readonly types say that a value must not be changed. Isolation is the separate job of making sure
that nobody still can. Core copies at capture: a registry takes its definition list, a message
sequence its messages, an `ExecutionPlan` its steps, a Verification Report its issues. `Patch`
compilation goes further and clones every step structurally, including nested operands, so a later
mutation of the decoded proposal cannot reach a rehearsed or committed script. Error and rebase
metadata are cloned for the same reason.

Some identities are shared on purpose: the exact schema object, the selected Target, and a
replacement Patch from a rebase are meant to be the same value on both sides. None of this copying
is a second validation. It decides who may mutate what, and the trust rule stays intact.

### What core leaves to others

The boundary of this component is easiest to read as a list of refusals. Core runs no execution
loop and holds no commit authority, calls no provider SDK, records nothing, touches no filesystem
and no network, holds no Scene and no persistence, and checks no human input. Each of those duties
belongs to a component above core, or to the application:
[sergent-ts-runtime](../../sergent-ts-runtime/README.md),
[sergent-ts-providers](../../sergent-ts-providers/README.md),
[sergent-ts-webllm](../../sergent-ts-webllm/README.md),
[sergent-ts-observability](../../sergent-ts-observability/README.md), and
[sergent-ts-run-record](../../sergent-ts-run-record/README.md).

### What the tests here can prove

Core tests need no fakes at all. The component performs no input or output and holds no clock, so
every test constructs its values directly and enters through the unit facades rather than reaching
into files. That makes them cheap, and it also marks the limit: a test here can prove the dialect
proof, schema identity, strict decoding without repair, registry composition and its count bounds,
Patch isolation, truthful attempt histories, retryability, and the error kinds consumers branch on.
Provider behavior, Run order, observer delivery, and file persistence are promises of other
components and are proven there.
