import { selectRelevantMemoryItems } from './memory-sidecar.js';

function isString(value) {
  return typeof value === 'string';
}

function normalizeString(value) {
  return isString(value) ? value.trim() : '';
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return {};
  const next = {};
  for (const [key, value] of Object.entries(record)) {
    const normalized = normalizeString(value);
    if (!normalized) continue;
    next[key] = normalized;
  }
  return next;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(value);
}

function normalizeMemoryItem(memoryItem) {
  return {
    id: memoryItem.id,
    kind: normalizeString(memoryItem.kind),
    title: normalizeString(memoryItem.title),
    snippetText: normalizeString(memoryItem.snippetText),
    rationale: normalizeString(memoryItem.rationale),
    sourceKind: normalizeString(memoryItem.sourceKind),
    sourceRef: normalizeString(memoryItem.sourceRef),
    sourceLocator: normalizeString(memoryItem.sourceLocator),
    createdAt: normalizeString(memoryItem.createdAt),
  };
}

export function buildPendingReviewQueue(
  repository,
  personId,
  { generatedAt = new Date().toISOString(), statuses = ['pending', 'partially_applied'] } = {},
) {
  const person = repository.getPerson(personId);
  if (!person) {
    throw new Error(`Unknown person: ${personId}`);
  }

  const bundles = repository.listReviewBundlesForPerson(personId, { statuses });
  const memoryItems = repository.listMemoryItemsForPerson(personId);

  return {
    schemaVersion: 'mio.review.queue.v1',
    generatedAt,
    person: {
      id: person.id,
      displayName: person.displayName,
    },
    bundles: bundles.map((bundle) => {
      const pendingItems = repository.listReviewItemsForBundle(bundle.id, {
        statuses: ['pending'],
      });

      return {
        bundleId: bundle.id,
        sourceBundleId: bundle.sourceBundleId,
        sourceSystem: bundle.sourceSystem,
        producer: bundle.producer,
        stageKey: bundle.stageKey,
        stageLabel: bundle.stageLabel,
        status: bundle.status,
        createdAt: bundle.createdAt,
        updatedAt: bundle.updatedAt,
        requestedFields: Array.isArray(bundle.requestedFields) ? bundle.requestedFields : [],
        injectedFields: Array.isArray(bundle.injectedFields) ? bundle.injectedFields : [],
        pageProfile: normalizeRecord(bundle.pageProfile),
        tripRecord: normalizeRecord(bundle.tripRecord),
        summary: bundle.summary && typeof bundle.summary === 'object' ? bundle.summary : {},
        source: bundle.source && typeof bundle.source === 'object' ? bundle.source : {},
        pendingItemCount: pendingItems.length,
        items: pendingItems.map((item) => ({
          itemId: item.id,
          itemType: item.itemType,
          field: item.fieldKey,
          target: item.target,
          suggestedValue: normalizeValue(item.suggestedValue),
          currentValue: normalizeValue(item.currentValue),
          rationale: normalizeString(item.rationale),
          sourceDocumentIds: Array.isArray(item.sourceDocumentIds) ? item.sourceDocumentIds : [],
          supportingEvidenceIds: Array.isArray(item.supportingEvidenceIds) ? item.supportingEvidenceIds : [],
          status: item.status,
          createdAt: item.createdAt,
          relatedMemory: selectRelevantMemoryItems(memoryItems, {
            fieldKey: item.fieldKey,
            sessionOrBundleId: bundle.id,
            limit: 3,
          }).map(normalizeMemoryItem),
        })),
      };
    }),
  };
}
