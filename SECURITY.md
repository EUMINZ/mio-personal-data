# Security

Mio is an identity-first Alpha for local development and integration research. Its security properties depend on the host application and operating environment. It has not undergone an independent security audit.

## Current boundary

- **Plaintext storage.** SQLite databases, journal files, and generated exports are not encrypted by Mio. File permissions, backups, and disk protection are the host's responsibility.
- **Trusted-host access.** The repository API and CLI can read and write personal records directly. They are not a sandbox or a multi-tenant authorization service.
- **No caller authentication.** Requester IDs, actor IDs, grant records, and labels such as `actorType: "user"` are supplied data. They do not establish the caller's identity or consent.
- **Unscoped reads.** Context builders, search, dossiers, and full exports are not restricted to a grant. The example reader demonstrates checks in trusted local code; it does not authenticate assistants or secure the underlying database.
- **Review is a workflow.** Recording an accepted decision does not automatically change a canonical claim. Hosts must control both review submission and subsequent claim updates.
- **Mutable audit records.** Events are stored alongside other records in SQLite. A process with database access can change them; they are not a tamper-proof ledger.
- **Validation has limits.** JavaScript and JSON Schema validators check payload structure. They do not establish caller identity, permission, or consent. A recorded source does not prove that content is true or safe to use as instructions.

Use fictional information when experimenting. Before handling sensitive data, design and test caller authentication, permission-scoped reads and writes, explicit user approval, storage protection, backup and recovery, and data retention. Keep raw repository access inside the trusted host.

## Local MCP adapter

The adapter binds one person/requester/grant tuple in a local configuration file. Tool arguments cannot replace that binding. It exposes field discovery, scoped reads and pending proposals; approval, sharing and revocation are operator CLI operations outside MCP. Config and database files are checked for private POSIX permissions where supported; Windows ACL verification is not implemented.

This is a boundary for tool calls, not isolation from the OS account running the client. An assistant with shell or filesystem access to the same database/config can bypass it or invoke the operator CLI. Operator confirmation flags and IDs do not authenticate a human. Restrict those capabilities separately if that threat is relevant.

Returned values are untrusted data, not instructions. A local database does not keep tool outputs local: clients may send authorized results to their model provider. Grants cannot recall previously returned values. The demo creates a fresh fictional in-memory database for every server process; using one real config in multiple clients shares one requester identity and grant.

Pinned GitHub package installation downloads executable code and its dependencies. Use a pinned checkout plus `npm ci` to reproduce the full lockfile; the npm package route pins source and direct versions but does not ship that lockfile. Inspect and pin a release, keep the local runtime updated, and do not commit profile JSON, config files or databases. Production multi-tenant authentication, encrypted storage and concurrent-writer guarantees are not established by this Alpha.

## Reporting a concern

For a report that can be reproduced entirely with fictional data, open an issue with affected code, expected behavior, and a minimal reproduction. Do not post personal records, database files, credentials, or real document images.

There is no dedicated private reporting channel documented for this Alpha. If details are sensitive, use a public maintainer contact entry point to request a private channel without including the sensitive details. Do not assume an issue or pull request is private.
