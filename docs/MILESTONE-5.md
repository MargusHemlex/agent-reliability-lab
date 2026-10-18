# Milestone 5: optional Gateway adapter and bounded offline verification

The optional real-model adapter is implemented. All 79 unit/HTTP tests, the compiled offline workflow and 33 fixture cases passed on exact-code Linux CI; see the [review and evidence](MILESTONE-5-REVIEW.md). This milestone was verified without a model API key: real Gateway service connectivity, model behavior and billing are **not run**. Offline transport simulation is not live-provider evidence. The repository remains private.

## Key-free verification

Use the pinned Node 24 setup from the README:

```sh
npm run typecheck
npm run format
npm test
npm run reports:live-schema
npm run build
npm run test:live-workflow
npm run evaluate
npm run evaluate:live
```

The unit tests inject model responses and a network-free fetch implementation into the installed Gateway SDK. The compiled workflow test launches the actual worker and independent sandbox, replaces only the Gateway transport in an isolated process and denies other external HTTP destinations. It verifies no pre-approval effect and one effect after exact approval. Its output is explicitly `offline_gateway_simulation`, with zero actual provider calls. The normal CLI never selects this preload.

Without explicit opt-in, the live smoke command exports a strict `not_run` report with null usage, cost and effect observations. No missing credential triggers fixture fallback. CI runs only offline tests and the existing fixture evaluation.

## Optional future real call

Configure secrets in the local process environment using your preferred secure mechanism. Never paste a key into chat, committed files or command history. The normal operator workflow uses:

```sh
# Required environment: ARL_LAB_MODE=live, ARL_LIVE_OPT_IN=1,
# AI_GATEWAY_API_KEY, AGENT_MODEL=openai/gpt-4o-mini
npm run lab -- init
npm run lab -- serve
```

The UI still requires human inspection and approval of the exact action. A newly created live-intended run is `live_pending`; only a completed real-adapter planning response changes it to `live`. Missing or invalid configuration fails closed. The model cannot approve an action or change tool permissions. The sandbox receives no provider credential. Live CLI child logs are suppressed; sanitized durable application evidence remains inspectable.

For the separately isolated one-run synthetic smoke, also set `ARL_LIVE_SMOKE_APPROVE=1` and run `npm run evaluate:live`. This explicit gate permits approval only of the known request-update action and exact inspected digest. It is not enabled by the normal CLI. A future genuine run requires a fresh review of model availability and dated prices. No genuine run was performed in this milestone.

## Budgets and accounting

The adapter permits only the explicitly priced Gateway model ID `openai/gpt-4o-mini`. The public Gateway catalog checked on 2026-10-18 listed input USD 0.15 and output USD 0.60 per million tokens. These are a dated base-price estimate, not a guarantee of routing, future prices or an invoice. Returned underlying model/version identifiers remain unknown when the installed SDK does not expose them.

The existing immutable run limits remain: five turns, 8,000 requested output-token capacity, eight physical tools, 120 seconds active execution, 15-minute approval expiry and one POSIX worker with guarded twenty-second ownership lease. Each live call requests at most 1,600 output tokens, bounds the full serialized prompt plus tool schema to 16 KiB and uses a total call deadline of at most 30 seconds, further limited by remaining active time. Output content is validated before tools are exposed; unknown tools, cross-run arguments, truncation and unsupported content fail.

Before network dispatch, a synchronous SQLite transaction persists a reservation and binds model ID, price-table date and estimated run cap. WAL plus `synchronous=FULL` is explicit. The default cap is USD 0.10 per run; `ARL_LIVE_MAX_COST_USD` may lower it. Each reservation estimates input from full serialized bytes plus 8,192 framing tokens and 1,600 output tokens. This is a conservative heuristic, not tokenizer-backed proof or a provider billing limit. Before each further call, the ledger charges the larger of reserved and observed estimated cost for every prior call. One in-flight call, unexposed billable dimensions or service-internal behavior can exceed an estimate. This is not an account-wide spending limit.

Application-side provider retries and fallbacks are disabled. The streaming interface buffers a nonstream provider response, persists accounting and validates content before emitting SDK stream events. Abort/timeout stops local waiting; it cannot promise that the provider stopped or did not bill. An unresolved reservation or unknown usage permanently blocks further calls in that run, including after reopening the database. Replaying the same prompt reservation cannot create a second paid call. There is no automatic ledger unlock. Inspect provider billing before deciding to create another run; a new run has a new budget and does not erase previous evidence.

Actual input/output totals are persisted only when reported. Missing totals and estimates remain null. Price estimates use reported totals and the dated base rates, rounding each call upward to whole microdollars; cache discounts and actual invoice adjustments are not inferred. Approval waiting remains excluded from active execution; persisted UTC accounting retains the existing single-host clock assumption.

## Separate live reports

`evaluation/live-report.ts` is the strict canonical Zod schema, including semantic gates. `live-report.schema.json` is its generated structural companion. UUID-named JSON and Markdown exports under ignored `reports/live/` include source/lock/configuration/fixture hashes, requested and returned identifiers, a per-call reservation/usage/outcome ledger and sample denominators.

```sh
npm run reports:live-validate -- reports/live/REPORT_ID.json
npm run reports:live-validate -- reports/live/REPORT_ID.json --fresh
```

Unknown usage prevents a passing live smoke. Missing measurements remain null; `not_run` never invents zero usage. Report source freshness is checked before export, with the same frozen-source precondition as milestone 4. Raw prompts, headers, provider metadata, keys, databases and local process logs are excluded. Fixture reports remain separate and continue to describe scripted decisions.

## Remaining validation

Offline checks establish adapter contracts and local application boundaries. They do not establish provider authentication, model availability, actual model choices, underlying routing/version or invoice accuracy. Those require a separately opted-in real run and explicit live evidence. Final publication review and historical native reset-confirmation/mobile UI checks remain outstanding. Original products and deployments are unchanged.
