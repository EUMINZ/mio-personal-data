# Mio

**A user-controlled identity layer for agents.**

[简体中文](README.zh-CN.md) · [Connect your AI](docs/INTEGRATIONS.md) · [Architecture](docs/ARCHITECTURE.md) · [Validation](docs/VALIDATION.md) · [Security](SECURITY.md)

Mio keeps reusable personal facts, their sources, and the permissions that determine what each agent may use. New information collected during a task enters review before becoming a confirmed fact; sharing that fact with an agent is a separate decision.

The goal is one personal identity profile that works across agents and tasks. Travel is an initial use case alongside employee onboarding. The current trial prepares fictional form drafts; acting on external websites and submitting official applications remain future integrations.

**Status: `0.3.0-alpha` — an identity-first Alpha.** This repository contains a SQLite core, JSON contracts, a local MCP adapter, and executable examples with fictional data. Broader preference and relationship models, remote authentication, and production security controls remain roadmap work.

## Try one identity across two tasks

Use **Node.js 24**, npm, and Git. The commands below are for macOS/Linux POSIX shells and download the **unreleased trial branch**, not the older `v0.3.0-alpha` release. Run them from a directory where you want a new checkout:

```sh
git clone --branch codex/shared-profile-trial --single-branch https://github.com/EUMINZ/mio-personal-data.git mio-personal-data-trial
cd mio-personal-data-trial
git rev-parse HEAD
npm ci --ignore-scripts
mio_trial_dir="$(mktemp -d)/profile"
npm run demo:shared -- "$mio_trial_dir"
```

Record the printed commit for feedback: the trial branch can change. `mktemp` creates an empty parent outside the checkout; the launcher creates a new fictional profile inside it. Keep the terminal running and open the printed local review URL. Keep that URL private because it authorizes operator actions.

The [shared-profile example](examples/shared-profile/README.md) connects **Travel application A** and **Employee onboarding B** to one persistent fictional profile. Collect a missing employer during the travel task, review it, and explicitly share the confirmed fact with each assistant. Both drafts can then reuse the same fact and source. Trip details and onboarding details stay with their task rather than entering the identity profile.

Approval never automatically shares a fact. Pending proposals cannot fill identity fields. You can also **reject a proposal with a reason**, **close an outdated proposal**, or revoke one assistant without changing the other's grant. Use a fresh demo directory for this walkthrough; existing demo grants are not silently expanded.

Choose one way to try it:

- **Local walkthrough:** use the page's collection, review, sharing, and draft controls. No model account, API key, or model call is needed.
- **Real MCP clients:** copy the complete **Codex A** and **Claude Code B** commands printed by the launcher into separate terminals. Paths are filled in for your checkout and profile; user-level registrations are not changed. Client login and model access are required and may consume account usage.

Follow the [trial guide](docs/SHARED_PROFILE_TRIAL.md) for the exact scenario and feedback form. To print the client commands again, run `npm run demo:shared:commands -- /absolute/existing-demo-directory` from the checkout, using the profile directory printed at startup. This does not create a profile or renew a grant.

![Reviewed employment facts reused in the onboarding draft](docs/assets/identity-reuse.jpg)

The initial fictional workflow passed automated and browser checks. A real Codex client completed A's lifecycle; Claude Code B was blocked by authentication before tool use, so B was checked separately with the MCP SDK. **A complete two-model trial and independent external user trials remain unverified.** The [sanitized validation record](docs/trials/shared-profile-live-validation-2026-11-16.json) describes that earlier snapshot; see [validation](docs/VALIDATION.md) for checks of later changes.

## Released simulation and development checks

To reproduce the older **in-memory mock-assistant simulation**, use a separate checkout:

```sh
git clone --branch v0.3.0-alpha --single-branch https://github.com/EUMINZ/mio-personal-data.git mio-personal-data-v0.3
cd mio-personal-data-v0.3
npm ci --ignore-scripts
npm run demo
```

