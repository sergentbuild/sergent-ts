# sergent-ts-providers

This is where a Sergent Run meets the model providers: powerful, useful, and entirely outside your
control. The component keeps that meeting narrow, explicit, and honest about what happened.

## The providers on offer

This component reaches four providers, each through the vendor's official SDK:

- OpenAI, through the `openai` package and its Responses API.
- Anthropic, through the `@anthropic-ai/sdk` package and its Messages API.
- Google Gemini, through the `@google/genai` package and the Gemini Developer API.
- Ollama, through the `ollama` package, for a model served from a machine you control.

Nothing here speaks HTTP by hand. Each adapter builds the SDK's published request type, so the
compiler checks where every field lands, and an SDK change surfaces as a type error rather than a
runtime surprise.

The package facade exports one factory per provider, `createOpenAIModelClient`,
`createAnthropicModelClient`, `createGoogleModelClient`, and `createOllamaModelClient`, together
with a configuration type for each, such as `OpenAIModelClientConfig`. A factory returns a client
implementing core's `ModelClient` interface. The application hands that client to the runtime with
a full model name: the prefix `openai`, `anthropic`, `google`, or `ollama`, a slash, then the
provider's native model name. Credentials and endpoints come from that configuration alone, and no
factory reads an environment variable.

A model that runs inside the browser is a different subject, and it lives in a different component.
[`sergent-ts-webllm`](../sergent-ts-webllm/README.md) drives a browser-local WebLLM engine on a
dedicated worker. Both components implement the same `ModelClient` interface from core, and neither
imports the other, so a browser build never pulls in a Node provider SDK.

## The choices behind the adapters

The design stays small on purpose. One `transport` unit carries everything provider-neutral, and
each provider unit adds only what its vendor does differently. An adapter is a plain function, not
a subclass, and nothing picks one at runtime: the application chooses the client it hands to the
runtime.

Two rules make the result trustworthy. A provider response arrives as `unknown`, and one narrowing
step decides whether it is admissible; no repair step exists anywhere. An expected failure then
resolves as a value from a closed set of kinds, carrying the evidence the attempt reached, so a
caller branches on a kind instead of catching an exception.

The [component knowledge](docs/KNOWLEDGE.md) carries the complete design: the shared lifecycle,
what each provider unit supplies, the per-provider differences, and the steps for adding a new
provider.
