# Agent Reliability Lab

A public-by-design engineering laboratory for durable agent execution, human approval and reproducible failure testing.

**Status: milestone 3 operator UI and durable fixture budgets implemented and reviewed by all four agents; 47 unit/HTTP tests and 22 process cases pass locally and on Linux CI. Repository remains private.**

One synthetic delayed-delivery workflow reads delivery status, reads a versioned policy and records an approved resolution through exactly three tools. The worker, application database, separate sandbox HTTP service and effect database are real. Model decisions are scripted fixture decisions; no live model is called.

Start with the [operator UI and budget walkthrough](docs/MILESTONE-3.md) and [budget/access-control ADR](docs/adr/0003-execution-budgets.md). The [milestone review](docs/MILESTONE-3-REVIEW.md) records browser evidence and the remaining native reset-confirmation UI check. The prior [milestone 2 architecture](docs/MILESTONE-2.md) and [review](docs/MILESTONE-2-REVIEW.md) remain historical evidence.

## Runtime decision

Continue with **eve 0.80.1, Node 24, one POSIX host and one actual worker**. The twenty-second ownership lease is an explicit source-observed experimental setting, not a stable documented public eve API. Exact dependency versions and three runtime hashes are checked before the experiments; changed bytes fail closed.

The default 860-second lease misses our thirty-second interrupted-recovery target. With the explicit twenty-second setting, recovery passed locally and on Linux CI. Slow-step tests hold a real invocation for over twenty-two seconds, replay its genuine callback before and after the lease and inject a fresh wake: accepted callbacks did not create parallel tool invocations in the tested process.

The investigation also found and corrected our own launcher defect: the old supervisor-held lock could release while its worker survived. The current POSIX launcher execs the generated Nitro worker itself, retaining the lock in the actual worker. It does not leave an unlocked worker child. This is local ownership, not distributed fencing.

All four reviewers support the constrained next milestone. [ADR 0002](docs/adr/0002-single-worker-runtime-decision.md) and the [overlap review](docs/OVERLAP-REVIEW.md) record the evidence, decision and limits. The initial HOLD remains preserved as historical evidence in ADR 0001.

## Reproduce

Requirements: Node.js 24, npm, POSIX host (macOS/Linux), and Python 3 at `/usr/bin/python3` with `fcntl`. Local macOS arm64 and Linux x64 CI were exercised. Windows is unsupported by this launcher.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run format
npm test
npm run build
npm run spike -- --lease-seconds=20
npm run spike:overlap -- --lease-seconds=20
npm run spike:ownership
```

The experiments generate ignored reports in `spike-results/`. They launch real isolated loopback worker processes, use ephemeral operator credentials, preserve framework state across process death and inspect independent invocation records. Child environments exclude inherited provider credentials. No account, provider key, paid model or production service is required.

`npm run spike` without the explicit lease override reproduces the known default recovery limitation and is expected to exit 1 / NO_GO. A tuned report's CONDITIONAL_GO describes that report's two cases; the final constrained implementation decision also requires overlap and actual-worker ownership tests. A green CI run reproduces the default limitation and verifies the selected explicit configuration.

The fixture model is scripted. The worker, runtime persistence, callback transport and process termination are real. Probe records are synthetic local observations, not a transactional effect service or exactly-once delivery guarantee. Historical and final observations have separate source hashes in [evidence](docs/evidence/).

## Run the fixture workflow

After the locked install and build above:

```sh
npm run lab -- init
npm run lab -- serve
```

Keep `serve` running. Open `http://127.0.0.1:4318/operator`, run `npm run lab -- operator-secret` in a local terminal and paste the credential into the login form. Create/inspect/approve runs, view budgets and attempts, or seed a new dataset namespace. The secret is never placed in a URL or browser storage.

The CLI also remains available. In another terminal, create a run and copy its returned `runId`:

```sh
npm run lab -- run
npm run lab -- inspect RUN_ID
npm run lab -- approve RUN_ID PROPOSAL_DIGEST
npm run lab -- inspect RUN_ID
```

Wait until inspection shows `awaiting_approval`, then copy that run's explicit `proposal.digest` into the approval command. A successful run exposes its persisted sandbox receipt. `list`, `reject RUN_ID`, `cancel RUN_ID` and `resume RUN_ID` are also available. Resume reconciles an existing intent; it does not create approval.

Initialization stores randomly generated local credentials in ignored `.local/lab/config.json` with restricted file permissions. The CLI reads them without printing them. Do not paste this file into reports. Use the guarded `serve` command: direct execution of the generated server or worker entry bypasses the required POSIX worker lock.

```sh
npm run test:workflow
```

This process harness exercises real worker termination/restart against the independent sandbox and writes ignored `reports/workflow.json`. All eleven cases passed locally, including stale context, expiry/reapproval, approval replay and both crash barriers. Recovery took 20,593 ms before dispatch and 20,548 ms after sandbox commit, with one effect in each successful case. [Recorded local observations](docs/evidence/milestone-2-local.json) include source hashes; these are single samples, not reliability statistics. Unit/service tests and runtime compatibility probes are separate checks. See [milestone 2](docs/MILESTONE-2.md) for the acceptance boundary and remaining work.

## Scope and next milestones

Implemented application code owns immutable proposals, single-use bound approval, transactional dispatch intent, stable effect keys, receipt reconciliation and sandbox fencing. Eve owns execution claiming, checkpoint replay and orchestration. Receiver-side idempotency gives one effect in specifically tested scenarios; it does not establish universal exactly-once delivery.

The operator UI and durable fixture budget/retry accounting are implemented. Optional live provider accounting, the complete adverse-case matrix, schema-validated evaluation exports and publication documentation remain later milestones. This implementation is not a completed release of the full specification. A caller timeout never proves that an action stopped.

No horizontal scaling, real integrations, customer data, live-model validation or production deployment is claimed. Runtime upgrades and topology changes reopen the compatibility decision and must rerun the gates.

- [Implementation specification](docs/SPECIFICATION.md)
- [Four-agent specification validation](docs/SPECIFICATION-VALIDATION.md)
- [Initial runtime investigation](docs/adr/0001-runtime-durability-spike.md)
- [Accepted runtime decision](docs/adr/0002-single-worker-runtime-decision.md)
- [Four-agent overlap review and Linux evidence](docs/OVERLAP-REVIEW.md)

Eve owns orchestration/checkpoint replay. The author designed the scripted adapter, failure/overlap harness, callback observer, actual-worker locking, access controls and explicit evidence boundaries. The author also designed the application authorization transactions, typed tool contracts, independent sandbox service, fencing protocol and CLI. Application authorization and effect safety remain separate from framework orchestration.

No original product code, customer data, production prompts or provider sessions are included. All documentation is English. Public release requires final code/history/artifact review and a later explicit owner decision. Existing products and deployments are unchanged.
