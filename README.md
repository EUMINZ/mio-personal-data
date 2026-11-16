# Mio

**A user-controlled personal data layer for AI.**

[简体中文](README.zh-CN.md) · [Connect your AI](docs/INTEGRATIONS.md) · [Architecture](docs/ARCHITECTURE.md) · [Validation](docs/VALIDATION.md) · [Security](SECURITY.md)

Mio gives people a local, structured place to keep facts about themselves, the evidence behind those facts, and proposed updates from AI assistants. Applications can request selected information for a task, while a separate operator workflow handles review and sharing.

The goal is to let people carry their information between AI assistants and decide what each task may use.

**Status: `0.3.0-alpha` — an identity-first Alpha.** This repository contains a SQLite core, JSON contracts, a local MCP adapter, and executable examples with fictional data. Broader preference and relationship models, remote authentication, and production security controls remain roadmap work.

## Quick start

Use **Node.js 24**, npm, and Git. From a terminal:

```sh
git clone https://github.com/EUMINZ/mio-personal-data.git
cd mio-personal-data
git checkout --detach v0.3.0-alpha
npm ci --ignore-scripts
npm run demo
```

The [two-assistant demo](examples/two-assistants.js) uses fictional information. Two local mock assistants receive different field selections, and a proposed update enters a review workflow. It needs no model downloads or API keys and makes no model API calls.

The core and demo have no third-party runtime dependencies. The MCP adapter uses the official MCP SDK; the installation above also includes development validators.

To run JavaScript syntax checks, all tests, and the demo:

```sh
npm run check
```

Run these commands from the repository root. See the [validation record](docs/VALIDATION.md) for the tested environment and known limits.

## Connect your AI

Mio exposes a local **stdio MCP server** for Codex, Claude Code, and other compatible clients. Follow the [installation guide](docs/INTEGRATIONS.md) for client registration, a pinned GitHub package option, and personal-profile setup.

The default interface has two tools:

| Tool | Purpose |
| --- | --- |
| `mio_context` | Discover readable keys with `{}`, or request a batch of selected `fields`. |
| `mio_propose_update` | Record a pending proposal for operator review. |

The demo server entrypoint is:

```sh
node adapters/mcp/server.js --demo
```

This command speaks MCP over stdio and waits for a client; use `npm run demo` for the standalone demonstration. Each demo server process starts its own independent fictional, in-memory database.

Context reads return allowed values, a uniform `unavailable` key list, and `checkedAt`. Reads are not cached. An invalid overall grant or a database/audit error fails the whole call. The timestamp records a permission/read check, not proof that a fact is true or current. The [integration guide](docs/INTEGRATIONS.md) explains the field policy and the optional `--legacy-tools` interface.

**Approval and sharing are separate operator actions, outside MCP.** The operator CLI applies an approved change transactionally; sharing the updated value requires a subsequent explicit action.

GitHub distributes the code. The database stays on your machine, but authorized tool results enter your chosen AI client's context and may reach its model provider. MCP checks do not isolate the database from an assistant with shell or file access under the same OS account.

## What Mio provides

| Capability | Current scope |
| --- | --- |
| Claims and evidence | Structured identity, contact, and employment facts, with source links, status, and timestamps. |
| Review | Proposed changes, pending queues, decisions, and decision receipts. |
| Grants and audit | Records of requesters, purposes, permitted claims, expiry, revocation, and events. |
| Wiki and notes | Contextual entries and constrained explanatory notes alongside structured facts. |
| Views and search | Compiled summaries, timelines, Markdown dossiers, and exact, keyword, or alias-based semantic search. |

The workflow separates evidence, suggestions, confirmed facts, and permission to share:

```text
Evidence → Proposed update → Operator review → Confirmed fact
                                                   ↓
                                           Explicit sharing
                                                   ↓
                                        Scoped context for AI
```

A core review decision is a workflow record: recording acceptance alone does not change a canonical claim. A trusted host must apply that change separately; the MCP operator CLI provides an implementation of this step.

## Repository layout

| Component | Role |
| --- | --- |
| [mio-core](mio-core/README.md) | Local SQLite storage, repository API, importers, search, and CLI. |
| [contracts](contracts/README.md) | Versioned JSON formats for context and review exchange. |
| [adapters/mcp](adapters/mcp/) | Local stdio tools and separate operator administration. |
| [examples](examples/) | Fictional, executable integration examples. |
| [benchmarks](benchmarks/README.md) | Reproducible comparison against a capable scoped JSON host. |
| [experiments](experiments/accuracy-cost/README.md) | Client integration and accuracy/cost evaluation. |

The public project focuses on the core, contracts, adapters, and examples. It does not include a web app, mobile app, browser extension, or country-specific workflow.

Some API and contract names retain `Gemma` for compatibility. No Gemma model is required. Runtime validation is implemented in JavaScript; JSON Schema describes the exchange formats. See [contracts](contracts/README.md) for details.

## Trust boundary

Mio is an Alpha for local development and integration research. It has not undergone an independent security audit.

- **Storage is plaintext by default.** SQLite databases and generated exports are not encrypted by Mio.
- **The core API and CLI trust the host.** Context builders, search, and full exports are not permission-scoped APIs. Host applications must authenticate callers, enforce permissions, and control user approval.
- **Grant records are not authentication.** Actor identifiers and recorded permissions do not establish who is making a call.
- **MCP checks apply to tool calls.** The adapter enforces its configured grant, but an assistant with access to the same database, files, or operator CLI can bypass that boundary.
- **Audit records are mutable.** They live in the same database and are not a tamper-proof ledger.
- **Shared values cannot be recalled.** Revoking a grant does not remove copies already retained by a client or model provider.

Use fictional information while experimenting. Read [SECURITY.md](SECURITY.md) before integrating personal information.

## Validation and research

The evidence below describes specific checks and experiments, not a general claim of production readiness or better AI performance.

| Evidence | Finding and limit |
| --- | --- |
| [Automated validation](docs/VALIDATION.md) | The `0.3.0-alpha` record reports 110 passing tests, including MCP behavior. GitHub Actions runs the checks on Node.js 24. |
| [Architecture study (Chinese)](docs/research/mio-personal-data-layer.zh-CN.md) | Mio and a competent scoped JSON host produced identical outcomes on the tested policies. Both reduced unnecessary application payload compared with full-profile delivery; this does not establish unique performance superiority. |
| [Codex integration smoke test](experiments/results/codex-mcp-smoke.json) | A historical `0.2.0-alpha` session verified real tool integration, not comparative model quality. |
| [Accuracy/cost experiment](experiments/accuracy-cost/README.md) | In 40 real Codex sessions with the same model, tasks, and host policy, legacy completed 12/20 tasks correctly and compact completed 20/20 by avoiding omissions of readable fields. This small synthetic sample does not establish general model accuracy. |

In the accuracy/cost experiment, total input tokens fell **7.34%**, while uncached input rose **3.50%**. Lower actual per-request charges are not established. The [full study (Chinese)](docs/research/accuracy-cost-optimization.zh-CN.md) includes results and limitations.

## Direction

Next steps include:

- Evaluating outcomes across more real tasks and clients.
- Defining portable preference and relationship models.
- Adding authenticated remote integrations.
- Designing and validating encrypted storage, secure recovery, and migration policies.

## Contributing

Contributions that improve trust boundaries, reproducible examples, or interoperability are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), use fictional fixtures, and describe the checks you ran.

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
