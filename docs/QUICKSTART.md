# Quickstart

Run from the repository root. Requirements: Node.js 24, npm, macOS or Linux, and Python 3 at `/usr/bin/python3` with POSIX `fcntl`. The local launcher supports one worker on one host. No model key or paid service is required for these instructions.

## Install and build

```sh
node --version
/usr/bin/python3 --version
npm ci --ignore-scripts
npm run typecheck
npm run format
npm test
npm run build
```

`node --version` must start with `v24.`. The committed lockfile pins dependencies; do not replace the install with an unpinned upgrade. Build before running process tests or the operator. Runtime compatibility guards intentionally reject changed installed runtime bytes.

## See the crash and approval boundaries

```sh
npm run walkthrough
```

Follow the [five-minute walkthrough](FIVE-MINUTE-WALKTHROUGH.md) for the checkpoints. It uses disposable synthetic state and independent sandbox effect counts.

For the complete evaluation:

```sh
npm run evaluate
npm run test:live-workflow
```

The first command covers 31 fixture scenarios and two negative controls. The second exercises the compiled real-model adapter through isolated offline simulated transport. It makes zero actual provider calls. Each negative control runs the same probe against a clean baseline and a deliberately broken disposable copy; a targeted failure in that copy is expected. Infrastructure failure never counts as detection.

Fixture exports appear in ignored `reports/evaluation/`. The last-run locator `reports/evaluation-latest.json` points to immutable UUID-named JSON and Markdown files. Validate the actual report path, replacing `REPORT_ID`:

```sh
npm run reports:validate -- reports/evaluation/REPORT_ID.json --markdown
npm run reports:validate -- reports/evaluation/REPORT_ID.json --fresh
```

`--fresh` compares against the current commit, source inventory and runtime. Use it immediately after an unchanged run. Historical committed evidence can be valid without matching today's HEAD; validate that evidence without `--fresh`. JSON Schema provides structural validation; the CLI also enforces canonical Zod semantic rules.

## Open the local operator

```sh
npm run lab -- init
ARL_LAB_MODE=fixture npm run lab -- serve
```

Keep `serve` running, then open <http://127.0.0.1:4318/operator>. In a second terminal:

```sh
npm run lab -- operator-secret
```

Paste that local credential into the login form. Create a fixture run, inspect its proposal and approve or reject it. Inspect its state, attempts, budget and receipt. Human approval is required before a normal write. Browser access uses an expiring HttpOnly session and CSRF-protected mutations.

Initialization creates ignored `.local/lab/config.json` containing local credentials and port configuration. Normal startup does not print secrets. Do not place the secret in a URL, report or screenshot. Stop the server with Ctrl+C. Use `serve`, which launches the worker with its required process lock; direct generated-server execution bypasses this guard.

The CLI is another operator client:

```sh
npm run lab -- run
npm run lab -- inspect RUN_ID
npm run lab -- approve RUN_ID PROPOSAL_DIGEST
npm run lab -- inspect RUN_ID
```

Replace `RUN_ID` with the returned ID. Wait for `awaiting_approval`, then copy that run's exact `proposal.digest` into `PROPOSAL_DIGEST`. `list`, `reject RUN_ID`, `cancel RUN_ID` and `resume RUN_ID` are also available. Resume can reconcile an existing intent; it does not create approval. Cancellation after accepted intent does not undo a committed effect.

## Optional model execution

Default mode is fixture. The adapter passed [one bounded genuine smoke](LIVE-SMOKE-REVIEW.md). This establishes connectivity and one happy path, not broad model reliability or reconciled billing. See [milestone 5](MILESTONE-5.md) before any separately opted-in live run; do not supply keys to reproduce the walkthrough. With explicit opt-in disabled, `npm run evaluate:live` produces `not_run` evidence with unknown usage, cost and effects rather than a passing live result.

## Troubleshooting

- Wrong Node version: select Node 24 and repeat the locked install and build.
- Missing build: run `npm run build` before process tests or `serve`.
- Busy configured ports: stop the existing local lab instance. Disposable process tests select their own ports.
- Runtime hash guard failure: restore the pinned lockfile installation; a dependency upgrade requires renewed compatibility review.
- A plain `npm run spike` exits 1: this intentionally reproduces the default lease limitation. The accepted experiment is `npm run spike -- --lease-seconds=20`; see the runtime ADR.
- A report is `fail` or `not_run`: inspect its reason and measured sample count. Do not relabel it as passing or substitute zeros for missing observations.
