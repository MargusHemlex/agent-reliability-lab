import test from "node:test";
import assert from "node:assert/strict";
import { createOperatorHandler } from "../agent/lib/lab/operator-ui.ts";
const origin = "http://127.0.0.1:4318",
  secret = "synthetic-operator-unit-secret-value";
function fixture() {
  let time = 1000;
  const calls = [];
  const handler = createOperatorHandler({
    secret: () => secret,
    origin: () => origin,
    clock: () => time,
    proxy: async (...args) => {
      calls.push(args);
      return Response.json({ runs: [] });
    },
  });
  const request = (path, options = {}) =>
    handler(new Request(origin + path, options));
  return {
    request,
    calls,
    advance: () => {
      time += 16 * 60 * 1000;
    },
  };
}
async function login(f) {
  const response = await f.request("/operator/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ secret }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(
    cookie,
    /HttpOnly; SameSite=Strict; Path=\/operator; Max-Age=900/,
  );
  return { cookie: cookie.split(";")[0], csrf: (await response.json()).csrf };
}
test("operator page has restrictive CSP, accessible controls and no persistent secret storage", async () => {
  const f = fixture(),
    r = await f.request("/operator");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(
    r.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  const html = await r.text();
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /innerHTML|localStorage|sessionStorage/);
  assert.ok(!html.includes(secret));
  assert.match(html, /operator-secret/);
});
test("operator rejects hostile host, origin, unauthenticated reads and malformed login", async () => {
  const f = fixture();
  assert.equal(
    (await f.request("/operator", { headers: { host: "attacker.example" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.request("/operator/api/runs", {
        headers: { "sec-fetch-site": "cross-site" },
      })
    ).status,
    403,
  );
  assert.equal((await f.request("/operator/api/runs")).status, 401);
  for (const headers of [
    { "content-type": "application/json" },
    { origin: "http://attacker.example", "content-type": "application/json" },
  ])
    assert.equal(
      (
        await f.request("/operator/login", {
          method: "POST",
          headers,
          body: JSON.stringify({ secret }),
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await f.request("/operator/login", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ secret: "bad" }),
      })
    ).status,
    403,
  );
  assert.equal(f.calls.length, 0);
});
test("operator session proxies only allowlisted API and requires CSRF for mutations", async () => {
  const f = fixture(),
    s = await login(f);
  const headers = {
    cookie: s.cookie,
    origin,
    "content-type": "application/json",
  };
  assert.equal(
    (await f.request("/operator/api/runs", { headers })).status,
    200,
  );
  assert.deepEqual(f.calls[0], ["/lab/runs", "GET", undefined]);
  assert.equal(
    (
      await f.request("/operator/api/runs", {
        method: "POST",
        headers,
        body: "{}",
      })
    ).status,
    403,
  );
  headers["x-csrf-token"] = s.csrf;
  assert.equal(
    (
      await f.request("/operator/api/runs/run-1/approve", {
        method: "POST",
        headers,
        body: JSON.stringify({ proposalDigest: "a".repeat(64) }),
      })
    ).status,
    200,
  );
  assert.equal(f.calls[1][0], "/lab/runs/run-1/approve");
  assert.equal(
    (
      await f.request("/operator/api/namespaces/reset", {
        method: "POST",
        headers,
        body: "{}",
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request("/operator/api/evil", { headers })).status,
    404,
  );
  assert.equal(
    (await f.request("/operator/api/runs?redirect=evil", { headers })).status,
    404,
  );
  assert.equal(
    (
      await f.request("/operator/api/runs", {
        method: "POST",
        headers,
        body: JSON.stringify({ x: "a".repeat(17000) }),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await f.request("/operator/logout", {
        method: "POST",
        headers,
        body: "{}",
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request("/operator/api/runs", { headers })).status,
    401,
  );
});
test("operator sessions expire and replayed browser cookie cannot mutate afterward", async () => {
  const f = fixture(),
    s = await login(f);
  f.advance();
  assert.equal(
    (
      await f.request("/operator/api/runs", {
        method: "POST",
        headers: {
          cookie: s.cookie,
          origin,
          "content-type": "application/json",
          "x-csrf-token": s.csrf,
        },
        body: "{}",
      })
    ).status,
    401,
  );
  assert.equal(f.calls.length, 0);
});

test("operator login rejects repeated failures without exposing secrets", async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) {
    const response = await f.request("/operator/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ secret: "incorrect" }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "login_denied" });
  }
  const blocked = await f.request("/operator/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ secret }),
  });
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "login_rate_limited" });
  f.advance();
  await login(f);
});

test("operator accepts Nitro internal localhost URL only with exact configured public Host", async () => {
  const h = createOperatorHandler({
    secret: () => secret,
    origin: () => origin,
    proxy: async () => Response.json({}),
  });
  assert.equal(
    (
      await h(
        new Request("http://localhost:4318/operator", {
          headers: { host: "127.0.0.1:4318" },
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await h(
        new Request("http://localhost:4318/operator", {
          headers: { host: "attacker.example" },
        }),
      )
    ).status,
    403,
  );
});
