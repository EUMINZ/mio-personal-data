# Mio contracts

Versioned JSON formats for exchanging context, proposed updates, review queues, and decisions with a trusted host.

| Runtime contract name | `schemaVersion` | Purpose |
| --- | --- | --- |
| `review-bundle` | `mio.review.bundle.v1` | Observations and proposed changes |
| `review-queue` | `mio.review.queue.v1` | Pending review items grouped into bundles |
| `review-decisions` | `mio.review.decisions.v1` | Decisions submitted to the host |
| `review-decisions-result` | `mio.review.decisions.result.v1` | Applied or skipped decision receipts |
| `gemma-core-context` | `mio.gemma.core-context.v1` | Compiled personal context snapshot |
| `gemma-maintenance` | `mio.gemma.maintenance.v1` | Wiki updates and new review items |
| `gemma-maintenance-result` | `mio.gemma.maintenance.result.v1` | Maintenance action receipts |

The first five have JSON Schema files in this directory. The maintenance contracts currently have JavaScript validators only. Historical `Gemma` names and schema identifiers are retained for compatibility; no model or network service is required. Schema `$id` values are identifiers, not hosted endpoints.

## Runtime validation

Runtime checks are implemented in [`mio-core/src/contracts.js`](../mio-core/src/contracts.js). Run validation explicitly before importing untrusted payloads:

```sh
node mio-core/src/cli.js validate-contract --contract review-decisions --file /tmp/review-decisions.json
```

Or import `validateContractPayload(contractName, payload)` and inspect its `{ ok, errors }` result. Import CLI commands that support `--validate` use these JavaScript validators. Low-level import functions do not all enforce the full validator themselves.

Validation checks structure; it does not authenticate `actorId`, establish permission, prove evidence, or establish consent. The host must enforce those properties separately.

## JSON Schema and compatibility

The JSON Schema files describe exchange formats for tooling and independent validation. Runtime acceptance is determined by the JavaScript validator actually invoked by the host. These are separate implementations: a result from one validator is not evidence that the other was run. When changing a contract, update both representations and include representative accepted and rejected payloads in regression coverage.

Development schema validation uses Ajv and ajv-formats, installed with `npm ci`. It is separate from the core's dependency-free runtime.

## Meaning of a receipt

An applied review-decision receipt means the decision was recorded and the review item resolved. It does not mean the canonical claim was changed. Likewise, a context snapshot can contain broad personal information: the presence of `activeGrants` in the snapshot does not make it a permission-scoped response.
