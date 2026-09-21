# sergent-ts

sergent-ts is the TypeScript reference implementation of the Sergent Specification. It gives you a
ready-to-use framework for agentic applications in which the user stays in charge of the data.

## Introduction

Sergent describes agentic software in which a user and AI agents work on the same data, and no
agent changes that data without passing a strict, predictable checkpoint. The Sergent
Specification records this idea as a vision, a set of software design patterns, and a rulebook.
It is language agnostic and contains no code. Its [overview](sergent/docs/KNOWLEDGE.md) tells the
whole story in a few minutes; "The Story of One Run" is the best place to start.

sergent-ts turns that rulebook into concrete, idiomatic TypeScript. It serves two readers:

- Application builders receive a framework. Install the packages, describe your data and your
  agent's policy, and start Runs.
- Implementers receive a reference. The source shows one complete way to materialize the
  specification, in case you plan an implementation in another language.

An application built with sergent-ts has this shape:

- Your data is a Scene. You wrap it in a `SceneActions` object: deterministic functions that
  identify the Scene, clone it, select the Target a Run may affect, apply a change, and verify the
  result.
- The actions a model may propose are Operations. You declare each one with `defineOperation`
  and collect them with `createOperationRegistry`.
- Your agent's policy is a Recipe, built with `createPlanCapableRecipe` or
  `createIntentOnlyRecipe`. It writes the messages the model reads and validates what the model
  proposes.
- A `ModelClient` reaches the model. `sergent-ts-providers` creates one for OpenAI, Anthropic,
  Google, or Ollama. `sergent-ts-webllm` creates one that runs the model inside the browser.
- `configurePlanCapableRun` or `configureIntentOnlyRun` captures these pieces, and `invokeRun`
  starts one Run. The model only proposes; the runtime decides, and a Run that does not reach
  commit leaves your Scene unchanged.
- A Run resolves to a `SergentResult`: the final Scene plus a `RunRecord`, the ordered evidence
  of what happened. `createRunRecordHarness` writes that evidence to a file when you opt in.

Two worked examples live in a separate repository: the level editor `sergent-ts-examples:ghoul`
and the browser playground `sergent-ts-examples:grammary-x`.

The [project knowledge](docs/KNOWLEDGE.md) continues from here. It walks through the whole project
and leads you into each component.

## Project structure

The repository is a Bun workspace of six components. Each component is one package, with a README
that introduces it and a knowledge file that explains its design.

- [sergent-ts-core](sergent-ts-core/README.md) provides the vocabulary every other component
  speaks. It performs no I/O.
- [sergent-ts-runtime](sergent-ts-runtime/README.md) is the execution machine. It runs one Run as
  a transaction, from observing the Scene to commit.
- [sergent-ts-observability](sergent-ts-observability/README.md) builds the evidence of a Run
  while the Run advances, and defines progress snapshots, results, and observers.
- [sergent-ts-run-record](sergent-ts-run-record/README.md) writes that evidence to JSON Lines
  files on a Node filesystem.
- [sergent-ts-providers](sergent-ts-providers/README.md) reaches OpenAI, Anthropic, Google, and
  Ollama models through their official SDKs.
- [sergent-ts-webllm](sergent-ts-webllm/README.md) reaches a WebLLM engine that the application
  hosts inside the browser page.

The Sergent Specification lives under [sergent/docs](sergent/docs/KNOWLEDGE.md), included so that
every document here can cite it.

## Installation

### Add the libraries to your application

[Install Bun](https://bun.com/docs/installation), then add the packages your application
imports. There is no umbrella package. An application on Bun typically starts with:

```sh
bun add sergent-ts-core sergent-ts-runtime sergent-ts-providers
```

A browser application that hosts its model inside the page replaces `sergent-ts-providers` with
`sergent-ts-webllm`; the [WebLLM knowledge](sergent-ts-webllm/docs/KNOWLEDGE.md) explains the
worker setup and the browser requirements. Add `sergent-ts-observability` when you import its
record or observer types, and `sergent-ts-run-record` when your application writes Run Record
files. Keep all Sergent packages on the same release. Keep `sergent-ts-providers` and
`sergent-ts-run-record` out of browser bundles; they need Node-compatible APIs.

To check the installation, import `mintRunId` from `sergent-ts-core` in a TypeScript file, print
its result, and run the file with `bun run`. It loads the core package without contacting any
model provider.

The libraries ship as ESM TypeScript source packages, and Bun is the supported runtime. Your
application needs a runtime or a build tool that processes TypeScript dependencies, including
imports written with a `.js` extension that point at `.ts` source files. JavaScript-only
applications, CommonJS, and bare Node.js execution are outside the supported scope, and there is
no compiled JavaScript distribution.

npm, pnpm, and Yarn can install the same packages. Installation does not compile them, so run
your application with Bun or let a TypeScript-aware build tool process these dependencies. Deno
can register the packages with `deno add npm:<package>`, but it restricts direct execution of
TypeScript files inside npm packages (see the
[upstream discussion](https://github.com/denoland/deno/issues/27751)), so direct Deno execution is
not a supported path.

### Set up a development checkout

Contributors need two tools on their `PATH`: [mise](https://mise.jdx.dev/installing-mise.html),
which supplies the pinned tool versions, and [just](https://just.systems/man/en/installation.html),
which runs the repository recipes. After cloning, run:

```sh
just setup
```

This installs the pinned toolchain and then the Bun workspace from its lockfile. Run it again
after pulling a change to tool versions or dependencies.

### Contribute a change

Read the README and the knowledge file of the component you plan to change. Framework behavior
follows the specification, so read the section your change touches. Keep each change focused, add
tests for changed behavior, and update the component's documents when behavior changes. Tests run
without live providers, credentials, network access, or sleeps.

Before submitting, run these commands from the repository root. All three must pass:

```sh
just fmt
just test
just lint
```

`just fmt` formats the code in place. `just test` runs the workspace test suite. `just lint`
checks formatting, types for Bun, browser, and worker environments, and code quality.
