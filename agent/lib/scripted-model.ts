import { assertFixtureTools, fixtureDecision } from "./lab/fixture-model.ts";
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
function result(options: { prompt: unknown; tools?: unknown }) {
  if (process.env.ARL_LAB_MODE === "fixture") {
    assertFixtureTools(options.tools);
    return { ...fixtureDecision(options.prompt), usage, warnings: [] };
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
  doGenerate: async (options) => result(options),
  doStream: async (options) => {
    const value = result(options);
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
