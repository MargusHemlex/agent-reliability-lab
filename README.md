# Agent Reliability Lab

A public-by-design engineering laboratory for durable agent execution, human approval and reproducible failure testing.

**Status: milestone-zero spike complete; implementation gate HOLD. Repository remains private.**

The planned application is one synthetic delayed-delivery workflow with three sandbox tools. The current implementation is a deliberately smaller framework probe, not that application.

## Measured finding

Pinned eve 0.80.1 retains a pending approval across a SIGKILL/restart. Its default inline step ownership lease prevents the interrupted probe from recovering within our 30-second watchdog. An explicit, source-observed experimental twenty-second lease passed the two probe cases; the interrupted tool started twice and completed once. This proves replay in those cases, not exactly-once side effects or safe production ownership.

The experimental override is not documented in eve's public guides. It is checked against exact dependency bytes and must not be silently adopted as a stable framework guarantee. [ADR 0001](docs/adr/0001-runtime-durability-spike.md) records the evidence, risks and HOLD before further implementation.

## Reproduce the spike

Requirements: Node.js 24, npm, POSIX host (macOS/Linux), and Python 3 available at `/usr/bin/python3` with `fcntl`. Tested locally on macOS arm64 with Node 24.22.0. Windows is unsupported by this launcher.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run spike
```

The default spike is expected to exit 1 / NO_GO for the recovery deadline. Investigate the explicit alternative separately:

```sh
npm run spike -- --lease-seconds=20
```

A passing tuned experiment exits 0 and reports CONDITIONAL_GO, while the ADR's milestone-two HOLD remains in force. `--short-lease` is an additional two-second diagnostic only; it is shorter than the planned tool timeout and is unsuitable as an application default.

Each command launches real isolated server processes, waits for durable input, kills the process group, restarts against the same framework state, inspects events and checks independently recorded attempt counts. A second launcher must be rejected by the OS lock. The fixture model is scripted and does not call an LLM provider. No credentials or account are required. Temporary operator credentials are generated in memory; child environments exclude inherited provider credentials.

The report is written to ignored `spike-results/latest.json`. It includes actual configuration, source hashes, attempts, event names and failures. Published observations are stored in [evidence](docs/evidence/); they are historical observations, not claims about a changed checkout. The tool writes synthetic local attempt observations only; no idempotent external-effect service is implemented yet.

## Documentation and boundaries

- [Implementation specification](docs/SPECIFICATION.md)
- [Four-agent specification validation](docs/SPECIFICATION-VALIDATION.md)
- [Runtime gate and architecture decision](docs/adr/0001-runtime-durability-spike.md)
- [Milestone-zero review](docs/SPIKE-REVIEW.md)

Eve owns orchestration/checkpoint replay; the author designed the scripted adapter, crash harness, loopback access controls and explicit evidence/decision boundary. Future application approval, budgets, idempotency and sandbox fencing remain separate responsibilities.

No original product code, customer data, production prompts or provider sessions are included. All documentation is English. Public release requires final code/history/artifact review and a later explicit owner decision. No existing product or deployment is modified.
