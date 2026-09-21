import { describe, expect, test } from "bun:test";
import { Type } from "typebox";

import { createProposalDefinition } from "../schema/index.js";
import {
  createMessages,
  createModelRequest,
  createModelSettings,
  createPngImage,
  createSystemMessage,
  createUserMessage,
} from "./index.js";

describe("portable model construction", () => {
  test("encode an exact isolated byte view", () => {
    const bytes = new Uint8Array([0xff, 0x89, 0x50, 0x4e, 0x47, 0xee]);
    const image = createPngImage(bytes.subarray(1, 5));
    bytes.fill(0);

    expect(image.media_type).toBe("image/png");
    expect(image.data).toBe("iVBORw==");
  });

  test("accept empty and maximum-sized images and reject oversized images", () => {
    const empty = createPngImage(new Uint8Array());
    const largest = createPngImage(new Uint8Array(1_000_000));

    expect(empty.data).toBe("");
    expect(largest.data).toHaveLength(1_333_336);
    expect(largest.data.endsWith("AA==")).toBe(true);
    expect(() => createPngImage(new Uint8Array(1_000_001))).toThrow(TypeError);
  });

  test("enforce nonempty text, image placement, and complete message order", () => {
    const system = createSystemMessage("system");
    const first = createUserMessage("first");
    const second = createUserMessage("second", [createPngImage(new Uint8Array())]);
    const messages = createMessages([first, second], system);

    expect(messages.map((message) => message.role)).toEqual(["system", "user", "user"]);
    expect("images" in first).toBe(false);
    expect(second.images).toHaveLength(1);
    expect(() => createSystemMessage("")).toThrow(TypeError);
    expect(() => createUserMessage("")).toThrow(TypeError);
    expect(() => createMessages([])).toThrow(TypeError);
  });

  test("require positive phase settings and retain the exact ProposalSchema", () => {
    const proposal = createProposalDefinition(
      "IntentProposal",
      Type.Object({ decision: Type.String() }, { additionalProperties: false }),
    );
    const settings = createModelSettings(256, 5_000, "high");
    const messages = createMessages([createUserMessage("decide")]);
    const request = createModelRequest(
      "provider/model",
      messages,
      proposal.proposal_schema,
      settings,
    );

    expect(request.proposalSchema).toBe(proposal.proposal_schema);
    expect(request.modelSettings.maxOutputTokens).toBe(256);
    expect(request.modelSettings.timeoutMs).toBe(5_000);
    expect(request.modelSettings.thinkingEffort).toBe("high");
    for (const [tokens, timeout] of [
      [0, 1],
      [1, 0],
      [1.5, 1],
      [1, 1.5],
    ]) {
      expect(() => createModelSettings(tokens ?? 0, timeout ?? 0, "low")).toThrow(TypeError);
    }
    expect(() => Reflect.apply(createModelSettings, null, [1, 1, "none"])).toThrow(TypeError);
  });
});
