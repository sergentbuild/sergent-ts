# sergent-ts-observability

A Sergent Run is one short, self-contained piece of agentic work. It leaves behind a complete
and honest account of what it did, and this component builds that account as the work happens.

## Every Run explains itself

Agentic software is hard to trust, because the interesting decisions happen out of sight. A
model proposes something, code turns the proposal into changes, and the caller sees only a
final answer. The Sergent Specification treats that gap as a design problem rather than an
afterthought: observability is a first-class part of the framework, and every Run that returns
a result closes with a Run Record that accounts for the whole Run in execution order. The
[Run Record specification](../sergent/docs/run-record-spec.md#the-run-record), in "The Run
Record", fixes that account field by field, so every implementation reports the same facts, in
the same form.

This component is where TypeScript builds that account. It also defines the values an
application meets directly: `ProgressSnapshot`, a small safe-to-show view of a Run still in
flight; `SergentResult`, what a finished Run returns; and `RunObserver`, the interface you
implement to watch a Run go by.

One promise holds the whole thing together: this component records and does nothing else. It
never picks a step, never cancels work, never changes the application state a Run works on
(its Scene), and a problem while capturing a value never fails the Run. The
[knowledge file](docs/KNOWLEDGE.md) shows how that promise is built into the structure rather
than merely declared.

## Where it sits

Three components divide the work, and the division is deliberate.

`sergent-ts-runtime` executes a Run. It drives the recording this component performs, and it
decides what happens next, whether a cancellation takes effect, and when a change becomes
permanent. This component supplies the shapes and the rules for building them; runtime
supplies the execution.

Writing Run Record files is a different job, so it lives in a different component,
[`sergent-ts-run-record`](../sergent-ts-run-record/README.md). The division pays twice. It
keeps this component clear of the filesystem: it needs only `sergent-ts-core` and standard Web
APIs, so the same code runs on a browser main thread and inside a worker. It also keeps
persistence behind the observer interface, so turning files on is something an application
adds, and a Run behaves identically when nothing is writing them.

## Putting it to use

An application meets this component in three places. Implement `RunObserver` to watch a Run
without steering it. Read the current `ProgressSnapshot` from the handle a Run gives you while
the work is still going; it is the view you can safely put in front of a user. Take the closed
Run Record from the `SergentResult` a Run returns, beside the final application state and the
ending message and metadata.

A Run Record is sensitive forensic material; the
[observability specification](../sergent/docs/observability.md#sensitivity), in "Sensitivity",
says what one can contain and leaves handling to the application.

The [knowledge file](docs/KNOWLEDGE.md) walks through the structure, the building rules, and
the capture behavior behind these practices.
