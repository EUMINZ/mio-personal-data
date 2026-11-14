# Mio Core

The local SQLite foundation for [Mio](../README.md), a user-controlled personal data layer for AI.

Requires Node.js 24 and uses the built-in `node:sqlite` module. There are no third-party runtime dependencies. This is a trusted-host library and CLI, not an authenticated service.

## Start with the example

From the repository root:

```sh
npm run demo
```

The [two-assistant example](../examples/two-assistants.js) uses fictional data and a separate example reader to demonstrate field selection and review. It makes no external model calls. Run `npm ci` before the root `npm test` command to install development schema validators.

## Minimal library usage

Run this as an ES module from the repository root:

```js
import {
  openCoreDatabase,
  closeCoreDatabase,
  createCoreRepository,
} from './mio-core/src/index.js';

const db = openCoreDatabase(); // In memory; pass filePath to persist plaintext SQLite.
try {
  const repository = createCoreRepository(db);
  repository.registerDefaultClaimTypes();
  const person = repository.createPerson({ displayName: 'Alex Example' });
  repository.createClaim({
    personId: person.id,
    claimTypeKey: 'person.employment.job_title',
    value: 'Researcher',
    status: 'asserted',
    issuer: 'fictional-example',
  });
  console.log(person.id);
} finally {
  closeCoreDatabase(db);
}
```

Creating a claim through this API bypasses review. A host must control who can call it and when.

## CLI

From the repository root, use a disposable database for experiments:

```sh
node mio-core/src/cli.js init-db --db /tmp/mio-example.sqlite
node mio-core/src/cli.js create-person --db /tmp/mio-example.sqlite --display-name "Alex Example"
```

Use the returned person ID for subsequent commands:

```sh
node mio-core/src/cli.js render-person-summary --db /tmp/mio-example.sqlite --person-id PERSON_ID
node mio-core/src/cli.js render-review-queue-json --db /tmp/mio-example.sqlite --person-id PERSON_ID --validate
node mio-core/src/cli.js search-person-context --db /tmp/mio-example.sqlite --person-id PERSON_ID --mode keyword --query employer
```

Run `node mio-core/src/cli.js` to print the command reference. The no-argument invocation exits with a nonzero status. Legacy vault and form import commands remain for compatibility; their producing applications are not part of this release.

## Modules

| Module | Responsibility |
| --- | --- |
| `db.js`, `migrations/` | SQLite connection and versioned migrations |
| `repository.js` | Direct access to people, claims, evidence, review, grants, wiki, notes, and audit records |
| `importers.js` | Import compatibility formats, review bundles, decisions, and maintenance actions |
| `contracts.js` | Runtime payload validators |
| `identity-context.js`, `gemma-context.js` | Compile summaries, timelines, and context snapshots |
| `identity-search.js` | Exact, keyword, and alias-based semantic search; no embedding model |
| `review-queue.js`, `renderers.js` | JSON and Markdown views |

`Gemma` is a historical API name. The library has no Gemma model dependency.

## Integration constraints

The default claim vocabulary focuses on identity, contact details, documents, and employment. A general preference and relationship model remains future work.

Review decisions resolve queue items and retain the decision record. An `accepted` decision, including an item reported as `applied`, does not automatically update a canonical claim. The host must implement that separate operation and its policy.

Grants record permissions but do not automatically constrain repository methods, context builders, search, or full exports. Do not give untrusted assistants direct access to these operations. Validate incoming contracts explicitly; low-level functions do not universally run full contract validation. See [contracts](../contracts/README.md), [architecture](../docs/ARCHITECTURE.md), and [security](../SECURITY.md).
