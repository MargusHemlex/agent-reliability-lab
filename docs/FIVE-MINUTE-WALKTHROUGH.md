# Five-minute walkthrough

**Audience:** an engineer reviewing approval, durable execution and effect safety. **Prerequisite:** complete the [install and build](QUICKSTART.md#install-and-build) first. Dependency download and build time are outside the five minutes. Use Node 24 and macOS/Linux with `/usr/bin/python3`; no API key or paid model is needed.

## 0:00 — State the problem

> This lab asks what happens when an agent's worker dies after a write commits but before the worker receives its result. The framework handles execution replay. My application handles approval and durable intent; a separate receiver handles effect idempotency. We can inspect its database independently.

Open the [architecture diagram](ARCHITECTURE.md). The workflow uses synthetic delivery-support data and exactly three tools. Its model decisions are scripted; its worker processes, HTTP service and databases are real.

## 0:45 — Run the focused experiment

From the repository root:

```sh
npm run walkthrough
```

The runner creates isolated synthetic state and ephemeral local credentials. It first rejects a proposal and requires zero effects. It then creates a separate approved workflow, pauses the sandbox immediately after its effect transaction commits, kills the actual worker and restarts it against persisted state. The sandbox stays alive. The focused command is a two-case walkthrough, not the complete 33-case evaluation.

Read the emitted checkpoints in order:

1. An unapproved/rejected action has **zero** independent effects.
2. The approved crash case reaches the after-commit barrier with **one** effect, before the worker has a receipt.
3. The worker is terminated and restarted.
4. Recovery resolves the receipt with the same effect key, still **one** effect, within the thirty-second recovery target.

The command exits nonzero if an assertion or infrastructure step fails. Its immutable UUID-named files under `reports/walkthrough/` record the actual observation. The runner validates its own strict two-case schema before exporting JSON and Markdown; this is separate from the full evaluation schema. These files include the actual source commit and hashes; do not substitute recorded timings for a failed local run. Allow time for the experimental twenty-second lease to expire. Timing varies by machine. The recovery clock starts immediately before restart, after worker termination and barrier release; it excludes that kill/release setup and is not total time since the service commit.

## 2:15 — Explain why recovery is safe here

> The stable key is written before dispatch. The receiver binds that key and the canonical action digest to its effect and receipt in one transaction. When the worker restarts, it reconciles the committed receipt rather than guessing whether the write happened. The independent effect table is the check; a successful HTTP response alone would be insufficient.

The rejected case demonstrates the other boundary: a model proposal is not permission. Approval binds an exact action and versioned context. Cancellation cannot roll back an already accepted effect. This is a receiver-specific contract, not a guarantee for arbitrary external APIs.

## 3:15 — Show the wider evidence

Open the [evidence index](evidence/README.md) and [milestone 5 review](MILESTONE-5-REVIEW.md). The previous completed Linux gate records 79 unit/HTTP tests, 31 fixture scenarios and two negative controls. The controls deliberately remove a safety boundary in disposable copies; the same probe must detect an extra effect. An infrastructure exception is not a successful control.

For a longer review after the presentation:

```sh
npm run evaluate
npm run test:live-workflow
```

The first produces strict fixture reports. The second exercises the compiled adapter with offline simulated transport and zero actual provider calls. It is not genuine model validation.

## 4:15 — Be explicit about limits

> This topology is one POSIX host, SQLite and one worker. The twenty-second eve lease is experimental and hash-guarded; the default 860-second setting misses the recovery target. We tested named failures and one-effect outcomes here, not distributed availability or universal exactly-once delivery. The optional real-model adapter has persistent estimated budgets, and one separately documented genuine smoke has passed. This guided crash experiment remains a scripted fixture, not live-model recovery evidence.

The repo remains private pending the owner's release decision. Real integrations, customer data and production deployment are outside this lab. Core desktop operator flows were exercised; native reset-confirmation completion and mobile verification remain open.

For an interactive follow-up, use the [operator instructions](QUICKSTART.md#open-the-local-operator). The focused runner cleans its temporary state, so its disposable runs will not appear in that separate operator instance. Never place credentials in a screenshot or URL.
