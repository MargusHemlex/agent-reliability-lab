import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import {
  getDelivery,
  getPolicy,
  proposal,
  recordResolution,
} from "../lib/lab/workflow.ts";
import { RUN_ID, ActionSchema } from "../lib/lab/contracts.ts";
import { store } from "../lib/lab/runtime.ts";

export default defineDynamic({
  events: {
    "session.started": () =>
      process.env.ARL_LAB_MODE === "fixture"
        ? {
            get_delivery: defineTool({
              description: "Read the bound synthetic delivery status.",
              inputSchema: z.object({ runId: RUN_ID }).strict(),
              execute: ({ runId }, ctx) =>
                getDelivery(
                  runId,
                  ctx.session.id,
                  ctx.session.auth.current?.attributes.runId,
                  ctx.callId,
                ),
            }),
            get_resolution_policy: defineTool({
              description:
                "Read permitted synthetic resolutions after the delivery.",
              inputSchema: z.object({ runId: RUN_ID }).strict(),
              execute: ({ runId }, ctx) =>
                getPolicy(
                  runId,
                  ctx.session.id,
                  ctx.session.auth.current?.attributes.runId,
                  ctx.callId,
                ),
            }),
            record_resolution: defineTool({
              description:
                "Propose and, after bound human approval, record the allowed synthetic resolution.",
              inputSchema: z
                .object({ runId: RUN_ID, action: ActionSchema })
                .strict(),
              endsTurn: true,
              approval: async ({ session, toolInput }) => {
                if (!toolInput) return "denied";
                await proposal(
                  toolInput.runId,
                  toolInput.action,
                  session.id,
                  session.auth.current?.attributes.runId,
                );
                const run = store().getRun(toolInput.runId);
                return run.intent && run.state !== "awaiting_reapproval"
                  ? "not-applicable"
                  : "user-approval";
              },
              execute: ({ runId, action }, ctx) =>
                recordResolution(
                  runId,
                  action,
                  ctx.session.id,
                  ctx.session.auth.current?.attributes.runId,
                  ctx.callId,
                ),
            }),
          }
        : null,
  },
});
