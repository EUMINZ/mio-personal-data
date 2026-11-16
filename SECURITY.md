# Security

Mio is an identity-first Alpha for local development and integration research. Its security properties depend on the host application and operating environment. It has not undergone an independent security audit.

## Current boundary

- **Plaintext storage.** SQLite databases, journal files, and generated exports are not encrypted by Mio. File permissions, backups, and disk protection are the host's responsibility.
- **Trusted-host access.** The repository API and CLI can read and write personal records directly. They are not a sandbox or a multi-tenant authorization service.
- **No caller authentication.** Requester IDs, actor IDs, grant records, and labels such as `actorType: "user"` are supplied data. They do not establish the caller's identity or consent.
- **Unscoped core reads.** Core context builders, search, dossiers, and full exports are not restricted to a grant. The MCP adapter applies separate scope checks. Neither it nor the example reader authenticates assistants or secures the underlying database from direct access.
- **Review is a workflow.** Recording an accepted decision does not automatically change a canonical claim. Hosts must control both review submission and subsequent claim updates.
- **Mutable audit records.** Events are stored alongside other records in SQLite. A process with database access can change them; they are not a tamper-proof ledger.
- **Validation has limits.** JavaScript and JSON Schema validators check payload structure. They do not establish caller identity, permission, or consent. A recorded source does not prove that content is true or safe to use as instructions.

Use fictional information when experimenting. Before handling sensitive data, design and test caller authentication, permission-scoped reads and writes, explicit user approval, storage protection, backup and recovery, and data retention. Keep raw repository access inside the trusted host.

## Local MCP adapter

The adapter binds one person/requester/grant tuple in a local configuration file. Tool arguments cannot replace that binding. In `0.3.0-alpha`, `mio_context` handles discovery and scoped batch reads, while `mio_propose_update` creates pending proposals. Approval, sharing and revocation are operator CLI operations outside MCP. Config and database files are checked for private POSIX permissions where supported; Windows ACL verification is not implemented.

For a valid grant, a batch may return readable values alongside `unavailable` keys. Missing, unauthorized, expired, ambiguous and unshared updated fields have the same unavailable representation; it must not be interpreted as proof that data exists. Invalid overall grants and database/audit errors fail the entire call without partial values. `--legacy-tools` preserves the same field policy but rejects the entire legacy read when any field is unavailable.

The adapter does not cache reads: it checks current records and grant state on each call. `checkedAt` is a server check timestamp, not proof of current real-world truth. Invalid or future claim update timestamps and ambiguous latest versions are rejected; a newer expired or unshared claim does not allow fallback to an older one. These controls cannot verify the accuracy of operator-supplied facts or the host clock, and cannot invalidate copies already retained by clients.

This is a boundary for tool calls, not isolation from the OS account running the client. An assistant with shell or filesystem access to the same database/config can bypass it or invoke the operator CLI. Operator confirmation flags and IDs do not authenticate a human. Restrict those capabilities separately if that threat is relevant.

Returned values are untrusted data, not instructions. A local database does not keep tool outputs local: clients may send authorized results to their model provider. Grants cannot recall previously returned values. The demo creates a fresh fictional in-memory database for every server process; using one real config in multiple clients shares one requester identity and grant.

Pinned GitHub package installation downloads executable code and its dependencies. Use a pinned checkout plus `npm ci` to reproduce the full lockfile; the npm package route pins source and direct versions but does not ship that lockfile. Inspect and pin a release, keep the local runtime updated, and do not commit profile JSON, config files or databases. Production multi-tenant authentication, encrypted storage and concurrent-writer guarantees are not established by this Alpha.

## Local shared-profile review example

The unreleased `examples/shared-profile/` review page is a trusted local operator
interface for fictional trials. It binds to `127.0.0.1` on a random port. Its
launch URL carries a random capability token in the fragment; the page removes
the fragment and keeps the token in memory. API reads and writes require that
token. Exact Host and Origin checks, cross-site request rejection, a restrictive
content security policy and no-store responses reduce browser-origin exposure.
These checks do not authenticate a human or isolate hostile local processes.

Keep the launch URL private. Reloading requires reopening the original launch
URL; there are no login cookies or persistent browser token storage. Each server
start creates a new token. Do not expose the server through a proxy or public
tunnel. Anyone with the token and local access can approve, share, or revoke;
any process with the same OS file access may also bypass the page entirely.

The page shows an operator-side view and permission previews, not actual AI
answers. It reuses the MCP administration operations and records writes
transactionally. Its state reads do not create synthetic assistant-read audits.
Two fixture configurations share a database but have distinct requester/grant
bindings. Grants expire after 24 hours and are not renewed by restarting.
SQLite's bounded 3-second busy timeout handles brief contention only; no general
concurrency or availability guarantee is made.

## Reporting a concern

For a report that can be reproduced entirely with fictional data, open an issue with affected code, expected behavior, and a minimal reproduction. Do not post personal records, database files, credentials, or real document images.

There is no dedicated private reporting channel documented for this Alpha. If details are sensitive, use a public maintainer contact entry point to request a private channel without including the sensitive details. Do not assume an issue or pull request is private.
