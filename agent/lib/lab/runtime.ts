import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { AppStore } from "./store.ts";
import { RUN_ID, ReceiptSchema } from "./contracts.ts";

export function config() {
  const mode = process.env.ARL_LAB_MODE;
  if (mode !== "fixture" && mode !== "live")
    throw new Error("Lab mode required");
  if (
    mode === "live" &&
    (process.env.ARL_LIVE_OPT_IN !== "1" ||
      !process.env.AI_GATEWAY_API_KEY ||
      !process.env.AGENT_MODEL ||
      Object.keys(process.env).some(
        (key) =>
          key.startsWith("ARL_FAULT_") ||
          key === "ARL_TEST_MODE" ||
          key === "ARL_CLOCK_FILE",
      ))
  )
    throw new Error("live_configuration_denied");
  const dbPath = process.env.ARL_LAB_DB,
    serviceSecret = process.env.ARL_SERVICE_SECRET,
    operatorSecret = process.env.ARL_OPERATOR_SECRET;
  const url = new URL(process.env.ARL_SERVICE_URL ?? "http://127.0.0.1:0");
  if (
    !dbPath ||
    !serviceSecret ||
    serviceSecret.length < 24 ||
    !operatorSecret ||
    operatorSecret.length < 24 ||
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.port ||
    url.port === "0"
  )
    throw new Error("Invalid local lab configuration");
  const epoch = Number(process.env.ARL_WORKER_EPOCH);
  if (!Number.isSafeInteger(epoch) || epoch < 1)
    throw new Error("Worker epoch required");
  return {
    mode: mode as "fixture" | "live",
    dbPath,
    serviceSecret,
    operatorSecret,
    serviceURL: url.origin,
    epoch,
  };
}
let storeInstance: AppStore | undefined;
export function store() {
  return (storeInstance ??= new AppStore(config().dbPath));
}
export function now() {
  if (!process.env.ARL_CLOCK_FILE) return Date.now();
  if (process.env.ARL_TEST_MODE !== "1") throw new Error("Test clock denied");
  const clock = JSON.parse(
    readFileSync(process.env.ARL_CLOCK_FILE, "utf8"),
  ) as { now: number; generation: number };
  if (
    !Number.isSafeInteger(clock.now) ||
    clock.now <= 0 ||
    !Number.isSafeInteger(clock.generation) ||
    clock.generation < 0
  )
    throw new Error("Invalid test clock");
  return clock.now;
}
export function authorize(request: Request) {
  const expected = Buffer.from(`Bearer ${config().operatorSecret}`),
    actual = Buffer.from(request.headers.get("authorization") ?? "");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (
    !/^127\.0\.0\.1:\d+$/.test(host) ||
    request.headers.has("origin") ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  )
    throw new Error("request_denied");
}
export async function jsonBody(request: Request) {
  if (request.headers.get("content-type") !== "application/json")
    throw new Error("json_required");
  if (Number(request.headers.get("content-length") ?? 0) > 16384)
    throw new Error("body_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_json");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 16384) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export class ServiceError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}
export async function service(
  path: string,
  data?: unknown,
  options: { namespace?: string; timeoutMs?: number } = {},
): Promise<unknown> {
  const cfg = config();
  const response = await fetch(cfg.serviceURL + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${cfg.serviceSecret}`,
      "x-arl-namespace": options.namespace ?? "default",
      ...(data === undefined ? {} : { "content-type": "application/json" }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    redirect: "error",
    signal: AbortSignal.timeout(
      Math.max(1, Math.floor(Math.min(10000, options.timeoutMs ?? 10000))),
    ),
  });
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new ServiceError(502, "oversized_service_response");
    }
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    error?: string;
  };
  if (!response.ok)
    throw new ServiceError(
      response.status,
      typeof body.error === "string" && /^[a-z_]{1,64}$/.test(body.error)
        ? body.error
        : "service_error",
    );
  return body;
}
export async function receipt(key: string, namespace = "default") {
  RUN_ID.parse(key);
  try {
    return ReceiptSchema.parse(
      await service(`/receipts/${key}`, undefined, { namespace }),
    );
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) return null;
    throw error;
  }
}
export async function boundRun(
  runId: string,
  sessionId: string,
  authorizedRunId: unknown,
) {
  RUN_ID.parse(runId);
  if (authorizedRunId !== runId)
    throw new Error("authenticated_run_binding_denied");
  for (let i = 0; i < 40; i++) {
    const run = store().getRun(runId);
    if (run.sessionId === sessionId) return run;
    if (run.sessionId) throw new Error("session_binding_denied");
    store().bindSession(runId, sessionId, now());
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("session_binding_unavailable");
}
