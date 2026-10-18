# Contributing

Use English for documentation, comments and examples. Keep the project synthetic, local and independently authored. Do not copy private product implementations, real prompts, customer data or production configuration. Repository visibility and deployment changes require a separate owner decision.

Read the [quickstart](docs/QUICKSTART.md), [architecture](docs/ARCHITECTURE.md), [testing guide](docs/TESTING.md) and [security boundaries](docs/THREAT-MODEL.md) first. Use Node 24, npm and macOS/Linux with Python 3 and `fcntl`.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run format
npm test
npm run reports:schema
npm run reports:live-schema
npm run docs:check
npm run build
npm run walkthrough
npm run test:live-workflow
npm run evaluate
```

These commands require no model API key. The build and isolated loopback process tests are real; model decisions or network transport are simulated as labelled. Never add paid/provider-network calls to CI. Optional genuine live work is separately opted in; do not relabel a mocked result as live validation.

Keep dependency versions and the lockfile pinned. Runtime upgrades reopen the three-file compatibility guard and single-worker decision; rerun all runtime regression gates described in the testing guide. Do not change expected evidence merely to hide a failure or rewrite historical reports as if later code produced them.

For a change, describe the concrete behavior, rationale, checks run and remaining limits. Add a focused test when changing an authorization, accounting, persistence or receiver boundary. Prefer existing schemas and transaction ownership over a second scheduler. Run the formatter on changed prose as well as executable files. Do not commit `.local`, `.eve`, `.output`, `node_modules`, raw logs or populated environment files. Generated public evidence must be sanitized and identify its actual source commit.