That release has no shared-profile review page and no `demo:shared` script. The [two-assistant simulation](examples/two-assistants.js) needs no model downloads or API keys and makes no model calls. The core and that simulation have no third-party runtime dependencies; the MCP adapter and review example use the official MCP SDK and validators installed by npm.

In either checkout, `npm run check` runs syntax checks, the tests available in that version, and the mock-assistant simulation. See the [validation record](docs/VALIDATION.md) for tested environments and limits.

## Connect your AI

Mio exposes a local **stdio MCP server** for Codex, Claude Code, and other compatible clients. Follow the [installation guide](docs/INTEGRATIONS.md) for client registration, a pinned GitHub package option, and personal-profile setup.

The unreleased trial branch has three default tools; the older `v0.3.0-alpha` release has the first two:

| Tool | Purpose |
| --- | --- |
| `mio_context` | Discover readable keys with `{}`, or request a batch of selected `fields`. |
| `mio_propose_update` | Propose a correction to an existing readable fact. |
| `mio_propose_fact` | Propose a missing personal fact with a source under an explicit collection grant. |

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
| Collection and review | Missing-fact proposals and corrections, source records, pending queues, rejection, and outdated closure. |
| Cross-task drafts | Two fictional templates reuse explicitly shared fact versions and keep task-specific answers separate. |
| Grants and audit | Records of requesters, purposes, permitted claims, expiry, revocation, and events. |
| Wiki and notes | Contextual entries and constrained explanatory notes alongside structured facts. |
| Views and search | Compiled summaries, timelines, Markdown dossiers, and exact, keyword, or alias-based semantic search. |

The workflow separates evidence, suggestions, confirmed facts, and permission to share:

```text
Task or source → New fact / correction → Operator review
                                                ↓
                                         Confirmed fact
                                                ↓
                                     Explicit sharing per agent
                                                ↓
                                  Scoped context → New task draft
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

The public project focuses on the core, contracts, adapters, and examples, including the local review page above. It does not include the full product application, a mobile app, browser extension, or country-specific workflow.

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
| [Unreleased shared-profile trial](docs/SHARED_PROFILE_TRIAL.md) | The identity-layer trial passed 152 tests, including new-fact review and cross-task drafts. [Validation](docs/VALIDATION.md) separates these checks from the earlier 136-test snapshot and partial real-client evidence; no new model trial or external adoption is claimed. |
| [Architecture study (Chinese)](docs/research/mio-personal-data-layer.zh-CN.md) | Mio and a competent scoped JSON host produced identical outcomes on the tested policies. Both reduced unnecessary application payload compared with full-profile delivery; this does not establish unique performance superiority. |
| [Codex integration smoke test](experiments/results/codex-mcp-smoke.json) | A historical `0.2.0-alpha` session verified real tool integration, not comparative model quality. |
| [Accuracy/cost experiment](experiments/accuracy-cost/README.md) | In 40 real Codex sessions with the same model, tasks, and host policy, legacy completed 12/20 tasks correctly and compact completed 20/20 by avoiding omissions of readable fields. This small synthetic sample does not establish general model accuracy. |

In the accuracy/cost experiment, total input tokens fell **7.34%**, while uncached input rose **3.50%**. Lower actual per-request charges are not established. The [full study (Chinese)](docs/research/accuracy-cost-optimization.zh-CN.md) includes results and limitations.

## Direction

The current milestone covers **collect → review → share → reuse in two fictional drafts**. The next boundaries are:

- Broader identity facts: multiple documents, historical employment, structured addresses, and conflicts between sources.
- Form adapters: explicit question-to-fact mappings, missing-information handling, and testing against selected real templates. Universal official-form compatibility is not implemented.
- Delegated actions: task, recipient, and action permissions for filling, uploading, or submitting through a trusted executor. Reading identity data does not itself grant submission authority.
- Authenticated integrations, encrypted storage, recovery, and external-user validation.

## Contributing

Contributions that improve trust boundaries, reproducible examples, or interoperability are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), use fictional fixtures, and describe the checks you ran.

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
