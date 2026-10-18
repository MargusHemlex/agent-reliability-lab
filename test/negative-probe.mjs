// One invariant probe is run unchanged against baseline and disposable mutants.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { writeFileSync, renameSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  fixture,
  until,
  cleanup,
  sleep,
  liveChildPids,
} from "./workflow-fixture.mjs";
const [kind, sourceRoot, output] = process.argv.slice(2);
const manifest = output + ".pids";
function recordPids(pids = liveChildPids()) {
  writeFileSync(
    manifest + ".tmp",
    JSON.stringify({ ownerPid: process.pid, pids }),
  );
  renameSync(manifest + ".tmp", manifest);
}
recordPids();
const tracking = setInterval(recordPids, 100);
process.once("SIGTERM", () => {
  clearInterval(tracking);
  void cleanup().finally(() => {
    recordPids([]);
    process.exit(2);
  });
});
let observation;
try {
  if (kind === "idempotency") {
    const { createSandbox } = await import(
      pathToFileURL(join(sourceRoot, "sandbox/service.ts")).href
    );
    const { proposalDigest, digest } = await import(
      pathToFileURL(join(sourceRoot, "agent/lib/lab/contracts.ts")).href
    );
    const secret = randomBytes(32).toString("hex");
    const service = createSandbox({
      dbPath: join(sourceRoot, "probe.sqlite"),
      secret,
    });
    await service.listen();
    try {
      const url = `http://127.0.0.1:${service.address().port}`;
      const post = async (path, body) => {
        const r = await fetch(url + path, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });
        return { status: r.status, body: await r.json() };
      };
      const {
        body: { epoch },
      } = await post("/epoch", {});
      const runId = "negative-idempotency-run",
        action = {
          deliveryId: "delivery-001",
          kind: "request_update",
          note: "Please provide a delivery update.",
        };
      const proposal = proposalDigest(runId, action, 1, 1);
      const request = {
        runId,
        key: digest({ runId, proposalDigest: proposal }),
        proposalDigest: proposal,
        action,
        epoch,
        expectedRevision: 1,
        policyVersion: 1,
        expiresAt: Date.now() + 60000,
      };
      const responses = await Promise.all([
        post("/resolutions", request),
        post("/resolutions", request),
      ]);
      assert.ok(
        responses.every((r) => [200, 201].includes(r.status)),
        "probe_transport_failed",
      );
      const effects = service.db
        .prepare("SELECT count(*) AS n FROM effects WHERE run_id=?")
        .get(runId).n;
      observation = {
        kind,
        effects,
        duplicates: Math.max(0, effects - 1),
        policyViolations: null,
        violationCode: effects > 1 ? "duplicate_effect" : null,
        status: effects === 1 ? "pass" : "invariant_violation",
      };
      try {
        assert.equal(effects, 1, "duplicate_effect");
      } catch {
        if (effects < 2) throw Error("probe_infrastructure_failed");
        process.exitCode = 1;
      }
    } finally {
      await service.close();
    }
  } else if (kind === "approval") {
    const f = await fixture({ sourceRoot });
    try {
      const id = await f.create();
      await until(async () => {
        const r = await f.inspect(id);
        return ["awaiting_approval", "succeeded"].includes(r.run.state) && r;
      }, "approval probe");
      await sleep(300);
      const state = await f.inspect(id);
      if (!["awaiting_approval", "succeeded"].includes(state.run.state))
        throw Error("probe_infrastructure_failed");
      const effects = f.effectCount();
      observation = {
        kind,
        effects,
        duplicates: 0,
        policyViolations: effects,
        violationCode: effects > 0 ? "unauthorized_effect" : null,
        status: effects === 0 ? "pass" : "invariant_violation",
      };
      // No call to an approval endpoint occurs anywhere in this probe.
      try {
        assert.equal(effects, 0, "unauthorized_effect");
      } catch {
        process.exitCode = 1;
      }
    } finally {
      await f.stop();
    }
  } else throw Error("unknown_probe");
} catch {
  observation = { kind, status: "infrastructure_error" };
  process.exitCode = 2;
} finally {
  clearInterval(tracking);
  await cleanup();
  recordPids([]);
  await writeFile(output, JSON.stringify(observation) + "\n");
}
