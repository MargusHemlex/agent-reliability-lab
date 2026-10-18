import {
  DEFAULT_LIMITS,
  validateLimits,
  emptyBudget,
  type Limits,
  type Budget,
  type Reservation,
} from "./limits.ts";
import { DatabaseSync } from "node:sqlite";
import {
  canonical as stable,
  digest,
  proposalDigest,
  type Action,
  type ResolutionRequest,
} from "./contracts.ts";
export { proposalDigest } from "./contracts.ts";
export type { Action } from "./contracts.ts";

export type Proposal = {
  digest: string;
  action: Action;
  expectedRevision: number;
  policyVersion: number;
};
export type Intent = ResolutionRequest;
type Approval = {
  proposalDigest: string;
  expiresAt: number;
  consumed: boolean;
  decidedAt: number;
};
export type Run = {
  runId: string;
  namespace: string;
  deliveryId: string;
  sessionId: string | null;
  epoch: number;
  revision: number;
  state: string;
  createdAt: number;
  deadline: number;
  toolCalls: number;
  limits: Limits;
  budget: Budget;
  reapprovals: number;
  cancellationRequested: boolean;
  proposal: Proposal | null;
  approval: Approval | null;
  intent: Intent | null;
  receipt: unknown;
  error: string | null;
  reads: Record<string, unknown>;
};
/** Local single-host application state. Every mutation commits state and its event together. */
export class AppStore {
  private db: DatabaseSync;
  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS ownership (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);`);
  }
  close() {
    this.db.close();
  }
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  activateEpoch(epoch: number, _now = Date.now()) {
    return this.tx(() => {
      const current = this.db
        .prepare("SELECT epoch FROM ownership WHERE id=1")
        .get() as { epoch: number } | undefined;
      if (
        !Number.isSafeInteger(epoch) ||
        epoch < 1 ||
        (current && epoch <= current.epoch)
      )
        throw new Error("epoch must increase");
      this.db
        .prepare(
          "INSERT INTO ownership VALUES (1,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch",
        )
        .run(epoch);
    });
  }
  private owner(epoch: number) {
    const row = this.db
      .prepare("SELECT epoch FROM ownership WHERE id=1")
      .get() as { epoch: number } | undefined;
    if (!row || row.epoch !== epoch) throw new Error("stale worker epoch");
  }
  getRun(runId: string): Run {
    const row = this.db
      .prepare("SELECT data FROM runs WHERE id=?")
      .get(runId) as { data: string } | undefined;
    if (!row) throw new Error("run not found");
    const run = JSON.parse(row.data) as Run;
    run.namespace ??= "default";
    run.limits ??= { ...DEFAULT_LIMITS };
    run.budget ??= emptyBudget();
    return run;
  }
  listRuns(): Run[] {
    return (
      this.db.prepare("SELECT data FROM runs ORDER BY id").all() as {
        data: string;
      }[]
    ).map((row) => this.getRun((JSON.parse(row.data) as Run).runId));
  }
  getEvents(runId: string) {
    return this.db
      .prepare("SELECT id,at,kind,data FROM events WHERE run_id=? ORDER BY id")
      .all(runId)
      .map((row) => ({
        ...row,
        data: JSON.parse(String(row.data)) as unknown,
      }));
  }
  private event(runId: string, now: number, kind: string, data: unknown = {}) {
    this.db
      .prepare("INSERT INTO events(run_id,at,kind,data) VALUES (?,?,?,?)")
      .run(runId, now, kind, JSON.stringify(data));
  }
  private change<T>(
    runId: string,
    now: number,
    kind: string,
    fn: (run: Run) => T,
    epoch?: number,
  ): T {
    return this.tx(() => {
      const run = this.getRun(runId);
      if (
        epoch !== undefined ||
        [
          "read_completed",
          "proposed",
          "dispatch_intent",
          "succeeded",
          "unknown_outcome",
          "authorization_expired",
          "failed",
        ].includes(kind)
      )
        this.owner(epoch as number);
      const old = run.revision;
      const result = fn(run);
      run.revision++;
      const updated = this.db
        .prepare("UPDATE runs SET revision=?,data=? WHERE id=? AND revision=?")
        .run(run.revision, JSON.stringify(run), runId, old);
      if (updated.changes !== 1) throw new Error("revision conflict");
      this.event(runId, now, kind);
      return result;
    });
  }
  createRun(input: {
    runId: string;
    deliveryId: string;
    sessionId?: string;
    epoch: number;
    now: number;
    limits?: Partial<Limits>;
    namespace?: string;
  }) {
    return this.tx(() => {
      this.owner(input.epoch);
      const limits = validateLimits(input.limits);
      const run: Run = {
        runId: input.runId,
        namespace: input.namespace ?? "default",
        deliveryId: input.deliveryId,
        epoch: input.epoch,
        sessionId: input.sessionId ?? null,
        revision: 0,
        state: "queued",
        createdAt: input.now,
        deadline: input.now + limits.deadlineMs,
        limits,
        budget: emptyBudget(),
        toolCalls: 0,
        reapprovals: 0,
        cancellationRequested: false,
        proposal: null,
        approval: null,
        intent: null,
        receipt: null,
        error: null,
        reads: {},
      };
      this.db
        .prepare("INSERT INTO runs VALUES (?,?,?)")
        .run(run.runId, 0, JSON.stringify(run));
      this.event(run.runId, input.now, "created");
      return run;
    });
  }
  private tick(run: Run, now: number) {
    if (!Number.isSafeInteger(now) || now < run.createdAt)
      throw new Error("invalid clock");
    if (run.budget.activeSince !== null) {
      if (now < run.budget.activeSince) throw new Error("clock regressed");
      run.budget.activeMs = Math.min(
        run.limits.activeMs,
        run.budget.activeMs + now - run.budget.activeSince,
      );
      run.budget.activeSince = now;
    }
  }
  private pause(run: Run, now: number) {
    this.tick(run, now);
    run.budget.activeSince = null;
  }
  private permit(run: Run, now: number, reason?: string): boolean {
    this.tick(run, now);
    const exhausted =
      reason ??
      (now >= run.deadline
        ? "run_deadline"
        : run.budget.activeMs >= run.limits.activeMs
          ? "active_budget"
          : run.budget.exhausted);
    if (!exhausted) return true;
    run.budget.exhausted = exhausted;
    if (!["succeeded", "failed", "cancelled"].includes(run.state))
      run.error = exhausted;
    this.pause(run, now);
    if (run.intent && !["succeeded", "failed", "cancelled"].includes(run.state))
      run.state = "unknown_outcome";
    else if (!["succeeded", "failed", "cancelled"].includes(run.state))
      run.state = "failed";
    return false;
  }
  beginActive(runId: string, input: { now: number; epoch: number }) {
    return this.change(
      runId,
      input.now,
      "active_started",
      (run) => {
        if (
          [
            "awaiting_approval",
            "awaiting_reapproval",
            "succeeded",
            "failed",
            "cancelled",
          ].includes(run.state)
        )
          throw new Error("active execution not allowed");
        if (!this.permit(run, input.now)) return false;
        run.budget.activeSince ??= input.now;
        return true;
      },
      input.epoch,
    );
  }
  settleActive(
    runId: string,
    input: { now: number; epoch: number; pause?: boolean },
  ) {
    return this.change(
      runId,
      input.now,
      "active_accounted",
      (run) => {
        const allowed = this.permit(run, input.now);
        if (input.pause) this.pause(run, input.now);
        return allowed;
      },
      input.epoch,
    );
  }
  reserveModel(
    runId: string,
    input: { id: string; requestedTokens: number; now: number; epoch: number },
  ) {
    const result = this.change(
      runId,
      input.now,
      "model_reserved",
      (run) => {
        if (
          !/^[A-Za-z0-9_:.-]{1,256}$/.test(input.id) ||
          ["__proto__", "constructor", "prototype"].includes(input.id)
        )
          throw new Error("invalid reservation identity");
        const hash = digest({ requestedTokens: input.requestedTokens });
        const old = run.budget.models[input.id];
        if (old) {
          if (old.digest !== hash) throw new Error("model replay conflict");
          return old;
        }
        if (
          !Number.isSafeInteger(input.requestedTokens) ||
          input.requestedTokens < 1
        )
          throw new Error("invalid model reservation");
        if (["succeeded", "failed", "cancelled"].includes(run.state))
          throw new Error("terminal run");
        const reason =
          run.budget.modelTurns >= run.limits.modelTurns
            ? "model_turn_budget"
            : run.budget.requestedModelTokens + input.requestedTokens >
                run.limits.requestedModelTokens
              ? "model_token_budget"
              : undefined;
        if (!this.permit(run, input.now, reason)) return null;
        run.budget.activeSince ??= input.now;
        run.budget.modelTurns++;
        run.budget.requestedModelTokens += input.requestedTokens;
        const reservation: Reservation = {
          id: input.id,
          digest: hash,
          startedAt: input.now,
          deadline: Math.min(
            run.deadline,
            input.now + run.limits.activeMs - run.budget.activeMs,
          ),
          finishedAt: null,
          outcome: null,
          requestedTokens: input.requestedTokens,
          inputTokens: null,
          outputTokens: null,
        };
        run.budget.models[input.id] = reservation;
        return reservation;
      },
      input.epoch,
    );
    if (!result) throw new Error("budget exhausted");
    return result;
  }
  finishModel(
    runId: string,
    input: {
      id: string;
      now: number;
      epoch: number;
      inputTokens?: number | null;
      outputTokens?: number | null;
      outcome?: string;
    },
  ) {
    return this.change(
      runId,
      input.now,
      "model_finished",
      (run) => {
        const item = run.budget.models[input.id];
        if (!item) throw new Error("model reservation missing");
        if (item.finishedAt !== null) return item;
        for (const value of [input.inputTokens, input.outputTokens])
          if (value != null && (!Number.isSafeInteger(value) || value < 0))
            throw new Error("invalid model usage");
        this.tick(run, input.now);
        item.finishedAt = input.now;
        item.outcome = input.outcome ?? "completed";
        item.inputTokens = input.inputTokens ?? null;
        item.outputTokens = input.outputTokens ?? null;
        return item;
      },
      input.epoch,
    );
  }
  reserveTool(
    runId: string,
    input: {
      id: string;
      toolName: string;
      input: unknown;
      now: number;
      epoch: number;
      reconciliation?: boolean;
      logicalId?: string;
    },
  ) {
    const result = this.change(
      runId,
      input.now,
      "tool_reserved",
      (run) => {
        if (
          !/^[A-Za-z0-9_:.-]{1,256}$/.test(input.id) ||
          ["__proto__", "constructor", "prototype"].includes(input.id)
        )
          throw new Error("invalid reservation identity");
        const hash = digest({ toolName: input.toolName, input: input.input });
        const old = run.budget.tools[input.id];
        if (old) {
          if (
            old.digest !== hash ||
            !!old.reconciliation !== !!input.reconciliation ||
            old.logicalId !== (input.logicalId ?? input.id)
          )
            throw new Error("tool replay conflict");
          return old;
        }
        if (
          ![
            "get_delivery",
            "get_resolution_policy",
            "record_resolution",
          ].includes(input.toolName)
        )
          throw new Error("tool denied");
        if (Buffer.byteLength(stable(input.input)) > run.limits.inputBytes)
          throw new Error("tool input limit");
        if (input.reconciliation) {
          if (!run.intent || input.toolName !== "record_resolution")
            throw new Error("reconciliation denied");
        } else {
          if (
            [
              "succeeded",
              "failed",
              "cancelled",
              "awaiting_approval",
              "awaiting_reapproval",
            ].includes(run.state)
          )
            throw new Error("tool not allowed");
          if (
            !this.permit(
              run,
              input.now,
              run.toolCalls >= run.limits.toolCalls
                ? "tool_call_budget"
                : undefined,
            )
          )
            return null;
          run.toolCalls++;
          run.budget.activeSince ??= input.now;
        }
        const item: Reservation = {
          id: input.id,
          digest: hash,
          toolName: input.toolName,
          logicalId: input.logicalId ?? input.id,
          startedAt: input.now,
          deadline: input.reconciliation
            ? input.now + run.limits.toolTimeoutMs
            : Math.min(
                run.deadline,
                input.now + run.limits.toolTimeoutMs,
                input.now + run.limits.activeMs - run.budget.activeMs,
              ),
          finishedAt: null,
          outcome: null,
          reconciliation: !!input.reconciliation,
        };
        run.budget.tools[input.id] = item;
        return item;
      },
      input.epoch,
    );
    if (!result) throw new Error("budget exhausted");
    return result;
  }
  finishTool(
    runId: string,
    input: {
      id: string;
      output?: unknown;
      outcome: string;
      now: number;
      epoch: number;
    },
  ) {
    return this.change(
      runId,
      input.now,
      "tool_finished",
      (run) => {
        const item = run.budget.tools[input.id];
        if (!item) throw new Error("tool reservation missing");
        if (item.finishedAt !== null) {
          if (
            item.outcome !== input.outcome ||
            (input.output !== undefined &&
              stable(item.output) !== stable(input.output))
          )
            throw new Error("tool completion replay conflict");
          return item;
        }
        if (
          input.output !== undefined &&
          Buffer.byteLength(stable(input.output)) > run.limits.outputBytes
        )
          throw new Error("tool output limit");
        if (!item.reconciliation) this.permit(run, input.now);
        item.finishedAt = input.now;
        item.outcome = input.outcome;
        if (input.output !== undefined) item.output = input.output;
        return item;
      },
      input.epoch,
    );
  }
  reserveReadAttempt(
    runId: string,
    input: { id: string; toolId: string; now: number; epoch: number },
  ) {
    const result = this.change(
      runId,
      input.now,
      "read_attempt_reserved",
      (run) => {
        if (
          !/^[A-Za-z0-9_:.-]{1,256}$/.test(input.id) ||
          ["__proto__", "constructor", "prototype"].includes(input.id)
        )
          throw new Error("invalid reservation identity");
        const old = run.budget.reads[input.id];
        if (old) {
          if (old.toolId !== input.toolId)
            throw new Error("read replay conflict");
          return old;
        }
        const tool = run.budget.tools[input.toolId];
        if (
          !tool ||
          !["get_delivery", "get_resolution_policy"].includes(
            tool.toolName ?? "",
          )
        )
          throw new Error("read tool reservation missing");
        const logicalId = tool.logicalId ?? tool.id;
        const prior = Object.values(run.budget.reads).filter((item) => {
          const reservation = run.budget.tools[item.toolId ?? ""];
          return (
            reservation &&
            (reservation.logicalId ?? reservation.id) === logicalId
          );
        });
        for (const item of prior) {
          if (item.finishedAt === null) {
            if (item.toolId === input.toolId)
              throw new Error("read attempt still unresolved");
            item.finishedAt = input.now;
            item.outcome = "interrupted";
          }
        }
        const previous = prior.at(-1);
        if (previous?.nextRetryAt != null && input.now < previous.nextRetryAt)
          throw new Error("retry backoff pending");
        const count = prior.length;
        if (
          !this.permit(
            run,
            input.now,
            count >= run.limits.readAttempts
              ? "read_attempt_budget"
              : input.now >= tool.deadline
                ? "tool_timeout"
                : undefined,
          )
        )
          return null;
        const item: Reservation = {
          id: input.id,
          digest: digest({ toolId: input.toolId }),
          toolId: input.toolId,
          attempt: count + 1,
          startedAt: input.now,
          deadline: tool.deadline,
          finishedAt: null,
          outcome: null,
        };
        run.budget.reads[input.id] = item;
        return item;
      },
      input.epoch,
    );
    if (!result) throw new Error("budget exhausted");
    return result;
  }
  finishReadAttempt(
    runId: string,
    input: {
      id: string;
      outcome: string;
      now: number;
      epoch: number;
      nextRetryAt?: number | null;
    },
  ) {
    return this.change(
      runId,
      input.now,
      "read_attempt_finished",
      (run) => {
        const item = run.budget.reads[input.id];
        if (!item) throw new Error("read reservation missing");
        if (item.finishedAt === null) {
          this.tick(run, input.now);
          item.finishedAt = input.now;
          item.outcome = input.outcome;
          if (
            input.nextRetryAt != null &&
            (!Number.isSafeInteger(input.nextRetryAt) ||
              input.nextRetryAt < input.now ||
              input.nextRetryAt > item.deadline)
          )
            throw new Error("invalid retry deadline");
          item.nextRetryAt = input.nextRetryAt ?? null;
        }
        return item;
      },
      input.epoch,
    );
  }
  bindSession(runId: string, sessionId: string, now = Date.now()) {
    this.change(runId, now, "session_bound", (run) => {
      if (run.sessionId && run.sessionId !== sessionId)
        throw new Error("session already bound");
      run.sessionId = sessionId;
    });
  }
  getRead(runId: string, toolName: string, input: unknown): unknown {
    return this.getRun(runId).reads[digest({ toolName, input })];
  }
  recordRead(
    runId: string,
    toolName: string,
    input: unknown,
    output: unknown,
    now: number,
    epoch: number,
  ) {
    return this.change(
      runId,
      now,
      "read_completed",
      (run) => {
        const key = digest({ toolName, input });
        if (Object.hasOwn(run.reads, key)) {
          if (stable(run.reads[key]) !== stable(output))
            throw new Error("read replay conflict");
          return run.reads[key];
        }
        if (!["queued", "running"].includes(run.state))
          throw new Error("read not allowed");
        if (now > run.deadline) throw new Error("run deadline");
        if (
          Buffer.byteLength(stable(input)) > run.limits.inputBytes ||
          Buffer.byteLength(stable(output)) > run.limits.outputBytes
        )
          throw new Error("tool payload limit");
        const reserved = Object.values(run.budget.tools).some(
          (tool) =>
            tool.toolName === toolName &&
            tool.digest === digest({ toolName, input }),
        );
        if (!reserved && run.toolCalls >= run.limits.toolCalls)
          throw new Error("tool budget exhausted");
        if (!reserved) run.toolCalls++;
        run.reads[key] = output;
        run.state = "running";
        return output;
      },
      epoch,
    );
  }
  propose(
    runId: string,
    input: {
      action: Action;
      expectedRevision: number;
      policyVersion: number;
      now: number;
      epoch: number;
    },
  ) {
    return this.change(
      runId,
      input.now,
      "proposed",
      (run) => {
        const digest = proposalDigest(
          runId,
          input.action,
          input.expectedRevision,
          input.policyVersion,
        );
        if (run.proposal) {
          if (run.proposal.digest !== digest)
            throw new Error("proposal immutable");
          return run.proposal;
        }
        if (
          !["queued", "running"].includes(run.state) ||
          run.cancellationRequested ||
          input.now > run.deadline
        )
          throw new Error("proposal not allowed");
        if (
          input.action.deliveryId !== run.deliveryId ||
          input.action.kind !== "request_update" ||
          input.action.note !== "Please provide a delivery update."
        )
          throw new Error("action denied");
        run.proposal = {
          digest,
          action: input.action,
          expectedRevision: input.expectedRevision,
          policyVersion: input.policyVersion,
        };
        this.pause(run, input.now);
        run.state = "awaiting_approval";
        return run.proposal;
      },
      input.epoch,
    );
  }
  approve(runId: string, input: { proposalDigest: string; now: number }) {
    return this.change(runId, input.now, "approved", (run) => {
      if (
        !["awaiting_approval", "awaiting_reapproval"].includes(run.state) ||
        !run.proposal ||
        run.proposal.digest !== input.proposalDigest ||
        run.cancellationRequested ||
        input.now >= run.deadline
      )
        throw new Error("approval conflict");
      if (run.state === "awaiting_reapproval") {
        if (run.reapprovals >= run.limits.reapprovals)
          throw new Error("reapproval exhausted");
        run.reapprovals++;
      }
      const approval = {
        proposalDigest: input.proposalDigest,
        expiresAt: Math.min(input.now + run.limits.approvalTtlMs, run.deadline),
        consumed: false,
        decidedAt: input.now,
      };
      run.approval = approval;
      run.state = "approved";
      this.event(runId, input.now, "approval_decision", approval);
      return approval;
    });
  }
  reject(runId: string, now = Date.now()) {
    this.change(runId, now, "rejected", (run) => {
      if (run.intent || !["awaiting_approval", "approved"].includes(run.state))
        throw new Error("rejection conflict");
      this.pause(run, now);
      run.state = "cancelled";
    });
  }
  cancel(runId: string, now = Date.now()) {
    this.change(runId, now, "cancellation_requested", (run) => {
      if (["succeeded", "failed", "cancelled"].includes(run.state))
        throw new Error("terminal run");
      run.cancellationRequested = true;
      if (!run.intent || run.state === "awaiting_reapproval") {
        this.pause(run, now);
        run.state = "cancelled";
      }
    });
  }
  createDispatch(runId: string, input: { now: number; epoch: number }): Intent {
    if (!this.settleActive(runId, input)) throw new Error("budget exhausted");
    return this.change(
      runId,
      input.now,
      "dispatch_intent",
      (run) => {
        this.owner(input.epoch);
        if (
          run.intent &&
          ["executing", "unknown_outcome"].includes(run.state)
        ) {
          run.state = "executing";
          run.intent.epoch = input.epoch;
          run.intent.expiresAt = Math.min(
            run.intent.expiresAt,
            input.now + run.limits.activeMs - run.budget.activeMs,
          );
          run.epoch = input.epoch;
          return run.intent;
        }
        if (
          run.state !== "approved" ||
          !run.proposal ||
          !run.approval ||
          run.approval.consumed ||
          run.cancellationRequested ||
          input.now >= run.approval.expiresAt ||
          input.now >= run.deadline ||
          run.approval.proposalDigest !== run.proposal.digest
        )
          throw new Error("dispatch denied");
        const reserved = Object.values(run.budget.tools).some(
          (tool) => tool.toolName === "record_resolution",
        );
        if (!reserved && run.toolCalls >= run.limits.toolCalls)
          throw new Error("tool budget exhausted");
        if (!reserved) run.toolCalls++;
        run.approval.consumed = true;
        run.intent = {
          action: run.proposal.action,
          expectedRevision: run.proposal.expectedRevision,
          policyVersion: run.proposal.policyVersion,
          key: digest({ runId, proposalDigest: run.proposal.digest }),
          runId,
          proposalDigest: run.proposal.digest,
          epoch: input.epoch,
          expiresAt: Math.min(
            run.approval.expiresAt,
            input.now + run.limits.activeMs - run.budget.activeMs,
          ),
        };
        run.epoch = input.epoch;
        run.state = "executing";
        return run.intent;
      },
      input.epoch,
    );
  }
  succeed(runId: string, receipt: unknown, now: number, epoch: number) {
    this.change(
      runId,
      now,
      "succeeded",
      (run) => {
        if (
          !run.intent ||
          ![
            "executing",
            "unknown_outcome",
            "approved",
            "awaiting_reapproval",
          ].includes(run.state)
        )
          throw new Error("no accepted intent");
        run.receipt = receipt;
        this.pause(run, now);
        run.state = "succeeded";
        run.error = null;
      },
      epoch,
    );
  }
  markUnknown(runId: string, reason: string, now: number, epoch: number) {
    this.change(
      runId,
      now,
      "unknown_outcome",
      (run) => {
        if (
          !run.intent ||
          ![
            "executing",
            "unknown_outcome",
            "approved",
            "awaiting_reapproval",
          ].includes(run.state)
        )
          throw new Error("no accepted intent");
        this.pause(run, now);
        run.state = "unknown_outcome";
        run.error = reason;
      },
      epoch,
    );
  }
  awaitReapproval(runId: string, now: number, epoch: number) {
    this.change(
      runId,
      now,
      "authorization_expired",
      (run) => {
        if (
          !run.intent ||
          !["executing", "unknown_outcome"].includes(run.state)
        )
          throw new Error("no accepted intent");
        this.pause(run, now);
        run.state = run.cancellationRequested
          ? "cancelled"
          : now >= run.deadline || run.reapprovals >= run.limits.reapprovals
            ? "failed"
            : "awaiting_reapproval";
      },
      epoch,
    );
  }
  fail(runId: string, reason: string, now: number, epoch: number) {
    this.change(
      runId,
      now,
      "failed",
      (run) => {
        if (run.state === "unknown_outcome")
          throw new Error("unresolved effect requires reconciliation");
        if (["succeeded", "cancelled"].includes(run.state))
          throw new Error("terminal run");
        this.pause(run, now);
        run.state = "failed";
        run.error = reason;
      },
      epoch,
    );
  }
}
