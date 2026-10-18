# Security

Agent Reliability Lab is an experimental, synthetic, local engineering laboratory. It is not a production service. Supported operation is one POSIX host and one guarded worker, loopback HTTP and independent local SQLite databases. Do not expose these servers publicly or connect real customer systems.

The model proposes; trusted application code authorizes. The application binds approval to the exact action, run and context, persists dispatch intent, enforces budgets and reconciles receipts. The receiver independently checks authorization, expiry, versions, fencing epoch and key/payload consistency in its effect transaction. A timeout does not prove that a write stopped. Receiver-specific one-effect observations do not establish universal exactly-once delivery.

Local operator access uses a generated secret or short-lived HttpOnly SameSite session with CSRF/origin checks. This is not enterprise identity. Direct generated-server startup bypasses required launcher protection: use `npm run lab -- serve`. Fault injection belongs only in isolated test processes. See [threat model](docs/THREAT-MODEL.md) and [runtime ADR](docs/adr/0002-single-worker-runtime-decision.md).

Fixture operation requires no model key. Live operation requires explicit opt-in and environment-injected credentials; actual usage may remain unknown, and cost caps are estimates. Missing configuration fails closed. An unresolved paid-call reservation blocks additional calls in that run. Genuine provider validation has not been run.

Never commit populated environment files, local databases, provider sessions, raw traces or credentials. Reports use allowlisted fields. Review screenshots, Git history and generated artifacts before publication; a clean current tree does not sanitize old commits. The MIT license covers authored code; dependency licenses and notices remain applicable.

## Reporting a concern

While the repository is private, report concerns directly through the owner's existing private communication channel. After publication, prefer GitHub private vulnerability reporting if enabled. Do not open a public issue containing an exploit, credential, customer data or private infrastructure details. No security contact email or response-time SLA is asserted here. If no private route is available, open a minimal issue requesting one without disclosing details.

Describe the affected commit, supported topology, reproducible synthetic steps, expected boundary and observed impact. Use placeholders for secrets. Suspected leaked credentials require revocation/rotation by their owner; deleting a string is insufficient. A dependency advisory check or publication hygiene review is not an exhaustive security audit.
