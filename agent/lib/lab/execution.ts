import { config, now, service, ServiceError, store } from "./runtime.ts";
import { digest } from "./contracts.ts";
import type { Reservation } from "./limits.ts";

export function reserve(
  runId: string,
  toolName: string,
  input: unknown,
  logicalId: string,
  reconciliation = false,
) {
  const item = store().reserveTool(runId, {
    id: `${logicalId}:epoch${config().epoch}${reconciliation ? ":receipt" : ""}`,
    logicalId: ["get_delivery", "get_resolution_policy"].includes(toolName)
      ? `${toolName}:${digest(input)}`
      : logicalId,
    toolName,
    input,
    reconciliation,
    now: now(),
    epoch: config().epoch,
  });
  if (item.finishedAt !== null)
    throw new Error("physical_tool_already_completed");
  return item;
}
export function finish(
  runId: string,
  item: Reservation,
  output: unknown,
  outcome = "succeeded",
) {
  store().finishTool(runId, {
    id: item.id,
    output,
    outcome,
    now: now(),
    epoch: config().epoch,
  });
  return output;
}
export function remaining(runId: string, item: Reservation) {
  const run = store().getRun(runId);
  const elapsed =
    run.budget.activeSince === null
      ? 0
      : Math.max(0, now() - run.budget.activeSince);
  const milliseconds = item.reconciliation
    ? run.limits.toolTimeoutMs
    : Math.min(
        item.deadline - now(),
        run.limits.activeMs - run.budget.activeMs - elapsed,
      );
  if (milliseconds <= 0) {
    store().settleActive(runId, { now: now(), epoch: config().epoch });
    throw new Error("tool_timeout");
  }
  return milliseconds;
}
export async function readWithRetry(
  runId: string,
  item: Reservation,
  path: string,
) {
  const epoch = config().epoch;
  while (true) {
    const run = store().getRun(runId);
    const prior = Object.values(run.budget.reads).filter(
      (r) => run.budget.tools[r.toolId ?? ""]?.logicalId === item.logicalId,
    );
    const last = prior.at(-1);
    if (last?.nextRetryAt && now() < last.nextRetryAt)
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(last.nextRetryAt! - now(), remaining(runId, item)),
        ),
      );
    const attempt = store().reserveReadAttempt(runId, {
      id: `${item.logicalId}:read${prior.length + 1}`,
      toolId: item.id,
      now: now(),
      epoch,
    });
    try {
      const output = await service(path, undefined, {
        namespace: run.namespace,
        timeoutMs: Math.min(3000, remaining(runId, item)),
      });
      store().finishReadAttempt(runId, {
        id: attempt.id,
        outcome: "succeeded",
        now: now(),
        epoch,
      });
      return output;
    } catch (error) {
      const retryable =
        !(error instanceof ServiceError) ||
        [408, 429, 500, 502, 503, 504].includes(error.status);
      const time = now();
      store().finishReadAttempt(runId, {
        id: attempt.id,
        outcome: retryable ? "transient" : "permanent",
        nextRetryAt:
          retryable && time < item.deadline
            ? Math.min(item.deadline, time + 100 * 2 ** prior.length)
            : null,
        now: time,
        epoch,
      });
      if (time >= item.deadline) {
        store().settleActive(runId, { now: time, epoch });
        store().fail(runId, "tool_timeout", time, epoch);
        throw new Error("tool_timeout");
      }
      if (!retryable) {
        store().fail(runId, "read_denied", time, epoch);
        throw new Error("read_denied");
      }
      // reserveReadAttempt persists exhaustion on the next iteration; no fourth GET.
    }
  }
}
