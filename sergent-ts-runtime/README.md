# sergent-ts-runtime

`sergent-ts-runtime` is the execution machine of the Sergent TypeScript implementation. It carries
one Sergent Run from its trigger to its result and keeps your application state safe on the way.

## One Run, one transaction

The state a Run may read and change is called the Scene. It is yours already: a document, a
project tree, a game world, whatever your application keeps in memory.

A Sergent Run reads that state, asks a model what to do, and then either applies every change at
once or leaves the state exactly as it found it. Nothing lands half-applied. The specification's
[execution model](../sergent/docs/execution-model.md#a-sergent-run-async-and-transactional) opens
on that picture, in "A Sergent Run: Async and Transactional". This component is what keeps the
promise.

The shape of a Run is decided before it starts, and the choice is a type rather than a flag. Every
Run begins with an Intent, its decision to stop or to go on. `configureIntentOnlyRun` builds a Run
that can only stop and report, with no Execution Plan machinery in it anywhere, so no wiring
mistake can turn it into a Run that mutates. `configurePlanCapableRun` builds a Run that can go on
to an Execution Plan, the ordered list of concrete changes the model proposes. Both builders take
either Intent source: a model-backed one, or `passThroughIntentSource`, which hands the Run a
fixed Intent Proposal instead of buying one from the model.

`invokeRun` starts a configured Run and returns a handle right away. The handle carries the Run
ID, a live view of progress, and the single Promise that settles with the Run's result. Your
program keeps serving users while the Run waits on the model.

The Scene you pass decides who holds commit authority. A plain value gives the Run a private
snapshot to work on. A `SharedSceneAuthority` gives it live state that other Runs may also touch,
under the strict or rebase policy you chose when you built that authority.

In between, this component does the careful part. It asks the model for proposals and admits them
as typed values. It checks every proposed Operation, one concrete action drawn from a list you
declared, against your state. It then rehearses the whole change on a throwaway copy. Only then
does it commit. Anything that fails earlier ends the Run with your state untouched, and the result
still tells you how far the Run got.

## Evidence that travels with the Run

Runtime never prints and never writes a file. While a Run advances, it builds a Run Record, the
ordered evidence of what happened, through
[sergent-ts-observability](../sergent-ts-observability/README.md), the component that defines what
that evidence looks like. Each stage the Run reaches, each model call it makes, and each check
that rejects something leaves a truthful trace.

A lighter channel runs beside it. Progress snapshots carry sanitized Run metadata, so an interface
can show movement without seeing prompts or Scene content. Observers you register receive those
snapshots while the Run advances, and the finished result at the end. Evidence leaves a Run
without ever steering it.

Because delivery works through plain observer callbacks, anything that wants a durable copy joins
from outside. That is how a harness that needs Node file APIs writes Run Record files while
runtime itself stays free of any filesystem.

The [runtime knowledge](docs/KNOWLEDGE.md) walks through the complete design: the units, the
checks, the commit authority, and the reliability rules.
