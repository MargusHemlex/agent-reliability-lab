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
  deliveryId: string;
  sessionId: string | null;
  epoch: number;
  revision: number;
  state: string;
  createdAt: number;
  deadline: number;
  toolCalls: number;
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
    return JSON.parse(row.data) as Run;
  }
  listRuns(): Run[] {
    return (
      this.db.prepare("SELECT data FROM runs ORDER BY id").all() as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data) as Run);
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
  }) {
    return this.tx(() => {
      this.owner(input.epoch);
      const run: Run = {
        runId: input.runId,
        deliveryId: input.deliveryId,
        epoch: input.epoch,
        sessionId: input.sessionId ?? null,
        revision: 0,
        state: "queued",
        createdAt: input.now,
        deadline: input.now + 3_600_000,
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
        if (Buffer.byteLength(stable({ input, output })) > 16384)
          throw new Error("tool payload limit");
        if (run.toolCalls >= 8) throw new Error("tool budget exhausted");
        run.toolCalls++;
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
        if (run.reapprovals >= 2) throw new Error("reapproval exhausted");
        run.reapprovals++;
      }
      const approval = {
        proposalDigest: input.proposalDigest,
        expiresAt: Math.min(input.now + 900000, run.deadline),
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
      run.state = "cancelled";
    });
  }
  cancel(runId: string, now = Date.now()) {
    this.change(runId, now, "cancellation_requested", (run) => {
      if (["succeeded", "failed", "cancelled"].includes(run.state))
        throw new Error("terminal run");
      run.cancellationRequested = true;
      if (!run.intent) run.state = "cancelled";
    });
  }
  createDispatch(runId: string, input: { now: number; epoch: number }): Intent {
    return this.change(
      runId,
      input.now,
      "dispatch_intent",
      (run) => {
        this.owner(input.epoch);
        if (run.intent && run.state === "executing") {
          run.intent.epoch = input.epoch;
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
        if (run.toolCalls >= 8) throw new Error("tool budget exhausted");
        run.toolCalls++;
        run.approval.consumed = true;
        run.intent = {
          action: run.proposal.action,
          expectedRevision: run.proposal.expectedRevision,
          policyVersion: run.proposal.policyVersion,
          key: digest({ runId, proposalDigest: run.proposal.digest }),
          runId,
          proposalDigest: run.proposal.digest,
          epoch: input.epoch,
          expiresAt: run.approval.expiresAt,
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
        run.state = run.cancellationRequested
          ? "cancelled"
          : now >= run.deadline || run.reapprovals >= 2
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
        run.state = "failed";
        run.error = reason;
      },
      epoch,
    );
  }
}
