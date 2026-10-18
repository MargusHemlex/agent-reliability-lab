// Isolated process-harness preload, never selected by the normal CLI. It prevents
// outbound model networking while exercising the real SDK and compiled worker.
import { fixtureDecision } from "./agent/lib/lab/fixture-model.ts";
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (
    url.origin === "https://ai-gateway.vercel.sh" &&
    url.pathname === "/v4/ai/language-model"
  ) {
    const body = JSON.parse(init.body);
    const decision = fixtureDecision(body.prompt);
    return Response.json({
      ...decision,
      usage: { inputTokens: { total: 111 }, outputTokens: { total: 33 } },
      warnings: [],
    });
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("offline_transport_outbound_denied");
  return original(input, init);
};
