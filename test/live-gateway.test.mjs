import assert from "node:assert/strict";
import test from "node:test";
import { createGateway } from "ai";
import { createLiveModel } from "../agent/lib/live-model.ts";

test("real Gateway SDK wire transport stays offline and removes raw credential echoes", async () => {
  let requests = 0;
  const finishes = [];
  const key = "synthetic-not-a-real-gateway-key";
  const transport = createGateway({
    apiKey: key,
    fetch: async (url, options) => {
      requests++;
      assert.equal(new URL(url).origin, "https://ai-gateway.vercel.sh");
      assert.equal(new URL(url).pathname, "/v4/ai/language-model");
      const headers = new Headers(options.headers);
      assert.equal(headers.get("authorization"), `Bearer ${key}`);
      assert.equal(headers.get("ai-language-model-id"), "openai/gpt-4o-mini");
      assert.equal(headers.get("ai-language-model-streaming"), "false");
      assert.equal(JSON.parse(options.body).maxOutputTokens, 1600);
      return Response.json(
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "wire-1",
              toolName: "get_delivery",
              input: JSON.stringify({ runId: "wire-run" }),
            },
          ],
          finishReason: { unified: "tool-calls" },
          usage: { inputTokens: { total: 101 }, outputTokens: { total: 21 } },
          warnings: [{ type: "other", message: key }],
          providerMetadata: { gateway: { private: key } },
          response: { modelId: "unverified-model" },
        },
        { headers: { "x-private": key } },
      );
    },
  }).languageModel("openai/gpt-4o-mini");
  const model = createLiveModel({
    model: transport,
    modelId: "openai/gpt-4o-mini",
    store: () => ({
      reserveModel: () => ({ deadline: Date.now() + 10000 }),
      finishModel: (_, value) => finishes.push(value),
    }),
    config: () => ({ epoch: 1 }),
    now: () => Date.now(),
  });
  const result = await model.doGenerate({
    prompt: [
      {
        role: "user",
        content: [
          { type: "text", text: JSON.stringify({ runId: "wire-run" }) },
        ],
      },
    ],
    tools: ["get_delivery", "get_resolution_policy", "record_resolution"].map(
      (name) => ({ type: "function", name, inputSchema: { type: "object" } }),
    ),
  });
  assert.equal(requests, 1);
  assert.equal(finishes[0].inputTokens, 101);
  assert.equal(finishes[0].outputTokens, 21);
  assert.equal(finishes[0].returnedModelId, null); // SDK nonstream transport does not expose an attested returned identifier.
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(result.request, undefined);
  assert.equal(result.response.headers, undefined);
});
