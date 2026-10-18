import test from "node:test";
import assert from "node:assert/strict";
import { model } from "../agent/lib/scripted-model.ts";

const options = {
  prompt: [
    { role: "user", content: [{ type: "text", text: "Synthetic probe" }] },
  ],
};
test("fixture emits the same call after a process-equivalent model recreation", async () => {
  const a = await model.doGenerate(options);
  const b = await model.doGenerate(options);
  assert.deepEqual(a, b);
  assert.deepEqual(a.content, [
    {
      type: "tool-call",
      toolCallId: "fixture-probe-1",
      toolName: "probe",
      input: "{}",
    },
  ]);
  assert.equal(a.usage.inputTokens.total, undefined);
});
test("streaming fixture emits a consumable tool call and finish", async () => {
  const { stream } = await model.doStream(options);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(chunks.filter((c) => c.type === "tool-call").length, 1);
  assert.equal(chunks.at(-1).finishReason.unified, "tool-calls");
});
test("fixture ends after a recorded tool result", async () => {
  const result = await model.doGenerate({
    prompt: [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "fixture-probe-1",
            toolName: "probe",
            output: { type: "json", value: { marker: "probe-result" } },
          },
        ],
      },
    ],
  });
  assert.equal(result.finishReason.unified, "stop");
  assert.equal(result.content[0].type, "text");
});
