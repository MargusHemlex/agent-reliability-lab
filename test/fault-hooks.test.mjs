import test from "node:test";
import assert from "node:assert/strict";
import { fixtureDecision } from "../agent/lib/lab/fixture-model.ts";
const prompt = [
  {
    role: "user",
    content: [
      { type: "text", text: JSON.stringify({ runId: "fault-test-run" }) },
    ],
  },
];
test("a forbidden-tool fixture fault is explicitly gated and cannot widen tool capabilities", () => {
  const before = {
    mode: process.env.ARL_TEST_MODE,
    name: process.env.ARL_FAULT_TOOL_NAME,
  };
  try {
    process.env.ARL_FAULT_TOOL_NAME = "forbidden_tool";
    delete process.env.ARL_TEST_MODE;
    assert.throws(() => fixtureDecision(prompt), /test_tool_fault_denied/);
    process.env.ARL_TEST_MODE = "1";
    assert.equal(fixtureDecision(prompt).content[0].toolName, "forbidden_tool");
    process.env.ARL_FAULT_TOOL_NAME = "shell";
    assert.throws(() => fixtureDecision(prompt), /test_tool_fault_denied/);
  } finally {
    for (const [key, v] of [
      ["ARL_TEST_MODE", before.mode],
      ["ARL_FAULT_TOOL_NAME", before.name],
    ])
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
  }
});
