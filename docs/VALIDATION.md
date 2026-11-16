# Validation

## Unreleased: trial entry and review resolution

Checked on 2026-11-16 with Node.js 24.12.0 on macOS arm64. `npm run check`
passed **136 tests**, with zero failures or skips, plus syntax checks and the
fictional simulation. The 14 additional cases cover operator rejection and
outdated-proposal closure, binding/version checks, duplicate requests, unchanged
facts and grants, audit-failure rollback, CLI commands, and generated client
commands. The shell tests use fake clients to inspect arguments, including paths
with spaces, apostrophes, dollar substitutions and backticks; they make no model
calls and do not establish new Codex or Claude model validation.

The review page now records rejected proposals as `dismissed` with a required
reason, and outdated proposals as `superseded`. The proposal and decision remain
stored; the pending queue no longer includes them. Approval and outdated closure
use the same current-fact check as the page. Invalid, future, expired or ambiguous
facts cannot be approved through the operator CLI.

Browser checks confirmed that blank rejection reasons are blocked, a typed reason
and its focus survive another tab submitting a proposal, rejection preserves the
current facts and sharing, and an outdated proposal can be closed after another
proposal is approved. The resolved list shows all three outcomes. At a 390-pixel
viewport, the expanded decision list had no horizontal overflow.
[Review-resolution screenshot](assets/shared-profile-decisions.jpg).

The README now starts with explicit trial-branch installation and records the
checkout SHA. The launcher prints session-only Codex A and Claude Code B commands
using actual Node, server and configuration paths; a separate command reprints
them without resetting the profile or renewing its grants. The initial 122-test
and real-client records below describe the earlier snapshot; their hashes have
not been rewritten to imply they tested these changes. No new real-model or
external-user trial is claimed here.

## Unreleased: shared-profile trial

Checked on 2026-11-16 with Node.js 24.12.0 and npm 11.6.2 on macOS arm64.
`npm run check` passed **122 tests**, with zero failures or skips, plus syntax
checks and the fictional demo. The 12 new cases exercise two official MCP SDK
clients over stdio using distinct configurations against one persistent database,
restart/expiry/revocation, approval versus sharing, local HTTP access checks,
stale reviews, invalid requests, and audit-failure rollback.

SQLite now waits up to 3 seconds for a competing writer. A focused test verifies
a short lock is tolerated, a longer lock fails without disclosing values or
partially recording a proposal, and a subsequent operation recovers. This is
bounded contention coverage, not a general concurrent-writer guarantee.

Browser checks exercised proposal, approval, explicit sharing and revocation on
the local review page. At a 390-pixel viewport the page had no horizontal overflow.
The page shows operator-side permission previews; those previews do not claim an
assistant actually read a value. [Review screenshot](assets/shared-profile-review.jpg)
and [revocation screenshot](assets/shared-profile-revoked.jpg) use fictional data.

The [sanitized real-client record](trials/shared-profile-live-validation-2026-11-16.json)
reports 5 separate ephemeral Codex sessions and 7 actual MCP calls. A saw the old
email while the proposal was pending, no email after approval, the new value only
after sharing, and a denial after revocation. Claude Code B failed authentication
before any tool call. B's continued name/address access was checked separately
with the official SDK; this does not count as Claude validation. Operator actions
in that record were scripted, whereas the separate browser check used UI clicks.

The [trial kit](SHARED_PROFILE_TRIAL.md) includes a protocol, recruitment copy and
feedback template. No external testers have been recruited or measured. A full
two-model run, continuously connected real clients, and resistance to stale
answers from model context remain unverified. The old `v0.3.0-alpha` tag does not
contain this example; record the checkout commit for each trial.

## 0.3.0-alpha: compact context and paired evaluation

Checked on 2026-11-14 with Node.js 24.12.0 and Codex CLI 0.160.1.
`npm run check` passed **110 tests**, with zero failures or skips, plus syntax
checks and the fictional demo. This includes 10 new compact-interface tests,
22 deterministic fixture tests, and 3 scoring/resource-accounting tests.

The default adapter exposes `mio_context` and `mio_propose_update`. Tests cover
batched partial results, optional key discovery, uniformly unavailable fields,
future claim timestamps, fresh permission checks, no partial response on audit
failure, transaction rollback, and compatibility through `--legacy-tools`.

The [real-client evaluation protocol](../experiments/accuracy-cost/README.md)
fixes 20 synthetic tasks per arm before inference. Its
[separate report](research/accuracy-cost-optimization.zh-CN.md) distinguishes
task correctness, per-attempt resources and per-success resources from model
pricing, subscription charges and general real-world accuracy.

## 0.2.0-alpha: MCP and architecture study

Checked on 2026-11-14 with Node.js 24.12.0 and npm 11.6.2 on macOS arm64.

From the repository root:

```sh
npm ci --ignore-scripts
npm run check
```

A clean dependency install and the complete check passed: JavaScript syntax validation, **75 tests**, and the fictional two-assistant demo. No tests were skipped. The tests comprise 32 existing core/demo/schema cases, 29 architecture benchmark cases, and 14 MCP/administration cases.

MCP coverage uses an official SDK client over actual stdio, including strict input rejection, requester/person binding, persisted proposals, separate operator approval and sharing, revocation, expiry, npm-style symlink launch, explicit profile import, time-zone normalization, and injected audit failures. These are finite regression tests, not a security certification.

The [architecture report](../benchmarks/README.md) compares full-profile delivery, a capable scoped JSON host, and the existing Mio example host. The two scoped implementations produce the same tested outcomes. Its 88.08% application-byte reduction is relative to the unscoped reference, not evidence of Mio-specific superiority or model token savings. [Raw results](../benchmarks/results/architecture-results.json) include input and source hashes.

A separate [real Codex smoke record](../experiments/results/codex-mcp-smoke.json) contains actual tool calls from an isolated CLI session using fictional data. It verifies connectivity and pending-update behavior, not model-quality improvement. The optional `scripts/codex-mcp-smoke.mjs` reuses the operator's existing CLI login and consumes account usage; it is not part of offline CI and does not export credentials.

See [packaging validation](../integrations/VALIDATION.md) for npm-bin and local Claude Code plugin checks. Remote GitHub installation and native client checks are reported separately from protocol tests.

The published GitHub tag also passed a fresh-cache package download and actual stdio tool assertions. A separate pinned-commit installation into a dedicated directory passed the same assertions through its local Node entrypoint, which is now the recommended package launch route. See [published-package evidence](../experiments/results/github-package-smoke.json) for both results and the failed offline archive-cache attempt that informed the installation guidance.

The [GitHub Actions check](https://github.com/EUMINZ/mio-personal-data/actions/workflows/check.yml) runs the same command on Ubuntu with Node.js 24. Consult the run for the commit you use; local success does not establish a remote run's result.

## Earlier core-only release

The initial core release passed 32 tests and the two-mock-assistant demo. It used a new Git history with the core, contracts and fictional examples. The source review excluded the original product history, personal data and external PDF assets.

## Limits

Not established: model accuracy gains, user time saved, token-cost reductions, independent real-world adoption, production authentication, encryption, hostile processes with the same OS access, concurrent-writer safety, or recovery from data loss. Source scans and passing tests do not establish these properties. See [SECURITY.md](../SECURITY.md).
