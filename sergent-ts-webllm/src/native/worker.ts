import { WebWorkerMLCEngine, WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";
import type { ChatOptions } from "@mlc-ai/web-llm/lib/config.js";
import type { NativeEngine, WebLlmProfile, WebLlmProgress, WebLlmWorker } from "./contract.js";

/** Constructs the official proxy with a single immutable asset selection. */
export function createNativeEngine(
  worker: WebLlmWorker,
  profile: WebLlmProfile,
  progress: (report: WebLlmProgress) => void,
): NativeEngine {
  return new WebWorkerMLCEngine(worker, {
    appConfig: {
      model_list: [
        { model_id: profile.modelId, model: profile.modelUrl, model_lib: profile.modelLibraryUrl },
      ],
    },
    initProgressCallback: progress,
  });
}

/** Projects capacity, tokenizer stop IDs, and the application-owned assistant input suffix. */
export function nativeLoadOptions(profile: WebLlmProfile): ChatOptions {
  return {
    context_window_size: profile.contextWindowSize,
    max_history_size: profile.maxHistorySize,
    conv_config: {
      stop_token_ids: [...profile.stopTokenIds],
      role_empty_sep: profile.roleEmptySeparator,
    },
  };
}

/** Installs the official protocol handler on the application's worker global. */
export function installWebLlmWorker(scope: Pick<EventTarget, "addEventListener">): void {
  const handler = new WebWorkerMLCEngineHandler();
  scope.addEventListener("message", (event) => handler.onmessage(event));
}
