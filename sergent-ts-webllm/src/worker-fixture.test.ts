import type { WebLlmWorker } from "./native/index.js";

/** Records synchronous worker disposal and allows real EventTarget failure delivery. */
export class FakeWorker extends EventTarget implements WebLlmWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  terminations = 0;
  /** The injected native engine handles requests, so no protocol emulation is needed. */
  postMessage(): void {}
  /** Records actual disposal ownership without draining parked fake calls. */
  terminate(): void {
    this.terminations += 1;
  }
}
