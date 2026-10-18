import test from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSandbox, payloadDigest, POLICY } from "../sandbox/service.ts";
const secret = "synthetic-test-secret-32-characters";
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "arl-sandbox-"));
  const dbPath = join(dir, "sandbox.db");
  const clockFile = join(dir, "clock.json");
  const clock = (now) =>
    writeFileSync(clockFile, JSON.stringify({ now, generation: 1 }));
  clock(1000);
  let service = createSandbox({ dbPath, secret, testMode: true, clockFile });
  await service.listen();
  const request = (path, data, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: service.address().port,
          path,
          method: data === undefined ? "GET" : "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
            ...headers,
          },
        },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode, body: JSON.parse(raw) }),
          );
        },
      );
      req.on("error", reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
  const count = () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare("SELECT count(*) AS n FROM effects").get().n;
    } finally {
      db.close();
    }
  };
  const epoch = (await request("/epoch", {})).body.epoch;
  const action = {
    deliveryId: "delivery-001",
    kind: "request_update",
    note: POLICY.note,
  };
  const input = {
    key: "intent-001",
    runId: "run-001",
    proposalDigest: "a".repeat(64),
    action,
    expectedRevision: 1,
    policyVersion: 1,
    epoch,
    expiresAt: 2000,
  };
  t.after(async () => {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    request,
    input,
    clock,
    count,
    dbPath,
    restart: async () => {
      await service.close();
      service = createSandbox({ dbPath, secret, testMode: true, clockFile });
      await service.listen();
    },
    mutate: (sql) => service.db.exec(sql),
  };
}
test("sandbox denies authentication, foreign host/origin and malformed actions", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request("/policy", undefined, { authorization: "Bearer wrong" }))
      .status,
    401,
  );
  assert.equal(
    (await f.request("/policy", undefined, { host: "evil.example" })).status,
    403,
  );
  assert.equal(
    (await f.request("/policy", undefined, { origin: "http://localhost" }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.request("/resolutions", {
        ...f.input,
        action: { ...f.input.action, kind: "refund" },
      })
    ).body.error,
    "action_denied",
  );
  assert.equal(
    (await f.request("/resolutions", { ...f.input, arbitrary: true })).status,
    400,
  );
  assert.equal(
    (await f.request("/resolutions", f.input, { "content-type": "text/plain" }))
      .status,
    415,
  );
  assert.equal(f.count(), 0);
});
test("sandbox atomically deduplicates concurrent dispatch, persisted reconciliation precedes expiry and fencing", async (t) => {
  const f = await fixture(t);
  const replies = await Promise.all(
    Array.from({ length: 8 }, () => f.request("/resolutions", f.input)),
  );
  assert.equal(replies.filter((r) => r.status === 201).length, 1);
  assert.equal(f.count(), 1);
  assert.ok(replies.every((r) => r.body.effectId === replies[0].body.effectId));
  assert.equal(replies[0].body.payloadDigest, payloadDigest(f.input));
  f.clock(3000);
  await f.request("/epoch", {});
  await f.restart();
  assert.equal((await f.request("/resolutions", f.input)).status, 200);
  assert.equal(
    (await f.request("/receipts/intent-001")).body.effectId,
    replies[0].body.effectId,
  );
  assert.equal(
    (
      await f.request("/resolutions", {
        ...f.input,
        proposalDigest: "b".repeat(64),
      })
    ).body.error,
    "digest_conflict",
  );
  assert.equal(f.count(), 1);
});
test("sandbox rejects expired, stale revision/policy and stale worker epoch with zero effects", async (t) => {
  const f = await fixture(t);
  f.clock(2000);
  assert.equal(
    (await f.request("/resolutions", f.input)).body.error,
    "authorization_expired",
  );
  f.clock(1000);
  assert.equal(
    (await f.request("/resolutions", { ...f.input, expectedRevision: 2 })).body
      .error,
    "stale_context",
  );
  assert.equal(
    (await f.request("/resolutions", { ...f.input, policyVersion: 2 })).body
      .error,
    "stale_context",
  );
  const newer = (await f.request("/epoch", {})).body.epoch;
  assert.ok(newer > f.input.epoch);
  assert.equal(
    (await f.request("/resolutions", f.input)).body.error,
    "stale_epoch",
  );
  await f.restart();
  assert.ok((await f.request("/epoch", {})).body.epoch > newer);
  assert.equal(f.count(), 0);
});
test("sandbox new approval retains key and produces one effect; authoritative context mutation rejects old approval", async (t) => {
  const f = await fixture(t);
  f.clock(2500);
  assert.equal(
    (await f.request("/resolutions", f.input)).body.error,
    "authorization_expired",
  );
  assert.equal(
    (await f.request("/resolutions", { ...f.input, expiresAt: 3500 })).status,
    201,
  );
  assert.equal(
    (await f.request("/resolutions", { ...f.input, expiresAt: 4000 })).status,
    200,
  );
  f.mutate("UPDATE context SET revision=2,policy_version=2");
  assert.equal(
    (await f.request("/resolutions", { ...f.input, key: "intent-002" })).body
      .error,
    "stale_context",
  );
  assert.equal(f.count(), 1);
});
test("clock overrides fail closed outside test mode and missing clock cannot create effects", async (t) => {
  assert.throws(
    () => createSandbox({ dbPath: ":memory:", secret, clockFile: "/missing" }),
    /explicit test mode/,
  );
  const f = await fixture(t);
  f.clock("bad");
  assert.equal((await f.request("/resolutions", f.input)).status, 503);
  assert.equal(f.count(), 0);
});

