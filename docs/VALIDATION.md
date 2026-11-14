# Validation

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
