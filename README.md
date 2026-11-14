# Mio

**A user-controlled personal data layer for AI.**

[简体中文](README.zh-CN.md) · [Connect your AI](docs/INTEGRATIONS.md) · [Research (中文)](docs/research/mio-personal-data-layer.zh-CN.md) · [Validation](docs/VALIDATION.md) · [Security](SECURITY.md)

Mio gives applications a local, structured place to keep facts about a person, the evidence behind them, proposed updates, and records of permission and review. The goal is to let people carry their information between AI assistants and decide what each task may use.

This release is an **identity-first Alpha**. It provides a SQLite core, JSON contracts, a local MCP adapter for AI clients, and a demonstration with two mock assistants. A general preference and relationship model, remote authentication, and production security controls are still roadmap work.

## Connect to Codex, Claude Code, or another MCP client

Install Node.js 24, clone this repository, then run `npm ci --ignore-scripts`. The MCP adapter uses the official MCP SDK and exposes only field discovery, scoped reads, and pending update proposals. User approval and sharing stay in a separate local operator CLI.

Start with fictional data using `node adapters/mcp/server.js --demo`; this command speaks MCP over stdio and waits for an MCP client. For the actual Codex/Claude registration commands, a pinned GitHub package option, and personal-profile setup, follow the [installation guide](docs/INTEGRATIONS.md).

GitHub distributes the code. Your database remains local, while the authorized values returned by tools enter your chosen AI client's context and may reach its model provider. Each in-memory demo is independent. Local file/shell access can bypass MCP, so this is not a sandbox against an assistant with the same OS account.

## Try it

Use Node.js 24. The core and demo have no third-party runtime dependencies and need no model downloads or API keys.

```sh
npm run demo
```

To install development validators and run the checks:

```sh
npm ci
npm test
npm run check
```

Run these commands from the repository root. `check` runs JavaScript syntax checks, the tests, and the demo. Development validation uses Ajv and ajv-formats.

The [two-assistant demo](examples/two-assistants.js) uses fictional information. Two local mock assistants receive different field selections through an example reader, and a proposed update enters the review workflow. It demonstrates how a host could limit disclosure; it does not connect to real models or provide caller authentication. Recording an accepted review decision does not itself change a canonical claim.

## What is here

| Component | Current role |
| --- | --- |
| [mio-core](mio-core/README.md) | Local SQLite storage, repository API, importers, search, and CLI |
| [contracts](contracts/README.md) | Versioned JSON formats for context and review exchange |
| [examples](examples/) | Fictional, executable integration examples |
| [adapters/mcp](adapters/mcp/) | Local stdio tools and separate operator administration |
| [benchmarks](benchmarks/README.md) | Reproducible comparison against a capable scoped JSON host |

The [engineering study](docs/research/mio-personal-data-layer.zh-CN.md) found identical outcomes for Mio and a competent JSON host on the tested policies. Both reduced unnecessary application payload compared with full-profile delivery. This is **not evidence of better model accuracy, token cost, or unique performance superiority**. A separate [real Codex smoke test](experiments/results/codex-mcp-smoke.json) verifies tool integration, not comparative AI quality.

The core includes:

- **Claims and evidence:** structured identity, contact, and employment facts, with source links, status, and timestamps.
- **Review:** proposed changes, pending queues, decisions, and decision receipts.
- **Grants and audit:** records of requesters, purposes, permitted claims, expiry, revocation, and events.
- **Wiki and notes:** contextual entries and constrained explanatory notes alongside structured facts.
- **Views and search:** compiled summaries, timelines, Markdown dossiers, and exact, keyword, or alias-based semantic search.

The public package is focused on the core and its contracts. It does not include a web app, mobile app, browser extension, or country-specific workflow.

## Trust boundary

The repository API and CLI are **trusted-host tools**. They can access the underlying data directly. A host application must authenticate callers, enforce permissions, and obtain user confirmation before exposing these operations to an assistant.

- SQLite files and generated exports are plaintext by default.
- Actor identifiers and grant records are data; they do not authenticate a user or assistant.
- Context builders, search, and full exports are not permission-scoped APIs. The demo reader is an example boundary, not a production security layer.
- Review decisions record workflow state. Applying an approved change to a canonical claim remains a separate host operation.
- Audit records live in the same database and are not tamper-proof.

Read [SECURITY.md](SECURITY.md) before integrating personal information.

## Direction

The next steps are to evaluate real task outcomes, define a broader personal data model, and add authenticated remote integrations. The local MCP operator flow now applies reviewed changes transactionally and requires a separate sharing action. Encryption, secure recovery, and migration policies still need design and validation.

Some API and contract names retain `Gemma` for compatibility. No Gemma model is required. Runtime validation is implemented in JavaScript; JSON Schema describes the exchange formats. Neither provides authentication. See [contracts](contracts/README.md) for validation details.

Contributions that improve these boundaries, reproducible examples, or interoperability are welcome. Licensed under [Apache-2.0](LICENSE).
