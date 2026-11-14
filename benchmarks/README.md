# Architecture benchmark: what does the personal data layer improve?

This is a reproducible, deterministic **architecture and policy test**, not an
LLM-quality benchmark. It uses a fixed fictional identity profile, two mock
assistant identities, a scripted trusted user and an injected clock. There are
no model, network or real personal-data calls.

The result is deliberately qualified: **Mio and a competent scoped JSON host
produce the same responses and pass the same policy cases.** Sending fewer
fields improves data minimization and reduces the serialized application
payload compared with sending a whole profile. That benefit comes from the
policy and can be implemented without Mio. This experiment does not establish
that Mio improves answer accuracy, token cost, user time or speed.

## Reproduce

Use Node.js 24 or later, which supplies `node:sqlite`:

```sh
node --test tests/benchmark-architecture.test.js
node benchmarks/run.mjs
```

The runner writes
[`results/architecture-results.json`](results/architecture-results.json). Pass a
different relative output path as the first argument to avoid overwriting the
checked-in report, for example:

```sh
node benchmarks/run.mjs benchmarks/results/local-run.json
```

The benchmark itself uses only Node built-ins and Mio's local source. No package
installation or API credentials are required for these two commands. The
repository's broader test suite has separate development dependencies.

The report records the actual Node/SQLite versions, OS and architecture, UTC run
time, fixed report date, fixture hash and hashes of participating source files.
Its substantive results are deterministic; run timestamps, platform metadata
and source hashes can change. Generated internal record IDs are excluded from
reported metrics. The test suite runs the benchmark twice and compares all
substantive results.

## Comparators

| Comparator | Behavior | Role |
| --- | --- | --- |
| Full-profile reference | Returns every current fixture field in `{ "fields": ... }` for each task, without checking a grant. | Explicitly unscoped reference for payload and extra-field measurements; **not** an equal-policy security competitor. |
| Scoped JSON | Implements confirmed revisions, requester/person/grant binding, requested-field filtering, fixed-lifetime grants, revocation, review-before-update, revision-specific consent, audit and rollback in memory. | Competent alternative with the same policies on the tested fixture. It imports no Mio code. |
| Mio | Uses the actual public `readScopedClaims` reader, `createFictionalDemo` host, review importer and SQLite-backed core transactions. | Tests the existing Mio example's behavior rather than a substitute implementation. |

The JSON alternative is intentionally capable. A JSON file is a storage format,
not a prohibition on implementing review, grants or transactions. Its in-memory
copy/restore rollback and Mio's in-memory SQLite transactions both cover the
injected synchronous failures in this test; this is **not** a durable crash
recovery comparison. Neither comparator is exposed as an authentication service.

The two scoped implementations need only match the finite fixture's policies.
This report does not claim their APIs or behavior are equivalent for every
possible grant configuration, unknown field, malformed request or concurrent
operation.

## Fixed input and measurement method

[`fixture.json`](fixture.json) contains 24 explicitly fictional identity/contact
fields, short realistic-shaped values, three task requests and a fixed clock.
Email addresses use `example.invalid`; document and phone values are visibly
fictional. The 3-, 12- and 24-field profiles are nested prefixes of that same
fixture. This is a size-sensitivity grid, **not nine independent users or a
representative statistical sample**. It reflects the project's current
identity-first scope, not all forms of personal knowledge.

Each profile is read by these tasks:

1. A document assistant requests first and last name.
2. A contact assistant requests first name and email.
3. The same contact assistant requests only email.

Each grid cell uses a fresh host. Both scoped implementations return identical
field ordering and the same `{ "fields": ... }` envelope. The broad reference
contains only field values; private evidence, review metadata and unrelated
documents are excluded, so no artificial document padding inflates it.

Measurements are computed from the actual serialized response:

- **UTF-8 application bytes:** `Buffer.byteLength(JSON.stringify(response), 'utf8')`.
  This excludes prompts, tool schemas, MCP/JSON-RPC envelopes, transport framing,
  model tokenizer effects, reasoning and assistant output.
- **Extra fields:** delivered field keys not present in the task's requested
  field list. These are unnecessary disclosures for the specified task, not a
  count of exfiltration attacks or distinct people.
- **Missing fields:** requested keys absent from a successful response.

There is no timing benchmark. Node's test-runner durations include host setup,
database migrations and assertions; they must not be used as a latency or
throughput comparison. Code length and development time are not measured.

## Observed payload results

