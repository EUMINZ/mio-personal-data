# Contributing to Mio

Mio is a user-controlled personal data layer for AI, currently focused on structured identity information. Contributions should keep the distinction between facts, evidence, suggestions, permissions, and review decisions explicit.

## Local workflow

Use Node.js 24. The core has no third-party runtime dependencies. Install development schema validators before running all checks:

```sh
npm ci
npm test
npm run demo
npm run check
```

Keep changes focused and add tests for meaningful behavior changes. A pull request should explain the problem, resulting behavior, validation performed, and any compatibility or security implications. Do not report checks as passing unless you ran them.

## Good first areas

- Extend [contract](contracts/README.md) compatibility coverage with representative accepted and rejected payloads.
- Improve the interface between a trusted host and an assistant, including permission checks and explicit review operations.
- Define portable preference and relationship models without weakening existing provenance or review semantics.
- Add small fictional examples and improve error messages and migration documentation.

Keep historical contract names compatible unless a versioned migration is part of the change. Do not quietly turn a proposal into a confirmed fact, treat an actor label as authentication, or expose a full context export as a restricted endpoint.

## Data and scope

Use synthetic fixtures: invented people, organizations, document identifiers, and reserved example domains. Do not contribute personal records, credentials, local database files, machine-specific paths, or material you do not have permission to share.

The public project covers the core, contracts, and examples. A new app or external assistant adapter should state its trust boundary and dependencies clearly. See [SECURITY.md](SECURITY.md) for reporting sensitive issues.

By submitting a contribution, you agree that it may be distributed under the project's [Apache-2.0 license](LICENSE).
