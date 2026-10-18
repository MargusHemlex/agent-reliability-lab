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

export async function getDelivery(
  runId: string,
  sessionId: string,
  authorizedRunId: unknown,
) {
  await boundRun(runId, sessionId, authorizedRunId);
  const input = { runId };
  const cached = store().getRead(runId, "get_delivery", input);
  if (cached !== undefined) return DeliverySchema.parse(cached);
  const output = DeliverySchema.parse(
    await service("/deliveries/delivery-001"),
  );
  store().recordRead(
    runId,
    "get_delivery",
    input,
    output,
    now(),
    config().epoch,
  );
  return output;
}
export async function getPolicy(
  runId: string,
  sessionId: string,
  authorizedRunId: unknown,
) {
  await boundRun(runId, sessionId, authorizedRunId);
  if (store().getRead(runId, "get_delivery", { runId }) === undefined)
    throw new Error("delivery_read_required");
  const cached = store().getRead(runId, "get_resolution_policy", { runId });
  if (cached !== undefined) return PolicySchema.parse(cached);
  const output = PolicySchema.parse(await service("/policy"));
  store().recordRead(
    runId,
    "get_resolution_policy",
    { runId },
    output,
    now(),
    config().epoch,
  );
  return output;
}
export async function proposal(
  runId: string,
  action: unknown,
  sessionId: string,
  authorizedRunId: unknown,
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
) {
  await proposal(runId, action, sessionId, authorizedRunId);
  let run = store().getRun(runId);
  const epoch = config().epoch;
  if (run.intent) {
    try {
      const saved = await receipt(run.intent.key);
      if (saved) {
        if (
          saved.key !== run.intent.key ||
          saved.runId !== runId ||
          saved.payloadDigest !==
            payloadDigest(ResolutionSchema.parse(run.intent))
        )
          throw new Error("receipt_binding_denied");
        if (run.state !== "succeeded")
          store().succeed(runId, saved, now(), epoch);
        return {
          mode: "fixture",
          status: "succeeded",
          receipt: saved,
          reconciled: true,
        };
      }
    } catch {
      if (run.state !== "succeeded")
        store().markUnknown(runId, "receipt_lookup_unavailable", now(), epoch);
      return { mode: "fixture", status: "unknown_outcome" };
    }
  }
  if (run.state === "succeeded")
    throw new Error("receipt_missing_for_succeeded_run");
  if (run.state === "unknown_outcome")
    return { mode: "fixture", status: "unknown_outcome" };
  const intent = ResolutionSchema.parse(
    store().createDispatch(runId, { now: now(), epoch }),
  );
  if (process.env.ARL_LAB_BARRIER_DIR) {
    if (process.env.ARL_TEST_MODE !== "1")
      throw new Error("test_barrier_denied");
    const dir = process.env.ARL_LAB_BARRIER_DIR;
    writeFileSync(join(dir, "dispatch_ready"), intent.key);
    while (!existsSync(join(dir, "release")))
      await new Promise((r) => setTimeout(r, 25));
  }
  try {
    const saved = await service("/resolutions", intent);
    const checked = ReceiptSchema.parse(saved);
    if (
      checked.key !== intent.key ||
      checked.runId !== runId ||
      checked.payloadDigest !== payloadDigest(intent)
    )
      throw new Error("receipt_binding_denied");
    store().succeed(runId, checked, now(), epoch);
    return {
      mode: "fixture",
      status: "succeeded",
      receipt: checked,
      reconciled: false,
    };
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
      return { mode: "fixture", status: "failed", reason: error.message };
    }
    if (
      error instanceof ServiceError &&
      error.message === "authorization_expired"
    ) {
      store().awaitReapproval(runId, now(), epoch);
      return { mode: "fixture", status: store().getRun(runId).state };
    }
    store().markUnknown(runId, "dispatch_outcome_unknown", now(), epoch);
    return { mode: "fixture", status: "unknown_outcome" };
  }
}
