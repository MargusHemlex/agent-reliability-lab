import { createServer, type IncomingMessage } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  canonical,
  payloadDigest,
  type ResolutionRequest,
} from "../agent/lib/lab/contracts.ts";
export { payloadDigest } from "../agent/lib/lab/contracts.ts";
export type { Action, ResolutionRequest } from "../agent/lib/lab/contracts.ts";

export const DELIVERY = {
  id: "delivery-001",
  status: "delayed",
  revision: 1,
  description: "Synthetic delivery delayed in transit.",
};
export const POLICY = {
  version: 1,
  allowedAction: "request_update",
  note: "Please provide a delivery update.",
};
class Denied extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function parseRequest(v: unknown): ResolutionRequest {
  if (
    !object(v) ||
    Object.keys(v).sort().join(",") !==
      "action,epoch,expectedRevision,expiresAt,key,policyVersion,proposalDigest,runId"
  )
    throw new Denied("invalid_request");
  if (
    typeof v.key !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(v.key) ||
    typeof v.runId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(v.runId) ||
    typeof v.proposalDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.proposalDigest)
  )
    throw new Denied("invalid_request");
  if (
    ![v.epoch, v.expectedRevision, v.policyVersion, v.expiresAt].every(
      (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0,
    )
  )
    throw new Denied("invalid_request");
  if (
    !object(v.action) ||
    Object.keys(v.action).sort().join(",") !== "deliveryId,kind,note" ||
    v.action.deliveryId !== DELIVERY.id ||
    v.action.kind !== POLICY.allowedAction ||
    v.action.note !== POLICY.note
  )
    throw new Denied("action_denied", 403);
  return v as ResolutionRequest;
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Denied("body_too_large", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Denied("invalid_json");
  }
}
export function createSandbox(options: {
  dbPath: string;
  secret: string;
  testMode?: boolean;
  clockFile?: string;
  testBarrierDir?: string;
  testReadFailures?: number;
  testReadDelayMs?: number;
  testReadDelayCount?: number;
  testDeliveryDescription?: string;
}) {
  if (options.secret.length < 24)
    throw new Error("Service secret must contain at least 24 characters");
  if (options.clockFile && !options.testMode)
    throw new Error("Clock override requires explicit test mode");
  if (options.testBarrierDir && !options.testMode)
    throw new Error("Fault barrier requires explicit test mode");
  if (
    (options.testReadFailures !== undefined ||
      options.testReadDelayMs !== undefined ||
      options.testReadDelayCount !== undefined) &&
    !options.testMode
  )
    throw new Error("Read faults require explicit test mode");
  for (const [value, maximum] of [
    [options.testReadFailures, 100],
    [options.testReadDelayMs, 30000],
    [options.testReadDelayCount, 100],
  ])
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < 0 || value > maximum!)
    )
      throw new Error("Invalid read fault configuration");
  let readFailuresRemaining = options.testReadFailures ?? 0;
  let readDelaysRemaining =
    options.testReadDelayCount ?? (options.testReadDelayMs ? 1 : 0);
  if (
    options.testDeliveryDescription !== undefined &&
    (!options.testMode ||
      typeof options.testDeliveryDescription !== "string" ||
      options.testDeliveryDescription.length > 2048)
  )
    throw new Error("Delivery description fault denied");
  const db = new DatabaseSync(options.dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS ownership (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL);
    INSERT OR IGNORE INTO ownership VALUES(1,0);
    CREATE TABLE IF NOT EXISTS context (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, policy_version INTEGER NOT NULL);
    INSERT OR IGNORE INTO context VALUES(1,1,1);
    CREATE TABLE IF NOT EXISTS effects (effect_id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, payload_digest TEXT NOT NULL, run_id TEXT NOT NULL, action_json TEXT NOT NULL, committed_at INTEGER NOT NULL);`);
  db.exec(
    "CREATE TABLE IF NOT EXISTS namespaced_context (namespace TEXT PRIMARY KEY, revision INTEGER NOT NULL, policy_version INTEGER NOT NULL)",
  );
  const columns = db.prepare("PRAGMA table_info(effects)").all();
  if (!columns.some((column) => column.name === "namespace"))
    db.exec(
      "ALTER TABLE effects ADD COLUMN namespace TEXT NOT NULL DEFAULT 'default'",
    );
  const contextFor = (namespace: string) =>
    namespace === "default"
      ? db.prepare("SELECT * FROM context WHERE id=1").get()
      : db
          .prepare("SELECT * FROM namespaced_context WHERE namespace=?")
          .get(namespace);
  const now = () => {
    if (!options.clockFile) return Date.now();
    const value: unknown = JSON.parse(readFileSync(options.clockFile, "utf8"));
    if (
      !object(value) ||
      !Number.isSafeInteger(value.now) ||
      !Number.isSafeInteger(value.generation) ||
      (value.now as number) <= 0 ||
      (value.generation as number) < 0
    )
      throw new Denied("clock_unavailable", 503);
    return value.now as number;
  };
  const receipt = (row: Record<string, unknown>) => ({
    key: row.key,
    runId: row.run_id,
    payloadDigest: row.payload_digest,
    effectId: row.effect_id,
    action: JSON.parse(row.action_json as string),
    committedAt: row.committed_at,
  });
  const find = (key: string) =>
    db.prepare("SELECT * FROM effects WHERE key=?").get(key);
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (
        !req.headers.host ||
        !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host) ||
        req.headers.origin !== undefined
      )
        throw new Denied("request_denied", 403);
      const actual = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${options.secret}`);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Denied("unauthorized", 401);
      const namespace = req.headers["x-arl-namespace"] ?? "default";
      if (
        typeof namespace !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(namespace)
      )
        throw new Denied("invalid_namespace");
      const path = req.url ?? "";
      if (!["/namespaces", "/epoch"].includes(path) && !contextFor(namespace))
        throw new Denied("namespace_not_found", 404);
      // Synthetic HTTP fault counter is process-local. Worker restarts retain this
      // independent service process; restarting the service resets fault injection.
      if (
        req.method === "GET" &&
        ["/deliveries/delivery-001", "/policy"].includes(path)
      ) {
        if (options.testReadDelayMs && readDelaysRemaining > 0) {
          readDelaysRemaining--;
          await delay(options.testReadDelayMs);
        }
        if (res.destroyed) return;
        if (readFailuresRemaining > 0) {
          readFailuresRemaining--;
          throw new Denied("synthetic_unavailable", 503);
        }
      }
      if (req.method === "GET" && path === "/deliveries/delivery-001") {
        const c = contextFor(namespace)!;
        send(200, {
          ...DELIVERY,
          revision: c.revision,
          description: options.testDeliveryDescription ?? DELIVERY.description,
        });
        return;
      }
      if (req.method === "GET" && path === "/policy") {
        const c = contextFor(namespace)!;
        send(200, { ...POLICY, version: c.policy_version });
        return;
      }
      if (
        req.method === "GET" &&
        /^\/receipts\/[A-Za-z0-9_-]{1,128}$/.test(path)
      ) {
        const row = db
          .prepare("SELECT * FROM effects WHERE key=? AND namespace=?")
          .get(path.slice("/receipts/".length), namespace);
        send(row ? 200 : 404, row ? receipt(row) : { error: "not_found" });
        return;
      }
      if (
        req.method !== "POST" ||
        !["/epoch", "/resolutions", "/namespaces"].includes(path)
      )
        throw new Denied("not_found", 404);
      if (req.headers["content-type"] !== "application/json")
        throw new Denied("json_required", 415);
      const input = await body(req);
      if (path === "/namespaces") {
        if (
          !object(input) ||
          Object.keys(input).join() !== "namespace" ||
          typeof input.namespace !== "string" ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(input.namespace)
        )
          throw new Denied("invalid_namespace");
        if (input.namespace !== "default")
          db.prepare(
            "INSERT OR IGNORE INTO namespaced_context VALUES(?,1,1)",
          ).run(input.namespace);
        send(200, { namespace: input.namespace });
        return;
      }
      if (path === "/epoch") {
        if (!object(input) || Object.keys(input).length !== 0)
          throw new Denied("invalid_request");
        const epoch = db
          .prepare(
            "UPDATE ownership SET epoch=epoch+1 WHERE id=1 RETURNING epoch",
          )
          .get()!.epoch;
        send(200, { epoch });
        return;
      }
      const request = parseRequest(input);
      const digest = payloadDigest(request);
      db.exec("BEGIN IMMEDIATE");
      let result: ReturnType<typeof receipt>;
      try {
        const existing = find(request.key);
        if (existing) {
          if (
            existing.payload_digest !== digest ||
            existing.namespace !== namespace
          )
            throw new Denied("digest_conflict", 409);
          db.exec("COMMIT");
          send(200, receipt(existing));
          return;
        }
        const epoch = db
          .prepare("SELECT epoch FROM ownership WHERE id=1")
          .get()!.epoch;
        if (epoch !== request.epoch) throw new Denied("stale_epoch", 409);
        const context = contextFor(namespace)!;
        if (
          context.revision !== request.expectedRevision ||
          context.policy_version !== request.policyVersion
        )
          throw new Denied("stale_context", 409);
        const committedAt = now();
        if (request.expiresAt <= committedAt)
          throw new Denied("authorization_expired", 409);
        db.prepare(
          "INSERT INTO effects(key,payload_digest,run_id,action_json,committed_at,namespace) VALUES(?,?,?,?,?,?)",
        ).run(
          request.key,
          digest,
          request.runId,
          canonical(request.action),
          committedAt,
          namespace,
        );
        result = receipt(find(request.key)!);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      // Fault injection only: the effect is durably committed and the transaction
      // released before holding the HTTP response. Reconciliation stays available.
      if (options.testBarrierDir) {
        writeFileSync(
          join(options.testBarrierDir, "committed"),
          JSON.stringify({
            barrier: "after-sandbox-commit-v1",
            key: request.key,
          }),
        );
        const deadline = Date.now() + 30_000;
        while (
          !existsSync(join(options.testBarrierDir, "release")) &&
          !res.destroyed &&
          Date.now() < deadline
        )
          await delay(10);
        if (!existsSync(join(options.testBarrierDir, "release"))) {
          res.destroy();
          return;
        }
      }
      send(201, result);
    } catch (error) {
      if (!res.headersSent)
        send(error instanceof Denied ? error.status : 503, {
          error: error instanceof Denied ? error.code : "service_unavailable",
        });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return {
    db,
    listen: (port = 0) =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      }),
    address: () => server.address(),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => {
          db.close();
          error ? reject(error) : resolve();
        }),
      ),
  };
}