Recorded environment: Node `v24.12.0`, SQLite `3.50.4`, macOS (`darwin`) `arm64`.
Report date: 2026-11-14. Consult the raw JSON for the execution timestamp and
source hashes.

| Profile fields | Full profile bytes per task | Scoped bytes: document / contact / email-only | Full-profile extra fields: document / contact / email-only |
| ---: | ---: | ---: | ---: |
| 3 | 116 | 66 / 89 / 62 | 1 / 1 / 2 |
| 12 | 580 | 66 / 89 / 62 | 10 / 10 / 11 |
| 24 | 1,124 | 66 / 89 / 62 | 22 / 22 / 23 |

Both scoped implementations have **zero extra and zero missing fields** in all
nine deliveries. Across the equally weighted grid:

| Comparator | Total application bytes | Extra field occurrences | Missing fields |
| --- | ---: | ---: | ---: |
| Full-profile reference | 5,460 | 102 | 0 |
| Scoped JSON | 651 | 0 | 0 |
| Mio | 651 | 0 | 0 |

The scoped payload is **88.08% smaller** in this particular grid. This percentage
depends on profile length, value length, task mix and serialization. It is
**not** an 88.08% token-cost reduction, model-performance improvement or Mio
advantage over scoped JSON. A one-field task against a very large profile would
make this percentage larger without improving the underlying architecture.

## Lifecycle and failure results

Both scoped implementations pass all **13 cases**, including **8 expected read
denials**. These are deterministic contract assertions, not an empirical
failure-rate estimate or evidence of zero vulnerabilities.

| Case | Expected behavior | Scoped JSON | Mio |
| --- | --- | --- | --- |
| Authorized subset | Return exactly requested authorized fields | Pass | Pass |
| Field outside grant | Deny | Pass | Pass |
| Requester mismatch | Deny | Pass | Pass |
| Person mismatch | Deny | Pass | Pass |
| Unknown grant | Deny | Pass | Pass |
| Exact grant expiry boundary | Deny | Pass | Pass |
| Revoked grant | Deny | Pass | Pass |
| Tentative update | Keep old confirmed value while proposal is pending | Pass | Pass |
| Confirmed update, old grant | Deny; neither stale fallback nor unshared new value | Pass | Pass |
| Confirmed update, fresh consent | Return new confirmed value | Pass | Pass |
| Approval audit failure | Restore claims/review/decision/audit; old value remains usable | Pass | Pass |
| Sharing audit failure | Restore grants/links/audit/active handle; new value remains withheld | Pass | Pass |
| Other assistant after update | Unchanged name grant remains usable | Pass | Pass |

Each case starts from a fresh 24-field fixture. Updates are explicit scripted
user decisions, not inferred consent. Audit failures are injected after earlier
mutations, and the entire relevant host-state snapshot is compared before and
after the exception. Review acceptance and promotion to a confirmed claim are
composed by the example host; the core's generic review decision alone does not
automatically perform that promotion.

The update policy intentionally pins grants to claim revisions: changing a
confirmed email makes the old grant unusable for that email until the user
authorizes the new revision. This prevents the tested stale/unshared response,
but adds a user-consent step and may interrupt a workflow. A product choosing
automatic access to future revisions would implement a different policy.

## What remains unproven

- Real model answer quality, hallucination reduction, token usage and saved
  user effort require a separate end-to-end comparison with the same model,
  tasks, prompts, tools and policies.
- A client that already received a value still has its old response after
  revocation. The benchmark demonstrates this for **both** implementations.
  Neither revocation nor canonical updates erase a model's prior context or
  force a client to fetch again.
- Claim correctness and evidence truth are assumed by the fixed fixture. The
  test does not establish that imported documents or proposed values are true.
- This is one trusted local process. Authentication, encrypted storage,
  malicious local clients, concurrent writers, crash durability and large-data
  behavior are outside scope. Direct repository access can bypass the example
  reader, and the core's full export/context APIs are not grant-filtered.
- The report evaluates the scoped-reader example, not any later MCP or plugin
  transport. A plugin should have separate protocol/client tests and must bind
  user, requester and grants in its trusted host configuration.

Mio's plausible engineering value is packaging a reusable claim/review/grant
lifecycle and its tests so each assistant integration does not reimplement it.
The existing core also stores provenance and audit records. Those are useful
design properties visible in the code; this experiment does not quantify
developer-time savings, adoption, reliability in production or superiority
over mature alternatives.
