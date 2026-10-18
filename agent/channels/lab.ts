import { defineChannel, GET, POST, type Session } from "eve/channels";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authorize, config, jsonBody, now, store } from "../lib/lab/runtime.ts";
import { RUN_ID } from "../lib/lab/contracts.ts";

const baseAuth = {
  authenticator: "lab-operator",
  principalId: "local-operator",
  principalType: "user" as const,
  attributes: {},
};
const runAuth = (runId: string) => ({ ...baseAuth, attributes: { runId } });
const decisions = new Map<string, Promise<void>>();
const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
const guarded =
  (handler: (request: Request, args: any) => Promise<Response>) =>
  async (request: Request, args: any) => {
    try {
      authorize(request);
      return await handler(request, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request_failed";
      const known = [
        "request_denied",
        "json_required",
        "body_too_large",
        "run not found",
        "approval conflict",
        "terminal run",
      ];
      return response(
        { error: known.includes(message) ? message : "request_conflict" },
        message === "request_denied" ? 403 : 409,
      );
    }
  };
async function pending(session: Session) {
  const stream = await session.getEventStream({ follow: false });
  const reader = stream.getReader();
  const requests = new Map<string, any>();
  let count = 0;
  while (true) {
    const { value: event, done } = await reader.read();
    if (done) break;
    if (++count > 2000) {
      await reader.cancel();
      throw new Error("event_limit");
    }
    if (event.type === "input.requested")
      for (const request of event.data.requests)
        requests.set(request.requestId, request);
    if (event.type === "input.resolved")
      for (const item of event.data.resolutions)
        requests.delete(item.requestId);
  }
  return [...requests.values()];
}
export default defineChannel({
  routes: [
    GET(
      "/lab/runs",
      guarded(async () =>
        response({ mode: "fixture", runs: store().listRuns() }),
      ),
    ),
    GET(
      "/lab/runs/:runId",
      guarded(async (_r, { params }) => {
        RUN_ID.parse(params.runId);
        return response({
          mode: "fixture",
          run: store().getRun(params.runId),
          events: store().getEvents(params.runId),
        });
      }),
    ),
    POST(
      "/lab/runs",
      guarded(async (request, { from }) => {
        z.object({ deliveryId: z.literal("delivery-001") })
          .strict()
          .parse(await jsonBody(request));
        const runId = randomUUID();
        store().createRun({
          runId,
          deliveryId: "delivery-001",
          epoch: config().epoch,
          now: now(),
        });
        const session = await from(runId).send(
          JSON.stringify({ runId, deliveryId: "delivery-001" }),
          { auth: runAuth(runId) },
        );
        store().bindSession(runId, session.id, now());
        return response({ mode: "fixture", run: store().getRun(runId) }, 201);
      }),
    ),
    POST(
      "/lab/runs/:runId/approve",
      guarded(async (request, { params, attachSession, from }) => {
        const { proposalDigest } = z
          .object({ proposalDigest: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict()
          .parse(await jsonBody(request));
        const runId = RUN_ID.parse(params.runId);
        const before = store().getRun(runId);
        if (before.proposal?.digest !== proposalDigest)
          throw new Error("approval conflict");
        let active = decisions.get(runId);
        if (!active) {
          active = (async () => {
            const run = store().getRun(runId);
            if (
              ![
                "awaiting_approval",
                "awaiting_reapproval",
                "approved",
              ].includes(run.state)
            )
              return;
            if (!run.sessionId) throw new Error("run not ready");
            const session = attachSession(run.sessionId);
            const requests = await pending(session);
            const approval = requests.find(
              (r) =>
                r.kind === "tool-approval" &&
                r.action?.toolName === "record_resolution" &&
                r.action?.input?.runId === runId,
            );
            if (!approval && !run.intent)
              throw new Error("pending approval unavailable");
            if (run.state !== "approved")
              store().approve(runId, { proposalDigest, now: now() });
            if (approval)
              await session.respond(
                [{ requestId: approval.requestId, optionId: "approve" }],
                { auth: runAuth(runId) },
              );
            else
              await from(runId).send(
                JSON.stringify({
                  runId,
                  deliveryId: "delivery-001",
                  resume: true,
                }),
                { auth: runAuth(runId) },
              );
          })();
          decisions.set(runId, active);
        }
        try {
          await active;
        } finally {
          if (decisions.get(runId) === active) decisions.delete(runId);
        }
        return response({ mode: "fixture", run: store().getRun(runId) });
      }),
    ),
    POST(
      "/lab/runs/:runId/reject",
      guarded(async (request, { params, attachSession }) => {
        z.object({})
          .strict()
          .parse(await jsonBody(request));
        const run = store().getRun(params.runId);
        store().reject(run.runId, now());
        if (run.sessionId) await attachSession(run.sessionId).cancel();
        return response({ mode: "fixture", run: store().getRun(run.runId) });
      }),
    ),
    POST(
      "/lab/runs/:runId/cancel",
      guarded(async (request, { params, attachSession }) => {
        z.object({})
          .strict()
          .parse(await jsonBody(request));
        const run = store().getRun(params.runId);
        store().cancel(run.runId, now());
        if (!run.intent && run.sessionId)
          await attachSession(run.sessionId).cancel();
        return response({ mode: "fixture", run: store().getRun(run.runId) });
      }),
    ),
    POST(
      "/lab/runs/:runId/resume",
      guarded(async (request, { params, from }) => {
        z.object({})
          .strict()
          .parse(await jsonBody(request));
        const run = store().getRun(RUN_ID.parse(params.runId));
        if (
          !run.intent ||
          !["executing", "unknown_outcome"].includes(run.state)
        )
          throw new Error("resume denied");
        await from(run.runId).send(
          JSON.stringify({
            runId: run.runId,
            deliveryId: "delivery-001",
            resume: true,
          }),
          { auth: runAuth(run.runId) },
        );
        return response({ mode: "fixture", run: store().getRun(run.runId) });
      }),
    ),
  ],
});
