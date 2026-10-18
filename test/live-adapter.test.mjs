import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import {
  createLiveModel,
  liveConfiguration,
  normalizeUsage,
  safeProviderIdentifier,
  estimatedUsageCost,
} from "../agent/lib/live-model.ts";
const tools = [
  "get_delivery",
  "get_resolution_policy",
  "record_resolution",
].map((name) => ({ type: "function", name, inputSchema: { type: "object" } }));
const options = () => ({
  prompt: [
    {
      role: "user",
      content: [
        { type: "text", text: JSON.stringify({ runId: "run-live-test" }) },
      ],
    },
  ],
  tools,
});
const output = (overrides = {}) => ({
  content: [
    {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "get_delivery",
      input: JSON.stringify({ runId: "run-live-test" }),
    },
  ],
  finishReason: { unified: "tool-calls", raw: undefined },
  usage: { inputTokens: { total: 100 }, outputTokens: { total: 20 } },
  warnings: [],
  response: {
    modelId: "gpt-4o-mini",
    id: "response-1",
    headers: { authorization: "not-forwarded" },
  },
  providerMetadata: { private: "not-forwarded" },
  ...overrides,
});
function setup(generate, { deadline = Date.now() + 10000 } = {}) {
  const reservations = [],
    finishes = [];
  let calls = 0;
  const store = {
    reserveModel: (runId, record) => {
      reservations.push({ runId, ...record });
      return { deadline };
    },
    finishModel: (runId, record) => finishes.push({ runId, ...record }),
  };
  const model = createLiveModel({
    model: new MockLanguageModelV4({
      doGenerate: async (opt) => {
        calls++;
        return generate(opt);
      },
    }),
    modelId: "openai/gpt-4o-mini",
    store: () => store,
    config: () => ({ epoch: 1 }),
    now: () => Date.now(),
  });
  return { model, reservations, finishes, calls: () => calls };
}
test("live configuration fails closed without explicit opt-in, model or gateway key", () => {
  const env = {
    ARL_LAB_MODE: "live",
    ARL_LIVE_OPT_IN: "1",
    AGENT_MODEL: "openai/gpt-4o-mini",
    AI_GATEWAY_API_KEY: "synthetic-test-key-only",
  };
  assert.equal(liveConfiguration(env).modelId, env.AGENT_MODEL);
  for (const key of [
    "ARL_LAB_MODE",
    "ARL_LIVE_OPT_IN",
    "AGENT_MODEL",
    "AI_GATEWAY_API_KEY",
  ]) {
    const missing = { ...env };
    delete missing[key];
    assert.throws(() => liveConfiguration(missing));
  }
  assert.throws(() =>
    liveConfiguration({ ...env, AGENT_MODEL: "other/model" }),
  );
  assert.throws(() =>
    liveConfiguration({ ...env, ARL_LIVE_MAX_COST_USD: "1.00" }),
  );
  assert.throws(() =>
    liveConfiguration({ ...env, ARL_FAULT_READ_DELAY_MS: "0" }),
  );
});
test("live adapter persists reservation before one bounded call and emits allowlisted result", async () => {
  let fixture;
  fixture = setup(async (opt) => {
    assert.equal(fixture.reservations.length, 1);
    assert.equal(opt.maxOutputTokens, 1600);
    assert.deepEqual(opt.providerOptions, {});
    assert.equal(opt.headers, undefined);
    assert.ok(opt.abortSignal);
    return output();
  });
  const result = await fixture.model.doGenerate({
    ...options(),
    headers: { authorization: "must-strip" },
    providerOptions: { openai: { serviceTier: "priority" } },
  });
  assert.equal(fixture.calls(), 1);
  assert.equal(fixture.reservations[0].singleDispatch, true);
  assert.equal(fixture.finishes[0].inputTokens, 100);
  assert.equal(fixture.finishes[0].estimatedCostMicrousd, 27);
  assert.equal(result.response.headers, undefined);
  assert.equal(result.providerMetadata, undefined);
  assert.equal(result.usage.inputTokens.total, 100);
});
test("live adapter rejects malformed, unknown and cross-run tool calls without retry", async () => {
  for (const content of [
    [{ type: "tool-call", toolCallId: "c", toolName: "shell", input: "{}" }],
    [
      {
        type: "tool-call",
        toolCallId: "c",
        toolName: "get_delivery",
        input: '{"runId":"other"}',
      },
    ],
    [
      {
        type: "tool-call",
        toolCallId: "c",
        toolName: "get_delivery",
        input: '{"runId":"run-live-test","approve":true}',
      },
    ],
    [
      {
        type: "tool-call",
        toolCallId: "c",
        toolName: "get_delivery",
        input: "not-json",
      },
    ],
  ]) {
    const f = setup(async () => output({ content }));
    await assert.rejects(f.model.doGenerate(options()), /live_failed/);
    assert.equal(f.calls(), 1);
    assert.equal(f.finishes[0].outcome, "live_failed");
    assert.equal(f.finishes[0].inputTokens, 100);
  }
});
test("provider error is sanitized, unknown usage stays unknown and no retry occurs", async () => {
  const f = setup(async () => {
    throw new Error("private-provider-response-and-secret");
  });
  await assert.rejects(
    f.model.doGenerate(options()),
    (error) => error.message === "live_failed",
  );
  assert.equal(f.calls(), 1);
  assert.equal(f.finishes[0].inputTokens, null);
  assert.equal(f.finishes[0].outputTokens, null);
  assert.equal(f.finishes[0].estimatedCostMicrousd, null);
});
test("missing provider usage is not converted to zero", async () => {
  const f = setup(async () => output({ usage: {} }));
  const result = await f.model.doGenerate(options());
  assert.equal(result.usage.inputTokens.total, undefined);
  assert.equal(f.finishes[0].inputTokens, null);
  assert.equal(f.finishes[0].estimatedCostMicrousd, null);
});
test("abort stops waiting even if transport ignores signal, without a second request", async () => {
  const f = setup(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = f.model.doGenerate({
    ...options(),
    abortSignal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, /live_timeout_or_abort/);
  assert.equal(f.calls(), 1);
  assert.equal(f.finishes[0].outcome, "live_timeout_or_abort");
});
test("stream buffers validated generation and persists accounting before tool emission", async () => {
  const f = setup(async () => output());
  const { stream } = await f.model.doStream(options());
  assert.equal(f.finishes.length, 1);
  const parts = [];
  for await (const part of stream) parts.push(part);
  assert.equal(parts.filter((v) => v.type === "tool-call").length, 1);
  assert.equal(parts.at(-1).type, "finish");
  assert.equal(f.calls(), 1);
});
test("unknown usage and unsafe provider identifiers remain null", () => {
  for (const value of [undefined, null, -1, NaN, Infinity, 1.5, "10"])
    assert.equal(normalizeUsage(value), null);
  assert.equal(normalizeUsage(0), 0);
  assert.equal(safeProviderIdentifier("provider\nsecret"), null);
  assert.equal(estimatedUsageCost(null, 20), null);
  assert.equal(estimatedUsageCost(100, 20), 27);
});

test("truncated or empty provider results fail with measured accounting", async () => {
  for (const reason of ["length", "content-filter", "error", "other"]) {
    const f = setup(async () =>
      output({ finishReason: { unified: reason, raw: undefined } }),
    );
    await assert.rejects(f.model.doGenerate(options()), /live_failed/);
    assert.equal(f.calls(), 1);
    assert.equal(f.finishes[0].inputTokens, 100);
  }
  const f = setup(async () => output({ content: [] }));
  await assert.rejects(f.model.doGenerate(options()), /live_failed/);
  assert.equal(f.calls(), 1);
});

test("expired reservation deadline records known zero usage before any provider dispatch", async () => {
  const f = setup(async () => output(), { deadline: Date.now() - 1 });
  await assert.rejects(
    f.model.doGenerate(options()),
    /live_deadline_exhausted/,
  );
  assert.equal(f.calls(), 0);
  assert.equal(f.finishes.length, 1);
  assert.equal(f.finishes[0].outcome, "live_not_dispatched_deadline");
  assert.equal(f.finishes[0].inputTokens, 0);
  assert.equal(f.finishes[0].outputTokens, 0);
  assert.equal(f.finishes[0].estimatedCostMicrousd, 0);
  assert.equal(f.finishes[0].provider, null);
  assert.equal(f.finishes[0].returnedModelId, null);
  assert.equal(f.finishes[0].providerVersion, null);
});
