# sergent-ts-webllm

This component lets a Sergent Run call a model that runs inside the visitor's browser, on their
GPU. No inference server, no API key, and no text leaving the machine.

## What it makes possible

Every Sergent Run asks a model for structured proposals and then lets deterministic code decide
what to do with them. This component supplies such a model with no provider account behind it.
The weights download into the browser, inference happens on WebGPU inside a dedicated worker, and
the answer returns through the same interface the rest of sergent-ts already speaks.

One call, `createWebLlmSession`, hands the application a session. Its `client` is core's
`ModelClient`, so a Run calls a local model exactly where it would call a hosted one. The swap is
a wiring change rather than a rewrite, as long as the request stays inside the narrow slice this
component serves.

The potential here is large. An agentic application can ship as a static site, cost nothing per
token, keep answering after the first download with no network, and handle text that never has to
reach a third party. This is also the one part of Sergent that only the TypeScript implementation
can offer: the Python, Go, and Rust implementations have no equivalent, because no other
implementation ships its model to the user by having them open a page.

Treat it as young technology. WebLLM is at an early stage and so is this component, which pins
one engine release and stays inside a narrow, qualified slice of it. The demo application that
shows the whole idea working is `sergent-ts-examples:grammary-x`.

## WebLLM in one minute

[WebLLM](https://webllm.mlc.ai/) is an open-source in-browser inference engine from the MLC
project. It runs a model that the MLC toolchain compiled ahead of time into a WebAssembly
library, downloads that library and the weights into the browser cache, and answers chat
completion calls that follow the OpenAI chat completion shape.

It asks a lot of the page in return: a secure context, a browser and a driver with working
WebGPU, a dedicated worker so the main thread stays responsive, and patience for a first run that
must download the whole model before it can answer anything. Browser support, engine releases,
and the small models worth hosting all move quickly. That pace is the main reason this component
keeps its promises narrow.

## Why WebLLM is a separate component

[sergent-ts-providers](../sergent-ts-providers/README.md) calls an endpoint: a request sent from
Node through the vendor's official SDK to a model that already runs somewhere else. That
somewhere else can be a data center or your own laptop, since an Ollama server is still an
endpoint. This component hosts the engine itself, inside the page. The line runs between an
endpoint you call and an engine you host, and it decides everything else. A browser build that
selects this component pulls in no Node SDK, and a Node build pulls in no browser worker
machinery. The package boundary makes that mechanical instead of a matter of discipline.

The lifecycles differ just as much. A call to an endpoint is one request and one reply. A local
model must be selected, downloaded, initialized, and held in GPU memory, so a session here is a
heavyweight thing with a load, a readiness state, and a final close. Failure differs too. A
transport that reaches an endpoint can absorb a transient fault by asking again, while a local
engine either has a healthy worker or has none.

Both arrive at the same place. Each implements core's `ModelClient` interface, and the runtime
treats them identically.

[Knowledge](docs/KNOWLEDGE.md) explains how the bridge works: the session lifetime, the strict
native boundary, the integration steps, and the edge cases worth knowing before you ship one.
