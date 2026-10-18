import type { z } from "zod";
import type { Reservation } from "./limits.ts";
import { reserve, finish, remaining, readWithRetry } from "./execution.ts";
import {
  ActionSchema,
  DeliverySchema,
  PolicySchema,
  ResolutionSchema,
  payloadDigest,
  ReceiptSchema,
} from "./contracts.ts";
import {
  boundRun,
  config,
  now,
  receipt,
  service,
  ServiceError,
  store,
} from "./runtime.ts";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export async function getDelivery(
  runId: string,
  sessionId: string,
  authorizedRunId: unknown,
  callId = "direct",
) {
  await boundRun(runId, sessionId, authorizedRunId);
  const input = { runId };
  const cached = store().getRead(runId, "get_delivery", input);
  if (cached !== undefined) return DeliverySchema.parse(cached);
  const attempt = reserve(runId, "get_delivery", input, callId);
  const output = await checkedRead(
    runId,
    attempt,
    "/deliveries/delivery-001",
    DeliverySchema,
  );
  store().recordRead(
    runId,
    "get_delivery",
    input,
    output,
    now(),
    config().epoch,
  );
  return finish(runId, attempt, output);
}
export async function getPolicy(
  runId: string,
  sessionId: string,
  authorizedRunId: unknown,
  callId = "direct",
) {
  await boundRun(runId, sessionId, authorizedRunId);
  if (store().getRead(runId, "get_delivery", { runId }) === undefined)
    throw new Error("delivery_read_required");
  const cached = store().getRead(runId, "get_resolution_policy", { runId });
  if (cached !== undefined) return PolicySchema.parse(cached);
  const attempt = reserve(runId, "get_resolution_policy", { runId }, callId);
  const output = await checkedRead(runId, attempt, "/policy", PolicySchema);
  store().recordRead(
    runId,
    "get_resolution_policy",
    { runId },
    output,
    now(),
    config().epoch,
  );
  return finish(runId, attempt, output);
}
export async function proposal(
  runId: string,
  action: unknown,
  sessionId: string,
  authorizedRunId: unknown,
  callId = "direct",
) {
  const run = await boundRun(runId, sessionId, authorizedRunId);
  const parsed = ActionSchema.parse(action);
  const delivery = DeliverySchema.parse(
    store().getRead(runId, "get_delivery", { runId }),
  );
  const policy = PolicySchema.parse(
    store().getRead(runId, "get_resolution_policy", { runId }),
  );
  if (
    parsed.kind !== policy.allowedAction ||
    parsed.note !== policy.note ||
    parsed.deliveryId !== run.deliveryId
  )
    throw new Error("policy_denied");
  return store().propose(runId, {
    action: parsed,
    expectedRevision: delivery.revision,
    policyVersion: policy.version,
    now: now(),
    epoch: config().epoch,
  });
}
export async function recordResolution(
  runId: string,
  action: unknown,
  sessionId: string,
  authorizedRunId: unknown,
  callId = "direct",
) {
  await proposal(runId, action, sessionId, authorizedRunId);
  let run = store().getRun(runId);
  const epoch = config().epoch;
  if (run.intent) {
    const result = await reconcileRun(runId);
    if (result.status !== "absent") return result;
    run = store().getRun(runId);
  }
  if (run.state === "succeeded")
    throw new Error("receipt_missing_for_succeeded_run");
  const attempt = reserve(
    runId,
    "record_resolution",
    { runId, action },
    callId,
  );
  if (!run.intent && run.approval && now() >= run.approval.expiresAt) {
    store().fail(runId, "authorization_expired_before_intent", now(), epoch);
    return finish(
      runId,
      attempt,
      {
        mode: "fixture",
        status: "failed",
        reason: "authorization_expired_before_intent",
      },
      "denied",
    );
  }
  const intent = ResolutionSchema.parse(
    store().createDispatch(runId, { now: now(), epoch }),
  );
  if (process.env.ARL_LAB_BARRIER_DIR) {
    if (process.env.ARL_TEST_MODE !== "1")
      throw new Error("test_barrier_denied");
    const dir = process.env.ARL_LAB_BARRIER_DIR;
    writeFileSync(
      join(dir, "dispatch_ready"),
      JSON.stringify({ barrier: "before-dispatch-v1", key: intent.key }),
    );
    while (!existsSync(join(dir, "release")))
      await new Promise((r) => setTimeout(r, 25));
  }
  try {
    remaining(runId, attempt);
    const saved = await service("/resolutions", intent, {
      namespace: run.namespace,
      timeoutMs: remaining(runId, attempt),
    });
    const checked = ReceiptSchema.parse(saved);
    if (
      checked.key !== intent.key ||
      checked.runId !== runId ||
      checked.payloadDigest !== payloadDigest(intent)
    )
      throw new Error("receipt_binding_denied");
    store().succeed(runId, checked, now(), epoch);
    return finish(runId, attempt, {
      mode: "fixture",
      status: "succeeded",
      receipt: checked,
      reconciled: false,
    });
  } catch (error) {
    if (
      error instanceof ServiceError &&
      [
        "stale_context",
        "stale_epoch",
        "digest_conflict",
        "action_denied",
      ].includes(error.message)
    ) {
      store().fail(runId, error.message, now(), epoch);
      return finish(
        runId,
        attempt,
        { mode: "fixture", status: "failed", reason: error.message },
        "permanent",
      );
    }
    if (
      error instanceof ServiceError &&
      error.message === "authorization_expired"
    ) {
      store().awaitReapproval(runId, now(), epoch);
      return finish(
        runId,
        attempt,
        { mode: "fixture", status: store().getRun(runId).state },
        "denied",
      );
    }
    store().markUnknown(runId, "dispatch_outcome_unknown", now(), epoch);
    store().settleActive(runId, { now: now(), epoch, pause: true });
    return finish(
      runId,
      attempt,
      { mode: "fixture", status: "unknown_outcome" },
      "unknown",
    );
  }
}

