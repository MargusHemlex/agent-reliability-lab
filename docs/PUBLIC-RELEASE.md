# Public portfolio release

On 2026-10-18 the owner explicitly authorized public visibility for the cleaned `MargusHemlex/agent-reliability-lab` repository. The separately archived original repository remains private and read-only. No product repository, deployment or credential was authorized for publication.

The final [preflight](evidence/public-release-preflight.json) covered all 20 reachable commits and 277 unique blobs at source commit `5318424219bc841b9b166bd140d0947c233ac8a6`: zero confidential-identifier, exact live-key, key-pattern or user-absolute-path matches. The local key file remains ignored/untracked with owner-only permissions. Git integrity, documentation targets/commands and the genuine live report's schema and matching Markdown passed. This is scoped publication hygiene, not an exhaustive security audit.

The [cleaned-history CI](https://github.com/MargusHemlex/agent-reliability-lab/actions/runs/39131096180) passed 79 unit/HTTP tests, 33 evaluation cases, the two-case walkthrough, offline Gateway path, build/schema/docs checks and all runtime gates at `7e2b99cd9979e6d30fdc80bfe8e72b83b51f70c0`. No executable/configuration files changed between that commit and preflight. Subsequent changes record documentation and evidence only.

All four documentation-stage reviewers supplied scoped acceptance. A [separate genuine live smoke](LIVE-SMOKE-REVIEW.md) passed one sample with three calls and one expected effect, at USD 0.000272 estimated usage cost. This is not a production-readiness, statistical reliability, live failure/attack-resistance or invoice-reconciliation claim. Experimental single-worker runtime and browser/reset/mobile limitations remain explicit.

The private archive is excluded from this release. Historical CI links into that archive require owner access; preserved raw reports retain their original commit IDs and URLs. New cleaned-history CI is public with this repository, and the [history explanation](HISTORY-CLEANUP.md) and commit map describe provenance. No additional model calls were made to publish the repository.
