# Agent Reliability Lab

An engineering lab for durable agent workflows: exact human approval, crash recovery, independent effect verification and explicit execution budgets.

A synthetic delivery-support agent has three tools: read a delivery, read its resolution policy and record an approved resolution. The worker can die after the sandbox commits but before it receives the result. Recovery must recover that result without creating another effect. Denied actions must create none.

**Repository status: PRIVATE. History cleanup is complete; publication still requires a separate owner decision.** See the [publication review](docs/PUBLICATION-REVIEW.md) and [verified history cleanup](docs/HISTORY-CLEANUP.md). The optional real-model adapter passed [one bounded genuine live smoke](docs/LIVE-SMOKE-REVIEW.md): three calls, one expected effect and USD 0.000272 estimated cost. Default tests need no model account, API key or paid call.

## Start here

- [Quickstart](docs/QUICKSTART.md): install, verify and open the local operator UI.
- [Five-minute walkthrough](docs/FIVE-MINUTE-WALKTHROUGH.md): reproduce a worker crash, restart and independently count effects.
- [Architecture and responsibility boundaries](docs/ARCHITECTURE.md).
- [Implementation specification](docs/SPECIFICATION.md) and [evidence index](docs/evidence/README.md).

## What this project demonstrates

- Durable application transactions bind approval to an immutable proposal, delivery revision, policy version and expiry. The model cannot grant approval.
- A separate HTTP service and SQLite database bind an idempotency key to an action digest and committed receipt. Recovery queries this independent receiver.
- A guarded single-worker launcher, deterministic crash barriers and deliberately broken negative controls test the safety claims.
- Persisted budgets survive restarts. Unknown provider usage blocks another paid call; monetary reservations remain estimates.
- Strict JSON and Markdown reports record source hashes, denominators, measured effects and unknown measurements explicitly.

The cleaned-history [Linux CI](https://github.com/MargusHemlex/agent-reliability-lab/actions/runs/39131096180) passed **79 unit/HTTP tests**, **31 fixture scenarios plus two negative controls**, the **two-case guided walkthrough**, an offline compiled Gateway-adapter workflow and runtime regression checks. See the [publication review](docs/PUBLICATION-REVIEW.md) for exact scope, provenance and remaining holds. The offline adapter test simulates provider transport; it establishes no live-model success rate.

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

## Further reading

- [Runtime decision](docs/adr/0002-single-worker-runtime-decision.md) and [overlap investigation](docs/OVERLAP-REVIEW.md).
- [Operator controls and budgets](docs/MILESTONE-3.md).
- [Failure matrix, negative controls and report validation](docs/MILESTONE-4.md).
- [Optional Gateway adapter and bounded offline verification](docs/MILESTONE-5.md).
- [Testing and evidence](docs/TESTING.md), [limitations](docs/LIMITATIONS.md) and [dependency notices](docs/THIRD-PARTY-NOTICES.md).
- [Security reporting](SECURITY.md), [contributing](CONTRIBUTING.md) and [license](LICENSE).

This repository contains synthetic portfolio code rather than original product implementations. Publication requires a separate explicit owner decision. Existing products and deployments remain unchanged.
