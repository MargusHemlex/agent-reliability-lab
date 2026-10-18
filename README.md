# Agent Reliability Lab

A public-by-design engineering laboratory for durable agent execution, human approval and reproducible failure testing.

**Status: runtime gate passed for a constrained single-worker implementation. The complete delivery workflow is not built yet. Repository remains private.**

The planned application is one synthetic delayed-delivery workflow with three sandbox tools. The implemented probes test the real eve runtime with scripted model decisions, persisted state, process crashes and duplicate HTTP deliveries.

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

## Next implementation boundary

Build the fixture workflow and independent sandbox service specified below. The application must enforce bound, single-use approvals, hard budgets and receiver-side idempotency/fencing before any effect. Repeated approval API requests can queue an extra turn, even though the tested probe ran once. A caller timeout does not prove an external action stopped.

No horizontal scaling, real integrations, customer data, live-model validation or production deployment is claimed. Runtime upgrades and topology changes reopen the compatibility decision and must rerun the gates.

- [Implementation specification](docs/SPECIFICATION.md)
- [Four-agent specification validation](docs/SPECIFICATION-VALIDATION.md)
- [Initial runtime investigation](docs/adr/0001-runtime-durability-spike.md)
- [Accepted runtime decision](docs/adr/0002-single-worker-runtime-decision.md)
- [Four-agent overlap review and Linux evidence](docs/OVERLAP-REVIEW.md)

Eve owns orchestration/checkpoint replay. The author designed the scripted adapter, failure/overlap harness, callback observer, actual-worker locking, access controls and explicit evidence boundaries. Application authorization and effect safety remain separate responsibilities.

No original product code, customer data, production prompts or provider sessions are included. All documentation is English. Public release requires final code/history/artifact review and a later explicit owner decision. Existing products and deployments are unchanged.
