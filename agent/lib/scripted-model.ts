import {
  assertFixtureTools,
  fixtureDecision,
  fixtureRunId,
} from "./lab/fixture-model.ts";
import { createHash } from "node:crypto";
import { config, now, store } from "./lab/runtime.ts";
import { MockLanguageModelV4 } from "ai/test";

// Scripted decisions only: no provider, API key, paid call or claimed model usage.
const usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};
function result(options: {
  prompt: unknown;
  tools?: unknown;
  maxOutputTokens?: number;
}) {
  if (process.env.ARL_LAB_MODE === "fixture") {
    assertFixtureTools(options.tools);
    const runId = fixtureRunId(options.prompt);
    const id = createHash("sha256")
      .update(JSON.stringify(options.prompt))
      .digest("hex");
    const epoch = config().epoch;
    store().reserveModel(runId, {
      id,
      requestedTokens: options.maxOutputTokens ?? 1600,
      now: now(),
      epoch,
    });
    const decision = fixtureDecision(options.prompt);
    // No provider is called: cap the scripted completion conservatively by bytes.
    // Requested completion capacity is charged; provider-reported usage stays unknown.
    if (Buffer.byteLength(JSON.stringify(decision.content)) > 1600)
      throw new Error("fixture_output_cap");
    store().finishModel(runId, {
      id,
      now: now(),
      epoch,
      inputTokens: null,
      outputTokens: null,
    });
    return { ...decision, usage, warnings: [] };
  }
  const done = JSON.stringify(options.prompt).includes("probe-result");
  return {
    content: done
      ? [{ type: "text" as const, text: "Fixture completed." }]
      : [
          {
            type: "tool-call" as const,
            toolCallId: "fixture-probe-1",
            toolName: "probe",
            input: "{}",
          },
        ],
    finishReason: {
      unified: done ? ("stop" as const) : ("tool-calls" as const),
      raw: undefined,
    },
    usage,
    warnings: [],
  };
}
export const model = new MockLanguageModelV4({
  provider: "fixture",
  modelId: "scripted-probe-v1",
  doGenerate: async (options) => result({ ...options, maxOutputTokens: 1600 }),
  doStream: async (options) => {
    const value = result({ ...options, maxOutputTokens: 1600 });
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          if (value.content[0].type === "tool-call")
            controller.enqueue(value.content[0]);
          else {
            controller.enqueue({ type: "text-start", id: "fixture-text" });
            controller.enqueue({
              type: "text-delta",
              id: "fixture-text",
              delta: "Fixture completed.",
            });
            controller.enqueue({ type: "text-end", id: "fixture-text" });
          }
          controller.enqueue({
            type: "finish",
            finishReason: value.finishReason,
            usage,
          });
          controller.close();
        },
      }),
    };
  },
});
