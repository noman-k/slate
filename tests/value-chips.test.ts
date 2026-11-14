import { describe, expect, it } from "vitest";
import { chipsFromText, chipsToText } from "../src/components/editor/procedure-nodes";

describe("value chips in steps", () => {
  it("turns {{values}} into chips and back into the same text", () => {
    const saved = {
      type: "procedureStep",
      attrs: { step: "send" },
      content: [
        { type: "text", text: "Refund {{ order_total }} for {{order_number}} ({{order.carrier.name}})" },
        { type: "text", text: " now", marks: [{ type: "bold" }] },
      ],
    };
    const editor = chipsFromText(saved);
    expect(editor.content?.map((n) => n.type)).toEqual(["text", "valueRef", "text", "valueRef", "text", "valueRef", "text", "text"]);
    expect(editor.content?.[5]).toEqual({ type: "valueRef", attrs: { key: "order", path: "carrier.name" } });
    const back = chipsToText(editor);
    expect(back.content).toEqual([
      { type: "text", text: "Refund {{order_total}} for {{order_number}} ({{order.carrier.name}})" },
      { type: "text", text: " now", marks: [{ type: "bold" }] },
    ]);
  });

  it("leaves other blocks alone", () => {
    const callout = { type: "callout", content: [{ type: "text", text: "{{x}}" }] };
    expect(chipsFromText(callout)).toBe(callout);
  });
});
