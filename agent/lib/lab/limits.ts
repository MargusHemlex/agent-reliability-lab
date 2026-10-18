/** Immutable defaults copied into every run before its first call. */
export const DEFAULT_LIMITS = Object.freeze({
  modelTurns: 5,
  toolCalls: 8,
  inputBytes: 16_384,
  outputBytes: 16_384,
  toolTimeoutMs: 10_000,
  activeMs: 120_000,
  approvalTtlMs: 900_000,
  requestedModelTokens: 8_000,
  readAttempts: 3,
  reapprovals: 2,
  deadlineMs: 3_600_000,
});
export type Limits = { [K in keyof typeof DEFAULT_LIMITS]: number };
export function validateLimits(value: Partial<Limits> = {}): Limits {
  if (Object.keys(value).some((key) => !Object.hasOwn(DEFAULT_LIMITS, key)))
    throw new Error("unknown limit");
  const result = { ...DEFAULT_LIMITS, ...value };
  for (const [key, limit] of Object.entries(result)) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > DEFAULT_LIMITS[key as keyof Limits]
    )
      throw new Error("invalid limit");
  }
  return result;
}
export type Reservation = {
  id: string;
  digest: string;
  startedAt: number;
  deadline: number;
  finishedAt: number | null;
  outcome: string | null;
  toolName?: string;
  logicalId?: string;
  requestedTokens?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reconciliation?: boolean;
  toolId?: string;
  attempt?: number;
  nextRetryAt?: number | null;
  output?: unknown;
};
export type Budget = {
  modelTurns: number;
  requestedModelTokens: number;
  activeMs: number;
  activeSince: number | null;
  exhausted: string | null;
  models: Record<string, Reservation>;
  tools: Record<string, Reservation>;
  reads: Record<string, Reservation>;
};
export function emptyBudget(): Budget {
  return {
    modelTurns: 0,
    requestedModelTokens: 0,
    activeMs: 0,
    activeSince: null,
    exhausted: null,
    models: {},
    tools: {},
    reads: {},
  };
}
