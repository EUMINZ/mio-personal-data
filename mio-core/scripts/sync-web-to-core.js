import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildGemmaCoreContext,
  buildPendingReviewQueue,
  closeCoreDatabase,
  createCoreRepository,
  importFormPayload,
  importReviewDecisionBatch,
  importWebVaultState,
  openCoreDatabase,
  validateGemmaCoreContextContract,
  validateReviewDecisionsContract,
  validateReviewDecisionsResultContract,
  validateReviewQueueContract,
} from '../src/index.js';

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

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, payload) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function isFlagEnabled(value) {
  if (value === true) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function ensureValidContract(validationResult) {
  if (validationResult.ok) return;
  const first = validationResult.errors[0];
  throw new Error(
    `Contract validation failed at ${first?.path ?? '$'}: ${first?.message ?? 'unknown reason'}`,
  );
}

function deriveDefaultOutputPath(sourcePath, suffix) {
  const parsed = path.parse(sourcePath);
  return path.join(parsed.dir, `${parsed.name}.${suffix}.json`);
}

function inferVaultId(vaultFilePath, explicitVaultId) {
  if (explicitVaultId) return explicitVaultId;
  return path.parse(vaultFilePath).name || 'mio-web-sync';
}

function countReviewItems(queue) {
  return queue.bundles.reduce((total, bundle) => total + bundle.items.length, 0);
}

export function syncWebToCore({
  dbPath,
  vaultFile,
  payloadFile,
  vaultId,
  personId,
  reviewQueueOutput,
  gemmaContextOutput,
  summaryOutput,
  decisionsFile,
  decisionsResultOutput,
  validate = false,
} = {}) {
  if (!dbPath) {
    throw new Error('--db is required.');
  }

  const hasFullSyncInputs = Boolean(vaultFile && payloadFile);
  const hasDecisionsInput = Boolean(decisionsFile);

  if (!hasFullSyncInputs && !hasDecisionsInput) {
    throw new Error('Provide --vault-file + --payload-file for full sync, or --decisions-file for decisions import.');
  }

  if (!hasFullSyncInputs && hasDecisionsInput && !personId) {
    throw new Error('--person-id is required when importing decisions without --vault-file and --payload-file.');
  }

  const db = openCoreDatabase({ filePath: dbPath });
  const repository = createCoreRepository(db);
  repository.registerDefaultClaimTypes();

  try {
    let resolvedPerson = personId ? repository.getPerson(personId) : null;
    let grant = null;
    let requester = null;
    let queue = null;
    let context = null;
    let receipt = null;

    if (hasFullSyncInputs) {
      const vaultState = readJson(vaultFile);
      const formPayload = readJson(payloadFile);
      resolvedPerson = importWebVaultState(repository, {
        vaultId: inferVaultId(vaultFile, vaultId),
        vaultState,
        personId: personId ?? null,
      });
      const importResult = importFormPayload(repository, {
        personId: resolvedPerson.id,
        formPayload,
      });
      grant = importResult.grant;
      requester = importResult.requester;

      queue = buildPendingReviewQueue(repository, resolvedPerson.id);
      context = buildGemmaCoreContext(repository, resolvedPerson.id);

      if (validate) {
        ensureValidContract(validateReviewQueueContract(queue));
        ensureValidContract(validateGemmaCoreContextContract(context));
      }

      const resolvedReviewQueueOutput = reviewQueueOutput || deriveDefaultOutputPath(payloadFile, 'review-queue');
      const resolvedGemmaContextOutput = gemmaContextOutput || deriveDefaultOutputPath(payloadFile, 'gemma-context');
      writeJson(resolvedReviewQueueOutput, queue);
      writeJson(resolvedGemmaContextOutput, context);
      reviewQueueOutput = resolvedReviewQueueOutput;
      gemmaContextOutput = resolvedGemmaContextOutput;
    } else if (!resolvedPerson) {
      throw new Error(`Person ${personId} was not found in ${dbPath}.`);
    }

    if (hasDecisionsInput) {
      const decisionBatch = readJson(decisionsFile);
      if (validate) {
        ensureValidContract(validateReviewDecisionsContract(decisionBatch));
      }
      receipt = importReviewDecisionBatch(repository, {
        personId: resolvedPerson.id,
        decisionBatch,
      });
      if (validate) {
        ensureValidContract(validateReviewDecisionsResultContract(receipt));
      }
      const resolvedDecisionsResultOutput =
        decisionsResultOutput || deriveDefaultOutputPath(decisionsFile, 'result');
      writeJson(resolvedDecisionsResultOutput, receipt);
      decisionsResultOutput = resolvedDecisionsResultOutput;

      if (!queue) {
        queue = buildPendingReviewQueue(repository, resolvedPerson.id);
      }
      if (!context) {
        context = buildGemmaCoreContext(repository, resolvedPerson.id);
      }
    }

    const summary = {
      schemaVersion: 'mio.core.sync.summary.v1',
      generatedAt: new Date().toISOString(),
      dbPath,
      person: resolvedPerson
        ? {
            id: resolvedPerson.id,
            displayName: resolvedPerson.displayName,
          }
        : null,
      requester: requester
        ? {
            id: requester.id,
            name: requester.name,
          }
        : null,
      grant: grant
        ? {
            id: grant.id,
            status: grant.status,
          }
        : null,
      outputs: {
        reviewQueue: reviewQueueOutput || null,
        gemmaContext: gemmaContextOutput || null,
        decisionsResult: decisionsResultOutput || null,
      },
      reviewQueue: queue
        ? {
            bundleCount: queue.bundles.length,
            pendingItemCount: countReviewItems(queue),
          }
        : null,
      gemmaContext: context
        ? {
            evidenceCount: context.evidence.length,
            proposalCount: context.proposals.length,
            pendingReviewCount: context.pendingReview.length,
            memoryCount: Array.isArray(context.memory) ? context.memory.length : 0,
            activeGrantCount: context.activeGrants.length,
          }
        : null,
      decisions: receipt
        ? {
            batchId: receipt.batchId,
            appliedCount: receipt.appliedCount,
            skippedCount: receipt.skippedCount,
            acknowledgedCount: receipt.acknowledgedDecisionIds.length,
          }
        : null,
    };

    const resolvedSummaryOutput =
      summaryOutput ||
      deriveDefaultOutputPath(decisionsFile || payloadFile || vaultFile, 'sync-summary');
    writeJson(resolvedSummaryOutput, summary);
    summaryOutput = resolvedSummaryOutput;

    return summary;
  } finally {
    closeCoreDatabase(db);
  }
}

function printUsage() {
  console.log(`Usage:
  node ./scripts/sync-web-to-core.js --db /tmp/mio-core.sqlite --vault-file /path/to/mio-vault-state.json --payload-file /path/to/mio-form-payload.json [--vault-id local-demo] [--person-id person_123] [--review-queue-output /path/to/review-queue.json] [--gemma-context-output /path/to/gemma-context.json] [--summary-output /path/to/sync-summary.json] [--validate]
  node ./scripts/sync-web-to-core.js --db /tmp/mio-core.sqlite --person-id person_123 --decisions-file /path/to/review-decisions.json [--decisions-result-output /path/to/review-decisions-result.json] [--summary-output /path/to/sync-summary.json] [--validate]`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db || (!args['vault-file'] && !args['decisions-file'])) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const summary = syncWebToCore({
    dbPath: args.db,
    vaultFile: args['vault-file'],
    payloadFile: args['payload-file'],
    vaultId: args['vault-id'],
    personId: args['person-id'],
    reviewQueueOutput: args['review-queue-output'],
    gemmaContextOutput: args['gemma-context-output'],
    summaryOutput: args['summary-output'],
    decisionsFile: args['decisions-file'],
    decisionsResultOutput: args['decisions-result-output'],
    validate: isFlagEnabled(args.validate),
  });

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
