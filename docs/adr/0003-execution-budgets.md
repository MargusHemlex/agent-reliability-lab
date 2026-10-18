# ADR 0003: durable execution budgets and browser operator boundary

Status: implementation candidate; final four-agent review and exact-code Linux CI pending.

## Decision

Keep the constrained runtime of ADR 0002. Eve owns durable scheduling, claiming and checkpoint replay. Application transactions own preventive reservations, accounting and authorization; the receiver owns context, expiry, fencing and effects. No additional execution scheduler is introduced.

Every run receives a validated immutable copy of these defaults before its first model call. The operator may lower values for a new run, never raise them or change an existing run's limits.

| Limit | Default | Accounting |
| --- | ---: | --- |
| Model calls | 5 | Each distinct model-input hash reserves once before a scripted decision |
| Requested completion tokens | 8,000 | Fixed 1,600 output-cap reservation per model call; no refund or fabricated provider usage |
| Physical tool executions | 8 | Current tool-call identity plus worker epoch; a resumed invocation uses another unit |
| Tool input / output | 16,384 bytes each | Separate bounds, validated before persistence |
| Physical tool timeout | 10,000 ms | Persisted deadline; HTTP cancellation bounded by remaining call and active time |
| Read attempts | 3 | Per run, tool name and input digest, across model retries and worker restarts |
| Active execution | 120,000 ms | Persisted intervals; excludes approval and explicit unknown-outcome waiting |
| Approval TTL | 900,000 ms | Bound to proposal, capped at run deadline; receiver checks effect commit |
| Reapprovals | 2 | Retained history; unchanged action/key |
| Wall-clock run deadline | 3,600,000 ms | Prevents new execution; read-only receipt recovery survives it |

A model call here means a model planning step, not a human conversation turn. Prompt hashes identify replay of the same fixture decision. Completion reservations remain charged after failures and crashes. The deterministic adapter receives an explicit 1,600-token output cap and additionally bounds emitted completion bytes conservatively. This is an **output-request capacity budget**, not a measured input-plus-output tokenizer count. Provider-reported input/output usage and monetary cost are unknown (`null`/not measured). No live provider adapter is present; live tokenization, provider usage and cost accounting are not validated by this milestone.

A physical read tool has one ten-second deadline. Individual GET attempts use at most three seconds, permitting timeout then recovery inside that window. Fast retryable failures use persisted 100/200 ms backoff; at most three requests execute for the semantic read identity. Permanent errors stop immediately. Backoff waits execute inside the real eve tool, not a second scheduler. A new physical invocation after worker restart receives its own timeout and consumes another tool unit, while its semantic read-attempt count does not reset.

## Active time and uncertain effects

Reservations start or continue an active interval; proposing pauses it before human waiting. Successful/denied/unknown completion pauses it when execution stops. In an interrupted interval, a replacement conservatively charges elapsed local-clock time since the last durable accounting point, capped at the active limit. This includes crash downtime and can exhaust a run. UTC host-clock assumptions and clock regression rejection are explicit; injected clocks are test-only.

Exhaustion before accepted intent ends failed with zero new dispatch. After accepted intent, an unresolved result stays `unknown_outcome`; a budget cannot turn uncertainty into a false no-effect claim. Existing terminal success, cancellation and confirmed permanent denial retain their truth. New dispatch is blocked, but the operator can perform bounded read-only receipt reconciliation without another model call or execution-budget grant. A found, correctly bound receipt may resolve success after deadline or exhaustion. An absent or unreachable receipt grants no new authorization.

Receiver-side idempotency, stable key reuse, immutable action binding, commit-time expiry and worker fencing remain mandatory. Approval/cancellation linearization is unchanged. Accepted-intent retries do not create new approval; reapproval retains the key and consumes a fresh physical call unit.

## Browser operator

The English `/operator` interface uses a manually pasted local operator secret only in its login request. The explicit `operator-secret` CLI command reveals that local credential for login; normal startup does not print it. The browser receives a random fifteen-minute HttpOnly, SameSite=Strict cookie scoped to `/operator`, and a CSRF token held only in page memory. Mutations require the exact configured Origin, Host and CSRF token. Login failures are rate limited. A nonce CSP and text-only DOM rendering protect synthetic trace text. The bearer API continues to reject Origin-bearing requests; a server-side adapter proxies only explicit allowed paths.

Namespace reset seeds a fresh receiver context before atomically selecting it in application state. Prior run records, contexts, effects and receipts remain intact and retain their own namespace. A crash between those database operations can leave an unused namespace, not erase prior evidence. This is local access control and synthetic dataset isolation, not enterprise authentication or multi-host tenancy.

## Verification boundary

Unit, real HTTP, process crash/restart and actual browser verification are required. Final observations and reviewer verdicts are recorded separately after execution. The complete adverse-case evaluation matrix, schema-validated export format, deliberate negative controls and optional live adapter remain subsequent milestones. Repository publication is not authorized.
