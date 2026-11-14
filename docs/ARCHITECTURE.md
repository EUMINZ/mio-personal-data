# Architecture

Mio is a local personal data layer for AI applications. The Alpha starts with identity, contact, document, and employment information. Its storage and workflow primitives are implemented; a general personal data model and authenticated assistant protocol are still being developed.

## Components

```text
Assistant or application
        |
        v
Trusted host: authentication, permission checks, user approval
        |
        v
Mio Core: contracts, importers, repository, compiled views
        |
        v
Local SQLite: claims, evidence, review, grants, wiki, notes, audit
```

The trusted host boundary is an integration responsibility. This repository includes a two-mock-assistant example and a local stdio MCP adapter. The adapter binds a person, requester and grant in an operator-controlled config, checks scope on every call and keeps approval outside the model's tool catalog. It is not a remote authentication service or an OS sandbox.

The repository uses Node.js 24's `node:sqlite`. Ordered SQL migrations create the schema. The database is the structured source of truth; Markdown dossiers and JSON snapshots are derived views.

## Information model

| Records | Role |
| --- | --- |
| `persons`, `claim_types`, `claims` | A person and typed facts, with status and timestamps |
| `evidence`, `claim_evidence_links`, `credentials` | Source records and links supporting claims |
| `review_bundles`, `review_items`, `review_decisions` | Suggested changes and their review history |
| `requesters`, `grants`, `grant_claims` | Requested use, purpose, claim selection, expiry, and revocation records |
| `wiki_entries`, `wiki_events`, `memory_items` | Context and explanatory notes alongside formal facts |
| `audit_events`, `timeline_entries` | Recorded operations and a readable continuation history |

Status and provenance help applications assess information. They do not establish real-world identity, verify source documents, or authenticate the actor that wrote a record.

## Update workflow

1. An adapter submits observations or proposals in a review bundle, or submits a supported maintenance action.
2. The host validates the payload and decides whether to import it. Review items retain suggested values, rationales, and evidence links.
3. A review decision is recorded and the queue item is resolved. Decision receipts support retry handling and show applied or skipped decisions.
4. If an accepted proposal should change a canonical claim, the host must perform that change separately under its own approval policy.

The core's `accepted` / `applied` vocabulary refers to review workflow state. It must not be read as proof that a canonical claim was changed. The local MCP operator CLI now composes approval, claim versioning and audit in a transaction; the generic core review importer still only records the workflow decision.

Maintenance actions with historical `Gemma` names are limited to wiki updates, marking wiki entries stale, and creating review items. That importer does not directly rewrite canonical claims. The low-level repository still permits direct writes and must remain inside the trusted host.

## Reads and disclosure

The core compiles summaries, evidence digests, context snapshots, pending review queues, timelines, and Markdown views. Search supports exact matches, keywords, and semantic aliases; it does not require an embedding model.

These operations can return information across a person's records. They do not automatically enforce a requester grant. Including a grant in a context snapshot is descriptive; it does not restrict the snapshot's contents.

The [two-assistant example](../examples/two-assistants.js) illustrates a separate reader that selects permitted fields for local mocks. A real integration needs authenticated requester identity, checks at every read and write boundary, and policies for derived information as well as raw claims. Revocation can prevent future disclosure through such a host; it cannot recall information already exported.

## Compatibility and limitations

The public release retains legacy vault/form import adapters and `Gemma` contract names. The producing user interfaces and models are not required or included. Runtime validation uses JavaScript; JSON Schema supports exchange tooling and independent validation. See [contracts](../contracts/README.md).

The database is plaintext, audit events are mutable by database owners, and caller identity is not verified by core. See [SECURITY.md](../SECURITY.md) for the full boundary, [integrations](INTEGRATIONS.md) for the local MCP interface, and the [engineering study](research/mio-personal-data-layer.zh-CN.md) for measured results and limits. The roadmap includes broader personal data types, authenticated remote adapters, encryption and recovery, and tested schema compatibility.
