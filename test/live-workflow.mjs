import assert from "node:assert/strict";
import { fixture, cleanup, until } from "./workflow-fixture.mjs";
// This is offline transport simulation, NEVER genuine live evidence.
let f;
try {
  f = await fixture({
    liveConfig: {
      apiKey: "synthetic-gateway-test-key-only",
      modelId: "openai/gpt-4o-mini",
      maxCostMicrousd: 100000,
    },
    offlineGateway: true,
  });
  const page = await (await fetch(f.host + "/operator")).text();
  assert.ok(page.includes("Live configured"));
  assert.ok(!page.includes("Fixture mode · no paid model calls"));
  const id = await f.create();
  await f.waiting(id);
  assert.equal(f.effectCount(), 0);
  let { run } = await f.inspect(id);
  assert.equal(run.sourceMode, "live");
  assert.ok(run.budget.modelTurns >= 3);
  assert.ok(
    Object.values(run.budget.models).every(
      (v) => v.inputTokens === 111 && v.outputTokens === 33,
    ),
  );
  await f.approve(id);
  run = await until(async () => {
    const { run } = await f.inspect(id);
    return run.state === "succeeded" && run;
  }, "offline live-adapter success");
  assert.equal(f.effectCount(), 1);
  assert.equal(run.live.maxCostMicrousd, 100000);
  console.log(
    JSON.stringify({
      mode: "offline_gateway_simulation",
      actualProviderCalls: 0,
      passed: true,
      effects: 1,
      modelTurns: run.budget.modelTurns,
    }),
  );
} finally {
  if (f) await f.stop();
  await cleanup();
}
