import fs from 'node:fs';
import {
  validateContractPayload,
  validateGemmaCoreContextContract,
  validateGemmaMaintenanceContract,
  validateGemmaMaintenanceResultContract,
  validateReviewDecisionsContract,
  validateReviewDecisionsResultContract,
  validateReviewBundleContract,
  validateReviewQueueContract,
} from './contracts.js';

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith('--')) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        parsed[key] = true;
      } else {
        parsed[key] = next;
        index += 1;
      }
    } else {
      parsed._.push(value);
    }
  }
  return parsed;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isFlagEnabled(value) {
  if (value === true) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function parseCsvArg(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function ensureValidContract(validationResult) {
  if (validationResult.ok) return;
  const first = validationResult.errors[0];
  throw new Error(
    `Contract validation failed at ${first?.path ?? '$'}: ${first?.message ?? 'unknown reason'}`,
  );
}

function printUsage() {
  console.log(`Usage:
  node ./src/cli.js init-db --db /path/to/mio-core.sqlite
  node ./src/cli.js create-person --db /path/to/db --display-name "Alice Zhang"
  node ./src/cli.js create-requester --db /path/to/db --name "Mio Extension" --identifier "mio.browser-extension"
  node ./src/cli.js create-claim --db /path/to/db --person-id person_123 --claim-key passport.number --value "TEST00001" --status confirmed
  node ./src/cli.js create-wiki-entry --db /path/to/db --person-id person_123 --title "Preferred employer name" --summary "Use ACME Robotics for PROFILE-DEMO employment sections."
  node ./src/cli.js update-wiki-entry --db /path/to/db --entry-id wiki_123 --status verified --trust-level reviewed_merge
  node ./src/cli.js list-wiki-entries --db /path/to/db --person-id person_123 [--status verified,candidate] [--output /tmp/wiki.json]
  node ./src/cli.js import-gemma-maintenance --db /path/to/db --maintenance-file /path/to/mio-gemma-maintenance.json [--person-id person_123] [--output /tmp/mio-gemma-maintenance-result.json] [--validate]
  node ./src/cli.js import-web-vault --db /path/to/db --vault-file /path/to/plaintext-vault.json [--vault-id local-demo]
  node ./src/cli.js import-form-payload --db /path/to/db --payload-file /path/to/form-payload.json --person-id person_123
  node ./src/cli.js import-review-bundle --db /path/to/db --review-file /path/to/review-bundle.json --person-id person_123 [--validate]
  node ./src/cli.js import-review-decisions --db /path/to/db --decisions-file /path/to/review-decisions.json [--person-id person_123] [--output /tmp/review-decisions-result.json] [--validate]
  node ./src/cli.js issue-grant --db /path/to/db --person-id person_123 --requester-id requester_123 --purpose "PROFILE-DEMO autofill" --claim-keys person.name.first,passport.number
  node ./src/cli.js revoke-grant --db /path/to/db --grant-id grant_123
  node ./src/cli.js record-review-decision --db /path/to/db --review-item-id review_item_123 --decision accepted --actor-id local-user [--note "looks good"]
  node ./src/cli.js search-person-context --db /path/to/db --person-id person_123 --mode exact|keyword|semantic [--query "passport"] [--field-key passportNo] [--limit 10] [--output /tmp/search.json]
  node ./src/cli.js render-gemma-context --db /path/to/db --person-id person_123 [--output /tmp/gemma-context.json] [--validate]
  node ./src/cli.js render-review-queue-json --db /path/to/db --person-id person_123 [--output /tmp/review-queue.json] [--validate]
  node ./src/cli.js render-person-summary --db /path/to/db --person-id person_123 [--output /tmp/dossier.md]
  node ./src/cli.js render-review-queue --db /path/to/db --person-id person_123 [--output /tmp/review.md]
  node ./src/cli.js validate-contract --contract review-bundle|gemma-core-context|review-queue|review-decisions|review-decisions-result|gemma-maintenance|gemma-maintenance-result --file /path/to/input.json`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === 'validate-contract') {
    const contractName = args.contract;
    const payload = readJson(args.file);
    const validation = validateContractPayload(contractName, payload);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: validation.ok,
          contract: contractName,
          errorCount: validation.errors.length,
          errors: validation.errors,
        },
        null,
        2,
      )}\n`,
    );
    if (!validation.ok) {
      process.exitCode = 1;
    }
    return;
  }

  const dbPath = args.db ?? ':memory:';
  const { buildGemmaCoreContext } = await import('./gemma-context.js');
  const {
    importExecutionReviewBundle,
    importFormPayload,
    importGemmaMaintenanceBatch,
    importReviewDecisionBatch,
    importWebVaultState,
  } = await import('./importers.js');
  const { searchPersonContext } = await import('./identity-context.js');
  const { createCoreRepository } = await import('./repository.js');
  const { buildPendingReviewQueue } = await import('./review-queue.js');
  const { renderPendingReviewQueue, renderPersonDossier } = await import('./renderers.js');
  const { openCoreDatabase, closeCoreDatabase } = await import('./db.js');
  const db = openCoreDatabase({ filePath: dbPath });
  const repository = createCoreRepository(db);
  repository.registerDefaultClaimTypes();

  try {
    switch (command) {
      case 'init-db': {
        console.log(JSON.stringify({ ok: true, db: dbPath }, null, 2));
        break;
      }

      case 'create-person': {
        const person = repository.createPerson({ displayName: args['display-name'] ?? 'Unnamed Person' });
        console.log(JSON.stringify(person, null, 2));
        break;
      }

      case 'create-requester': {
        const requester = repository.createRequester({
          name: args.name ?? 'Unnamed requester',
          origin: args.origin ?? null,
          publicKeyOrIdentifier: args.identifier ?? args.name ?? 'requester',
        });
        console.log(JSON.stringify(requester, null, 2));
        break;
      }

      case 'create-claim': {
        const rawValue = args.value ?? '';
        const claim = repository.createClaim({
          personId: args['person-id'],
          claimTypeKey: args['claim-key'],
          value: rawValue,
          status: args.status ?? 'asserted',
          issuer: args.issuer ?? 'cli',
        });
        console.log(JSON.stringify(claim, null, 2));
        break;
      }

      case 'create-wiki-entry': {
        const entry = repository.createWikiEntry({
          personId: args['person-id'],
          title: args.title ?? 'Untitled wiki entry',
          category: args.category ?? 'identity',
          fieldKey: args['field-key'] ?? '',
          valueText: args.value ?? '',
          summaryText: args.summary ?? '',
          status: args.status ?? 'candidate',
          trustLevel: args['trust-level'] ?? 'user_asserted',
          autofillEligible: isFlagEnabled(args['autofill-eligible']),
          sourceKind: args['source-kind'] ?? '',
          sourceRef: args['source-ref'] ?? '',
          sourceLocator: args['source-locator'] ?? '',
          sourceDocumentIds: parseCsvArg(args['source-document-ids']),
          supportingEvidenceIds: parseCsvArg(args['supporting-evidence-ids']),
          tags: parseCsvArg(args.tags),
          metadata: args.metadata ? JSON.parse(args.metadata) : {},
          reviewedAt: typeof args['reviewed-at'] === 'string' ? args['reviewed-at'] : null,
          supersededByEntryId: typeof args['superseded-by'] === 'string' ? args['superseded-by'] : null,
          actorType: args['actor-type'] ?? 'user',
          actorId: args['actor-id'] ?? 'cli',
        });
        console.log(JSON.stringify(entry, null, 2));
        break;
      }

      case 'update-wiki-entry': {
        const update = {};
        const assign = (flag, key = flag) => {
          if (flag in args) update[key] = args[flag];
        };

        assign('title');
        assign('category');
        assign('field-key', 'fieldKey');
        assign('value', 'valueText');
        assign('summary', 'summaryText');
        assign('status');
        assign('trust-level', 'trustLevel');
        assign('source-kind', 'sourceKind');
        assign('source-ref', 'sourceRef');
        assign('source-locator', 'sourceLocator');
        if ('autofill-eligible' in args) {
          update.autofillEligible = isFlagEnabled(args['autofill-eligible']);
        }
        if ('source-document-ids' in args) {
          update.sourceDocumentIds = parseCsvArg(args['source-document-ids']);
        }
        if ('supporting-evidence-ids' in args) {
          update.supportingEvidenceIds = parseCsvArg(args['supporting-evidence-ids']);
        }
        if ('tags' in args) {
          update.tags = parseCsvArg(args.tags);
        }
        if ('metadata' in args) {
          update.metadata = JSON.parse(args.metadata);
        }
        if ('reviewed-at' in args) {
          update.reviewedAt = args['reviewed-at'];
        }
        if ('superseded-by' in args) {
          update.supersededByEntryId = args['superseded-by'];
        }
        if ('actor-type' in args) {
          update.actorType = args['actor-type'];
        }
        if ('actor-id' in args) {
          update.actorId = args['actor-id'];
        }

        const entry = repository.updateWikiEntry(args['entry-id'], update);
        console.log(JSON.stringify(entry, null, 2));
        break;
      }

      case 'list-wiki-entries': {
        const entries = repository.listWikiEntriesForPerson(args['person-id'], {
          statuses: 'status' in args ? parseCsvArg(args.status) : null,
          categories: 'category' in args ? parseCsvArg(args.category) : null,
          fieldKey: args['field-key'] ?? null,
          limit: Number.isInteger(Number(args.limit)) ? Number(args.limit) : null,
        });
        const json = JSON.stringify(entries, null, 2);
        if (args.output) {
          fs.writeFileSync(args.output, json, 'utf8');
          console.log(JSON.stringify({ ok: true, output: args.output, count: entries.length }, null, 2));
        } else {
          process.stdout.write(`${json}\n`);
        }
        break;
      }

      case 'import-web-vault': {
        const vaultState = readJson(args['vault-file']);
        const person = importWebVaultState(repository, {
          vaultId: args['vault-id'] ?? 'imported-vault',
          vaultState,
          personId: args['person-id'] ?? null,
        });
        console.log(JSON.stringify(person, null, 2));
        break;
      }

      case 'import-form-payload': {
        const formPayload = readJson(args['payload-file']);
        const result = importFormPayload(repository, {
          personId: args['person-id'],
          formPayload,
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'import-review-bundle': {
        const reviewBundle = readJson(args['review-file']);
        if (isFlagEnabled(args.validate)) {
          ensureValidContract(validateReviewBundleContract(reviewBundle));
        }
        const result = importExecutionReviewBundle(repository, {
          personId: args['person-id'],
          reviewBundle,
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'import-review-decisions': {
        const decisionBatch = readJson(args['decisions-file']);
        if (isFlagEnabled(args.validate)) {
          ensureValidContract(validateReviewDecisionsContract(decisionBatch));
        }
        const result = importReviewDecisionBatch(repository, {
          personId: args['person-id'] ?? null,
          decisionBatch,
        });
        if (isFlagEnabled(args.validate)) {
          ensureValidContract(validateReviewDecisionsResultContract(result));
        }
        const json = JSON.stringify(result, null, 2);
        if (args.output) {
          fs.writeFileSync(args.output, json, 'utf8');
          console.log(JSON.stringify({ ok: true, output: args.output }, null, 2));
        } else {
          process.stdout.write(`${json}\n`);
        }
        break;
      }

      case 'import-gemma-maintenance': {
        const maintenanceBatch = readJson(args['maintenance-file']);
        if (isFlagEnabled(args.validate)) {
          ensureValidContract(validateGemmaMaintenanceContract(maintenanceBatch));
        }
        const result = importGemmaMaintenanceBatch(repository, {
          personId: args['person-id'] ?? null,
          maintenanceBatch,
        });
        if (isFlagEnabled(args.validate)) {
          ensureValidContract(validateGemmaMaintenanceResultContract(result));
        }
        const json = JSON.stringify(result, null, 2);
        if (args.output) {
          fs.writeFileSync(args.output, json, 'utf8');
          console.log(JSON.stringify({ ok: true, output: args.output }, null, 2));
        } else {
          process.stdout.write(`${json}\n`);
        }
        break;
      }

      case 'issue-grant': {
        const claimKeys = (args['claim-keys'] ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

        const grant = repository.createGrant({
          personId: args['person-id'],
          requesterId: args['requester-id'],
          purpose: args.purpose ?? 'Grant issued from CLI',
          status: 'active',
          scope: { allowedFields: claimKeys, requestedFields: claimKeys },
          actions: ['read-granted-fields'],
          policy: {
            allowAutofill: true,
            requireManualReview: true,
          },
        });

        for (const claimKey of claimKeys) {
          const claim = repository.getLatestClaimForType(args['person-id'], claimKey);
          if (!claim) continue;
          repository.attachGrantClaim({
            grantId: grant.id,
            claimId: claim.id,
            accessMode: 'read',
          });
        }

        console.log(JSON.stringify(grant, null, 2));
        break;
      }

      case 'revoke-grant': {
        const grant = repository.revokeGrant(args['grant-id']);
        console.log(JSON.stringify(grant, null, 2));
        break;
      }

      case 'record-review-decision': {
        const result = repository.recordReviewDecision({
          reviewItemId: args['review-item-id'],
          decision: args.decision ?? 'accepted',
          actorType: args['actor-type'] ?? 'user',
          actorId: args['actor-id'] ?? 'local-user',
          note: args.note ?? '',
          appliedClaimId: args['applied-claim-id'] ?? null,
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'search-person-context': {
        const result = searchPersonContext(repository, args['person-id'], {
          mode: args.mode ?? 'keyword',
          query: args.query ?? '',
          fieldKey: args['field-key'] ?? '',
          limit: Number.isInteger(Number(args.limit)) ? Number(args.limit) : 10,
        });
        const json = JSON.stringify(result, null, 2);
        if (args.output) {
          fs.writeFileSync(args.output, json, 'utf8');
          console.log(JSON.stringify({ ok: true, output: args.output, totalHits: result.totalHits }, null, 2));
        } else {
          process.stdout.write(`${json}\n`);
        }
        break;
      }

      case 'render-gemma-context': {
        const context = buildGemmaCoreContext(repository, args['person-id']);
        if (isFlagEnabled(args.validate)) {
          ensureValidContract(validateGemmaCoreContextContract(context));
        }
        const json = JSON.stringify(context, null, 2);
        if (args.output) {
          fs.writeFileSync(args.output, json, 'utf8');
          console.log(JSON.stringify({ ok: true, output: args.output }, null, 2));
        } else {
          process.stdout.write(`${json}\n`);
        }
        break;
      }

      case 'render-review-queue-json': {
        const queue = buildPendingReviewQueue(repository, args['person-id']);
        if (isFlagEnabled(args.validate)) {
          ensureValidContract(validateReviewQueueContract(queue));
        }
        const json = JSON.stringify(queue, null, 2);
        if (args.output) {
          fs.writeFileSync(args.output, json, 'utf8');
          console.log(JSON.stringify({ ok: true, output: args.output }, null, 2));
        } else {
          process.stdout.write(`${json}\n`);
        }
        break;
      }

      case 'render-person-summary': {
        const markdown = renderPersonDossier(repository, args['person-id']);
        if (args.output) {
          fs.writeFileSync(args.output, markdown, 'utf8');
          console.log(JSON.stringify({ ok: true, output: args.output }, null, 2));
        } else {
          process.stdout.write(markdown);
        }
        break;
      }

      case 'render-review-queue': {
        const markdown = renderPendingReviewQueue(repository, args['person-id']);
        if (args.output) {
          fs.writeFileSync(args.output, markdown, 'utf8');
          console.log(JSON.stringify({ ok: true, output: args.output }, null, 2));
        } else {
          process.stdout.write(markdown);
        }
        break;
      }

      default: {
        printUsage();
        process.exitCode = 1;
      }
    }
  } finally {
    closeCoreDatabase(db);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
