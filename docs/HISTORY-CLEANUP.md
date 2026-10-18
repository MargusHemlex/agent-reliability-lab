# Confidential history cleanup

On 2026-10-18 the owner authorized removing the confidential product identifier from Git history while retaining the original history privately. **The active repository and the backup remain PRIVATE. This is not an authorization to publish.**

## Preservation and rewrite

The original repository was renamed to [the private history archive](https://github.com/MargusHemlex/agent-reliability-lab-private-history-backup-20261018). It retains its original repository identity, all original commits, GitHub Actions runs and metadata. No pull requests, issues, webhooks or deployments existed at the change. A complete local Git bundle was also created with owner-only filesystem permissions, verified and restored into a mirror that passed `git fsck --full`. The bundle is not committed or uploaded into this repository.

The active repository was recreated under its original name as a fresh private GitHub repository. This prevents old objects retained by an in-place force-push from becoming public through a later visibility change. The confidential identifier was replaced with generic wording across commit contents and messages. All 17 commits were preserved as rewritten commits; authorship and chronology were retained.

Immediately after filtering, the working-tree Git tree hash remained `a829f03b35fe4e6e00a9c5898a5f0b9d7a6bf549`, byte-identical to the original tip. Application code, current documents, local ignored state and deployments were not changed by the rewrite itself. This follow-up changes documentation/provenance links and introduces the new verification evidence.

## Verification

- All reachable rewritten commit messages, file paths and 234 unique blobs were searched case-insensitively: zero confidential-identifier matches.
- Git integrity checks passed; the uploaded history is independently cloned for verification.
- The original tip remains the backup's `main` tip. Both repositories were confirmed private with distinct repository identities.
- Requests for the original tip and confidential historical blob return HTTP 404 from the fresh active repository.
- [Rewrite verification](evidence/history-cleanup-verification.json) records the bundle checksum and before/after identities. [Commit mapping](evidence/history-rewrite-commit-map.json) maps original evidence commits to the rewritten equivalents.

## Historical evidence

Existing reports retain their original source commit IDs and hashes. They are not relabelled as if a rewritten commit originally ran those tests. Historical CI runs are in the private archive; narrative links point there and require owner access. URLs inside immutable report payloads remain as originally recorded and may not resolve under the replacement repository name. Use the mapping and archive to investigate those records.

Fresh CI on this active repository establishes new provenance for the cleaned history. The original private archive is excluded from any future public release; do not mirror it or copy its refs into the active repository. Previously cloned copies may retain old objects and should not be used to repopulate this repository. The local owner-only bundle also stays private.

The historical-identifier hold is resolved for the verified active history. Explicit owner publication approval is still required. Genuine application-provider validation remains `not_run`; the documented browser/reset/mobile and experimental-runtime limits remain unchanged. No original product repository or deployment was modified.

## Fresh verification on the cleaned repository

[Linux CI](https://github.com/MargusHemlex/agent-reliability-lab/actions/runs/39131096180) passed at rewritten-history commit `7e2b99cd9979e6d30fdc80bfe8e72b83b51f70c0`: 79 unit/HTTP tests, all 33 fixture cases, the two-case walkthrough, offline Gateway path, generated schemas, documentation checks, build and all runtime regression gates. Downloaded canonical reports passed schema/semantic and current-source freshness checks before this documentation commit. The guided report's source inventory and assertions also matched.

- [Fresh full fixture evidence](evidence/history-cleanup-ci-fixture.json)
- [Fresh guided walkthrough](evidence/history-cleanup-ci-walkthrough.json)
- [Fresh live-not-run record](evidence/history-cleanup-ci-live-not-run.json)

These new observations belong to the cleaned active history; they do not replace or retrospectively relabel archived evidence. Publication remains a separate explicit owner decision.
