# Agent Reliability Lab

An engineering lab for durable agent workflows: exact human approval, crash recovery, independent effect verification and explicit execution budgets.

A synthetic delivery-support agent has three tools: read a delivery, read its resolution policy and record an approved resolution. The worker can die after the sandbox commits but before it receives the result. Recovery must recover that result without creating another effect. Denied actions must create none.

## Review in five minutes

1. Read the [architecture](docs/ARCHITECTURE.md): what the framework, application and independent receiver each own.
2. Follow the [quickstart](docs/QUICKSTART.md), then run the [five-minute walkthrough](docs/FIVE-MINUTE-WALKTHROUGH.md): reject an action, crash an approved worker after commit and verify recovery without a second effect.
3. Inspect the [evidence index](docs/evidence/README.md) and [limitations](docs/LIMITATIONS.md): measured outcomes, reproducible reports and the boundaries of the claims.

Default tests need no model account, API key or paid call. The operator UI is available locally through the quickstart.

## What this project demonstrates

- Durable application transactions bind approval to an immutable proposal, delivery revision, policy version and expiry. The model cannot grant approval.
- A separate HTTP service and SQLite database bind an idempotency key to an action digest and committed receipt. Recovery queries this independent receiver.
- A guarded single-worker launcher, deterministic crash barriers and deliberately broken negative controls test the safety claims.
- Persisted budgets survive restarts. Unknown provider usage blocks another paid call; monetary reservations remain estimates.
- Strict JSON and Markdown reports record source hashes, denominators, measured effects and unknown measurements explicitly.

The recorded [Linux CI](https://github.com/MargusHemlex/agent-reliability-lab/actions/runs/39131096180) passed **79 unit/HTTP tests**, **31 fixture scenarios plus two negative controls**, the **two-case guided walkthrough**, an offline compiled Gateway-adapter workflow and runtime regression checks. See the [evidence index](docs/evidence/README.md) for reports and source provenance. The offline adapter test simulates provider transport; it establishes no live-model success rate. A separate [genuine model smoke](docs/LIVE-SMOKE-REVIEW.md) passed one synthetic happy path: three model calls, one expected effect and USD 0.000272 estimated cost. It does not establish live failure-recovery reliability.

## Reproduce without a model key

Use Node.js **24**, npm and macOS/Linux with Python 3 at `/usr/bin/python3` and POSIX `fcntl`. Windows is unsupported by the worker launcher.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run format
npm test
npm run build
npm run evaluate
```

The full evaluation starts isolated loopback processes, checks independent effects and runs disposable approval/idempotency mutations. A passing negative control means the unchanged probe rejected the deliberately broken implementation. Generated reports and local credentials are ignored. Do not commit databases, raw process logs or `.local/`.

## Design decisions and limits

This is one host, SQLite and one actual worker using pinned **eve 0.80.1**. Eve owns claiming, checkpoint replay and scheduling. Application code owns authorization and budgets; the sandbox owns effect transactions. The explicit **20-second ownership lease is experimental**, checked against three exact installed-runtime hashes. The default 860-second lease misses the 30-second interrupted-recovery target; upgrading the runtime or changing topology reopens that decision.

Observed one-effect results cover named scenarios against this receiver contract. They are not a universal exactly-once or distributed availability guarantee. A timeout does not prove an external action stopped. Core desktop operator flows were exercised; native reset-confirmation completion and mobile checks remain outstanding. No customer data, real integrations or production deployment is involved.

The author designed the application authorization transactions, sandbox contract, worker-lock correction, adapter boundaries, operator access controls, budget accounting, failure harness and evidence format, with agent-assisted implementation and review. Framework functionality and model decisions are identified separately in the evidence.

## Implementation and supporting records

- [Implementation specification](docs/SPECIFICATION.md), [testing guide](docs/TESTING.md) and [runtime decision](docs/adr/0002-single-worker-runtime-decision.md).
- Implementation-stage records: [runtime overlap investigation](docs/OVERLAP-REVIEW.md), [operator controls and budgets](docs/MILESTONE-3.md), [failure matrix and negative controls](docs/MILESTONE-4.md), and [model adapter](docs/MILESTONE-5.md). These preserve the decisions and evidence from each stage; start with the current architecture and evidence index above.
- [Security reporting](SECURITY.md), [contributing](CONTRIBUTING.md), [dependency notices](docs/THIRD-PARTY-NOTICES.md) and [license](LICENSE).
- [Publication review](docs/PUBLICATION-REVIEW.md), [release record](docs/PUBLIC-RELEASE.md) and [history provenance](docs/HISTORY-CLEANUP.md).

This public repository contains synthetic portfolio code. Credentials and the original history archive remain private. No existing product or deployment is included.
