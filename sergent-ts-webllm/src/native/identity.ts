import type { ModelIdentity } from "sergent-ts-core";

/** Resolves the selected native model to the exact SDK that produced its evidence. */
export function modelIdentity(model: string): ModelIdentity {
  return { provider: "webllm", model, sdkPackage: "@mlc-ai/web-llm", sdkVersion: "0.2.84" };
}
