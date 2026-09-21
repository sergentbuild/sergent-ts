/** The complete supported Intent control vocabulary. */
export type IntentFlow = "continue" | "stop";

/** The minimum application Intent contract. */
export interface Intent {
  readonly flow: IntentFlow;
}

/** An Intent that ends successfully without a Plan. */
export interface StopIntent extends Intent {
  readonly flow: "stop";
}

/** An Intent that proceeds to the Plan phase. */
export interface ContinueIntent extends Intent {
  readonly flow: "continue";
}
