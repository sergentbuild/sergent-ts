# sergent-ts-core

Core is the foundation of the Sergent TypeScript implementation. It carries the vocabulary that
every other component, and every application, speaks.

## What core is

A Sergent Run is one bounded piece of work. The application keeps its state in a Scene, the
objects a Run may read and change. The Run shows a model part of that Scene, the model answers
with a proposal, deterministic code checks the proposal, rehearses it on a scratch copy, and then
commits or rejects it, much as a database transaction does.

Core supplies the parts of that transaction and none of the motion. It states what a Proposal
Schema is, the exact shape the model must answer in; what an Operation is, one allowed action on
the Scene; what a Patch is, the rehearsable script of those actions; what a model call may report;
and what a Scene must be able to do. A separate component runs the sequence.

The core component stays deliberately small. It reads and writes nothing, holds no clock, opens no
socket, and runs no loop. TypeBox is its single external library and supplies schema authoring.
Everything else is a standard Web API, so the same code type-checks for a browser tab, a worker,
and a server process.

Reading core feels closer to reading a dictionary than a program. You find constructor functions
that return readonly values, a few interfaces an application implements, and result types that
name every way a step can fail.

## How the specification becomes TypeScript

[The Sergent Framework](../sergent/docs/framework.md) is the rulebook, and core is one careful
reading of it in TypeScript. Three rules and one house style shape nearly everything here.

The model proposes; deterministic code decides. The
[framework specification](../sergent/docs/framework.md#the-model-only-proposes), in "The model
only proposes", fixes that rule, and core answers it with one object per phase.
`createProposalDefinition` turns your TypeBox schema into three things at once: the static
TypeScript type, the JSON Schema that travels with the model request, and the strict decoder that
admits the answer. `createOperationRegistry` composes the same three things for a closed set of
Operations. Whatever a definition or a registry holds is then the single authority, because the
object that goes to the model is the object that admits the reply.

Actions stay typed and closed. `defineOperation` binds one call name to one closed operand schema,
a registry closes the set of calls a model may use, and `SceneActions` is the only route from
Operation data to a real change. The route carries a `Patch`: an isolated, replayable script that
a Scene can rehearse before anything is committed.

Untrusted data crosses once. Model output is the single place where core admits runtime input, and
the [trust boundary specification](../sergent/docs/trust-boundaries.md#first-the-model-output), in
"First, the model output", explains why that crossing is enough. Decoding mints each Operation ID
locally instead of accepting bookkeeping identity from the answer. Everything core constructs
afterwards is trusted and never parsed again.

Failures a caller can act on are values. Decoding, Recipe validation, admissibility, Scene
application, rebase, and model calls all return discriminated result unions. A mistake in wiring
throws instead, at the line that made it.

## What the layers above build with it

Every component above core has one job, and core defines the interface it plugs into. `ModelClient`
is the single asynchronous interface for talking to a model, implemented by the Node adapters in
[sergent-ts-providers](../sergent-ts-providers/README.md) and by the in-browser adapter in
[sergent-ts-webllm](../sergent-ts-webllm/README.md).
[sergent-ts-runtime](../sergent-ts-runtime/README.md) executes the Run, and it alone decides order,
cancellation, rehearsal, and commit authority.
[sergent-ts-observability](../sergent-ts-observability/README.md) records what happened without
ever steering it, and [sergent-ts-run-record](../sergent-ts-run-record/README.md) turns that
evidence into files on Node.

For an application, core is where expressiveness comes from. You declare a proposal type, a set of
Operations, a Recipe that turns a proposal into a decision, and the Scene Actions, all in ordinary
TypeScript. The generic parameters then carry your Scene, Intent, Target, and Operation union
through every hook. One registry cannot mix Operations written against different Scenes, and a
hook cannot receive a Scene the registry was not built for, so a mistake that would otherwise
surface as a confusing runtime failure surfaces as a compile error instead.

One declaration produces both the model's vocabulary and your program's types, and the descriptions
you write on a schema travel to the model with it, as the
[framework specification](../sergent/docs/framework.md#semantic-rules-ride-the-schema) asks for in
"Semantic rules ride the schema". Complete applications, such as `sergent-ts-examples:grammary-x`,
are built from this vocabulary.

The [core knowledge](docs/KNOWLEDGE.md) file continues from here with the unit structure, the
design patterns, and the reasoning behind them.
