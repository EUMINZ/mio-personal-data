# Validation

Release preparation was checked on 2026-11-14 with Node.js 24.12.0 and npm 11.6.2 on macOS.

From the repository root:

```sh
npm ci --ignore-scripts
npm run check
```

The final local check passed JavaScript syntax validation, **32 tests**, and the complete fictional two-assistant demo. No tests were skipped.

Coverage includes core storage and review workflows, cross-person import isolation and transaction rollback, actual context exports against JSON Schema, scoped field selection, live grant expiry and revocation, simulated user approval, and failed reauthorization rollback. The demo uses an in-memory database and makes no model or network calls.

The [GitHub Actions check](https://github.com/EUMINZ/mio-personal-data/actions/workflows/check.yml) runs the same command on Ubuntu with Node.js 24. Consult the run for the commit you use; local success does not establish a remote run's result.

The release uses a new Git history containing the core, contracts, documentation, tests, and fictional examples. A final source scan found no known local personal paths, credential patterns, or excluded product assets. This is a bounded source review, not a security certification.

Not validated: real external AI integrations, production authentication, storage encryption, hostile multi-tenant isolation, or recovery from data loss. See [SECURITY.md](../SECURITY.md).