/** Trusted, read-only operator recovery remains available after execution budgets. */
export async function reconcileRun(runId: string) {
  const run = store().getRun(runId),
    epoch = config().epoch;
  if (!run.intent) throw new Error("intent_required");
  const attempt = reserve(
    runId,
    "record_resolution",
    { runId, receiptKey: run.intent.key },
    `reconcile-${randomUUID()}`,
    true,
  );
  let saved;
  try {
    saved = await receipt(run.intent.key, run.namespace);
  } catch {
    if (run.state !== "succeeded")
      store().markUnknown(runId, "receipt_lookup_unavailable", now(), epoch);
    return finish(
      runId,
      attempt,
      {
        mode: "fixture",
        status: run.state === "succeeded" ? "succeeded" : "unknown_outcome",
      },
      "unknown",
    ) as { status: string };
  }
  if (!saved)
    return finish(
      runId,
      attempt,
      { mode: "fixture", status: "absent" },
      "absent",
    ) as { status: string };
  if (
    saved.key !== run.intent.key ||
    saved.runId !== runId ||
    saved.payloadDigest !== payloadDigest(ResolutionSchema.parse(run.intent))
  ) {
    store().markUnknown(runId, "receipt_binding_denied", now(), epoch);
    return finish(
      runId,
      attempt,
      {
        mode: "fixture",
        status: "unknown_outcome",
        reason: "receipt_binding_denied",
      },
      "denied",
    ) as { status: string };
  }
  if (run.state !== "succeeded") store().succeed(runId, saved, now(), epoch);
  return finish(runId, attempt, {
    mode: "fixture",
    status: "succeeded",
    receipt: saved,
    reconciled: true,
  }) as { status: string };
}

async function checkedRead<T>(
  runId: string,
  attempt: Reservation,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    const value = await readWithRetry(runId, attempt, path);
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      store().fail(runId, "invalid_tool_output", now(), config().epoch);
      throw new Error("invalid_tool_output");
    }
    return parsed.data;
  } catch (error) {
    store().finishTool(runId, {
      id: attempt.id,
      outcome: store().getRun(runId).error ?? "read_failed",
      now: now(),
      epoch: config().epoch,
    });
    throw error;
  }
}