test("sandbox rejects oversized requests without committing a partial effect", async (t) => {
  const f = await fixture(t);
  const response = await f.request("/resolutions", {
    ...f.input,
    padding: "x".repeat(17 * 1024),
  });
  assert.equal(response.status, 413);
  assert.equal(f.count(), 0);
});

test("after-commit barrier holds response outside the transaction while reconciliation sees one effect", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "arl-commit-barrier-"));
  const service = createSandbox({
    dbPath: join(dir, "sandbox.db"),
    secret,
    testMode: true,
    testBarrierDir: dir,
  });
  await service.listen();
  t.after(async () => {
    writeFileSync(join(dir, "release"), "release");
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${service.address().port}`;
  const headers = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  const epoch = await fetch(`${url}/epoch`, {
    method: "POST",
    headers,
    body: "{}",
  }).then((r) => r.json());
  const input = {
    key: "intent-barrier",
    runId: "run-barrier",
    proposalDigest: "a".repeat(64),
    action: {
      deliveryId: "delivery-001",
      kind: "request_update",
      note: POLICY.note,
    },
    expectedRevision: 1,
    policyVersion: 1,
    epoch: epoch.epoch,
    expiresAt: Date.now() + 60_000,
  };
  let settled = false;
  const pending = fetch(`${url}/resolutions`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  }).then(async (r) => {
    settled = true;
    return { status: r.status, body: await r.json() };
  });
  for (let i = 0; i < 100; i++) {
    if (existsSync(join(dir, "committed"))) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(existsSync(join(dir, "committed")));
  assert.equal(settled, false);
  const reconciliation = await fetch(`${url}/receipts/intent-barrier`, {
    headers,
  }).then((r) => r.json());
  assert.equal(reconciliation.key, input.key);
  const external = new DatabaseSync(join(dir, "sandbox.db"), {
    readOnly: true,
  });
  assert.equal(
    external.prepare("SELECT count(*) AS n FROM effects").get().n,
    1,
  );
  external.close();
  writeFileSync(join(dir, "release"), "release");
  assert.equal((await pending).status, 201);
  assert.throws(
    () => createSandbox({ dbPath: ":memory:", secret, testBarrierDir: dir }),
    /explicit test mode/,
  );
});

test("namespace reset seeds independent context and preserves prior receipts and context", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/resolutions", f.input)).status, 201);
  f.mutate("UPDATE context SET revision=9,policy_version=7 WHERE id=1");
  assert.equal(
    (await f.request("/namespaces", { namespace: "fresh-001" })).status,
    200,
  );
  const headers = { "x-arl-namespace": "fresh-001" };
  assert.equal(
    (await f.request("/deliveries/delivery-001", undefined, headers)).body
      .revision,
    1,
  );
  assert.equal(
    (await f.request("/policy", undefined, headers)).body.version,
    1,
  );
  assert.equal((await f.request("/deliveries/delivery-001")).body.revision, 9);
  assert.equal((await f.request("/policy")).body.version, 7);
  assert.equal(
    (await f.request("/receipts/" + f.input.key, undefined, headers)).status,
    404,
  );
  assert.equal((await f.request("/receipts/" + f.input.key)).status, 200);
  assert.equal((await f.request("/resolutions", f.input, headers)).status, 409);
  const next = {
    ...f.input,
    key: "namespace-new-intent",
    runId: "namespace-new-run",
  };
  assert.equal((await f.request("/resolutions", next, headers)).status, 201);
  assert.equal((await f.request("/receipts/" + next.key)).status, 404);
  assert.equal(f.count(), 2);
  f.mutate(
    "UPDATE namespaced_context SET revision=3 WHERE namespace='fresh-001'",
  );
  assert.equal(
    (await f.request("/namespaces", { namespace: "fresh-001" })).status,
    200,
  );
  assert.equal(
    (await f.request("/deliveries/delivery-001", undefined, headers)).body
      .revision,
    3,
  );
  assert.equal(
    (await f.request("/policy", undefined, { "x-arl-namespace": "missing" }))
      .status,
    404,
  );
  assert.equal(
    (await f.request("/namespaces", { namespace: "../bad" })).status,
    400,
  );
  assert.equal(
    (await f.request("/policy", undefined, { "x-arl-namespace": "../bad" }))
      .status,
    400,
  );
  await f.restart();
  assert.equal(
    (await f.request("/receipts/" + next.key, undefined, headers)).status,
    200,
  );
  assert.equal(
    (await f.request("/deliveries/delivery-001", undefined, headers)).body
      .revision,
    3,
  );
});

test("read fault configuration is gated and bounded", () => {
  for (const options of [
    { testReadFailures: 0 },
    { testReadDelayMs: 0 },
    { testReadDelayCount: 0 },
  ])
    assert.throws(
      () => createSandbox({ dbPath: ":memory:", secret, ...options }),
      /explicit test mode/,
    );
  for (const options of [
    { testReadFailures: -1 },
    { testReadFailures: 101 },
    { testReadDelayMs: 30001 },
    { testReadDelayMs: NaN },
    { testReadDelayCount: -1 },
    { testReadDelayCount: 101 },
  ])
    assert.throws(
      () =>
        createSandbox({
          dbPath: ":memory:",
          secret,
          testMode: true,
          ...options,
        }),
      /Invalid read fault/,
    );
});
test("synthetic service emits two transient read failures then succeeds on third attempt", async (t) => {
  const service = createSandbox({
    dbPath: ":memory:",
    secret,
    testMode: true,
    testReadFailures: 2,
    testReadDelayMs: 5,
    testReadDelayCount: 3,
  });
  await service.listen();
  t.after(() => service.close());
  const url = "http://127.0.0.1:" + service.address().port;
  const headers = { authorization: "Bearer " + secret };
  const start = Date.now();
  assert.equal(
    (await fetch(url + "/deliveries/delivery-001", { headers })).status,
    503,
  );
  assert.equal((await fetch(url + "/policy", { headers })).status, 503);
  assert.equal(
    (await fetch(url + "/deliveries/delivery-001", { headers })).status,
    200,
  );
  assert.equal((await fetch(url + "/policy", { headers })).status, 200);
  assert.ok(Date.now() - start >= 15);
  assert.equal(
    service.db.prepare("SELECT count(*) AS n FROM effects").get().n,
    0,
  );
});
