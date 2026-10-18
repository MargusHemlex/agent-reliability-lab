import { createHash } from "node:crypto";
import { z } from "zod";

export const RUN_ID = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const ActionSchema = z
  .object({
    deliveryId: z.literal("delivery-001"),
    kind: z.literal("request_update"),
    note: z.literal("Please provide a delivery update."),
  })
  .strict();
export type Action = z.infer<typeof ActionSchema>;
export const DeliverySchema = z
  .object({
    id: z.literal("delivery-001"),
    status: z.literal("delayed"),
    revision: z.number().int().positive(),
    description: z.string().max(2048),
  })
  .strict();
export const PolicySchema = z
  .object({
    version: z.number().int().positive(),
    allowedAction: z.literal("request_update"),
    note: z.literal("Please provide a delivery update."),
  })
  .strict();
export const ResolutionSchema = z
  .object({
    key: RUN_ID,
    runId: RUN_ID,
    proposalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    action: ActionSchema,
    expectedRevision: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    epoch: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type ResolutionRequest = z.infer<typeof ResolutionSchema>;
export const ReceiptSchema = z
  .object({
    key: RUN_ID,
    runId: RUN_ID,
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    effectId: z.number().int().positive(),
    action: ActionSchema,
    committedAt: z.number().int().positive(),
  })
  .strict();
export type Receipt = z.infer<typeof ReceiptSchema>;

// Fixed schema, finite values, sorted JSON; no RFC8785 or authenticity claim.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const proposalDigest = (
  runId: string,
  action: Action,
  expectedRevision: number,
  policyVersion: number,
) => digest({ runId, action, expectedRevision, policyVersion });
export function payloadDigest(request: ResolutionRequest) {
  const { runId, proposalDigest, action, expectedRevision, policyVersion } =
    request;
  return digest({
    runId,
    proposalDigest,
    action,
    expectedRevision,
    policyVersion,
  });
}
