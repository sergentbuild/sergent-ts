import { expect, test } from "bun:test";
import * as providers from "./index.js";

test("public provider facade exposes exactly four factories", () => {
  expect(Object.keys(providers).toSorted()).toEqual([
    "createAnthropicModelClient",
    "createGoogleModelClient",
    "createOllamaModelClient",
    "createOpenAIModelClient",
  ]);
});
