# Milestone 3: operator UI and durable budgets

Status: implementation candidate. Final process, browser, four-agent review and Linux CI results are recorded below when available. The repository remains PRIVATE.

## Operator walkthrough

Use Node.js 24 on macOS/Linux with `/usr/bin/python3` and POSIX locking. No provider credentials or external account are required.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run format
npm test
npm run build
npm run lab -- init
npm run lab -- serve
```

Open `http://127.0.0.1:4318/operator`. In another local terminal, run:

```sh
npm run lab -- operator-secret
```

Paste that local login credential into the password field. This command intentionally reveals the local operator secret; do not include its output in screenshots, shared logs or reports. Normal startup does not print it. Provider keys are neither requested nor inherited by the lab child processes.

Create a fixture run. Inspect the immutable action, delivery revision, policy version and proposal digest before selecting **Approve exact proposal**. Watch the state reach `succeeded`, then inspect the receiver receipt, budget ledger, physical tool/read attempts and durable timeline. Create another run and reject it; it must retain zero effects.

Before creating a third run, lower **Model calls** to 1. The application stops before dispatch with `model_turn_budget`; resetting a limit field affects only subsequent runs. Defaults and maximum values are fixed by the committed configuration. Browser state cannot edit an existing run's limits.

Use **New dataset namespace** or `npm run lab -- reset` to seed a new isolated receiver context without deleting prior runs, events, contexts, effects or receipts. Old runs remain identified by their original namespace. This is a logical dataset reset, not destructive database truncation.

The CLI remains usable for `run`, `list`, `inspect`, explicit-digest `approve`, `reject`, `cancel`, `resume` and `reset`. Stop/restart `serve` to preserve local state. Only the guarded launcher is supported.

## Budget behavior

See [ADR 0003](adr/0003-execution-budgets.md) for all defaults, units and ownership. Every limit is copied into a run before any call; the operator can only lower a future run's limits.

The model adapter reserves capacity before a decision. Physical tool executions and read attempts are separately identified and persisted. Model replay reuses its reservation; a restarted physical tool uses another call unit while retaining the semantic read-retry group. Retryable reads have at most three requests for the same run/tool/input, with durable backoff. A ten-second physical tool deadline contains three-second GET attempts. Payload limits apply separately to input and output.

Active accounting excludes approval waiting and explicit unknown-outcome waiting. Open intervals survive crashes and conservatively include downtime, capped at the active budget. Receiver dispatch authorization is capped by remaining active time as well as approval expiry and the wall deadline. Thus killing a worker does not grant another full budget or extend an old authorization.

Exhaustion before intent fails with no dispatch. An uncertain accepted intent remains `unknown_outcome`, never a false rollback or safe cancellation. **Reconcile / resume** can read an existing bound receipt after execution budgets or the wall deadline, without another model call. An absent or unreachable receipt supplies no new authorization. Known terminal success, cancellation and confirmed permanent denial retain their truth.

The token budget is requested **completion capacity**: up to five reservations of 1,600 output tokens, maximum 8,000. Scripted completion bytes are additionally bounded. Actual provider input/output usage and monetary cost are unknown/not measured; no live provider is called and no actual usage is fabricated as zero. Live provider tokenization, usage parsing and pricing remain the optional live-adapter milestone.

## Access and browser boundary

A fifteen-minute random HttpOnly, SameSite=Strict cookie is scoped to `/operator`. CSRF tokens stay in page memory. Browser mutations require exact configured Host/Origin and CSRF; login failures are rate limited. The public login shell contains no run data and permits ordinary top-level browser navigation. The authenticated adapter exposes only explicit allowed routes and adds the bearer server-side. The existing `/lab` API still rejects browser Origin headers. CSP nonces and text-only DOM rendering prevent trace text becoming markup.

This is loopback operator access control, not enterprise authentication or internet hosting. Use `127.0.0.1`; arbitrary hostnames and public deployments are unsupported. Local configuration, databases, sessions, generated runtime files and raw reports stay ignored.

## Reproduce validation

```sh
npm test
npm run test:workflow
npm run test:milestone3
npm run spike -- --lease-seconds=20
npm run spike:overlap -- --lease-seconds=20
npm run spike:ownership
```

`test:workflow` retains the prior eleven recovery/approval cases. `test:milestone3` adds real-process budget denial, approval-wait exclusion, crash accounting, read-only recovery, retry exhaustion/timeout recovery, namespace preservation and browser-session/API coverage. Named test-only hooks never activate in normal CLI mode. Each harness has an independent effect-table check and cleans process groups.

Final source-bound observations and the actual browser walkthrough are linked from the milestone review after execution. These preliminary reports are not yet the final schema-validated adverse-case evaluation export.

## Remaining milestones

The full adverse-case evaluation matrix, deliberately disabled-guard negative controls, final export schema, optional live adapter/smoke run and complete publication review remain. Original products and deployments are unchanged. This milestone does not authorize publication, production use or distributed execution.
