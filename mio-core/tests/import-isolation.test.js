import test from 'node:test';
import assert from 'node:assert/strict';
import { openCoreDatabase, closeCoreDatabase } from '../src/db.js';
import { createCoreRepository } from '../src/repository.js';
import { importExecutionReviewBundle, importGemmaMaintenanceBatch } from '../src/importers.js';

const GENERATED_AT = '2026-01-01T00:00:00.000Z';

function withRepository(run) {
  const db = openCoreDatabase();
  const repository = createCoreRepository(db);
  repository.registerDefaultClaimTypes();
  const first = repository.createPerson({ displayName: 'Fictional Person A' });
  const second = repository.createPerson({ displayName: 'Fictional Person B' });
  try {
    return run(repository, first, second);
  } finally {
    closeCoreDatabase(db);
  }
}

function reviewBundle(reviewBundleId = 'fixture-review-bundle') {
  return {
    schemaVersion: 'mio.review.bundle.v1',
    reviewBundleId,
    createdAt: GENERATED_AT,
    source: { producer: 'fictional-adapter' },
    summary: {},
    requestedFields: ['email'],
    injectedFields: [],
    pageProfile: { email: 'first@example.invalid' },
    tripRecord: {},
    observations: [],
    proposals: [],
  };
}

function maintenanceBatch(personId, actions) {
  return {
    schemaVersion: 'mio.gemma.maintenance.v1',
    generatedAt: GENERATED_AT,
    batchId: 'fixture-maintenance-batch',
    person: { id: personId },
    source: { producer: 'fictional-assistant', model: 'example-local-model' },
    actions,
  };
}

function reviewAction(actionId = 'fixture-review-action') {
  return {
    actionId,
    actionType: 'create_review_item',
    fieldKey: 'email',
    suggestedValue: 'suggested@example.invalid',
    rationale: 'Fictional contact update awaiting review.',
    confidence: 'medium',
    riskLevel: 'medium',
  };
}

function personSnapshot(repository, personId) {
  const bundles = repository.listReviewBundlesForPerson(personId);
  const wikiEntries = repository.listWikiEntriesForPerson(personId);
  return {
    bundles,
    reviewItems: bundles.flatMap((bundle) => repository.listReviewItemsForBundle(bundle.id)),
    wikiEntries,
    wikiEvents: repository.listWikiEventsForPerson(personId),
    memory: repository.listMemoryItemsForPerson(personId),
    audit: repository.listAuditEventsForPerson(personId),
    timeline: repository.listTimelineEntries(personId),
  };
}

test('review bundle import rejects cross-person source ID reuse without returning another person data', () => {
  withRepository((repository, first, second) => {
    const payload = reviewBundle();
    importExecutionReviewBundle(repository, { personId: first.id, reviewBundle: payload });
    const firstBefore = personSnapshot(repository, first.id);
    const secondBefore = personSnapshot(repository, second.id);

    assert.throws(
      () => importExecutionReviewBundle(repository, { personId: second.id, reviewBundle: payload }),
      /Review bundle belongs to a different person/,
    );
    assert.deepEqual(personSnapshot(repository, first.id), firstBefore);
    assert.deepEqual(personSnapshot(repository, second.id), secondBefore);
  });
});

test('review bundle import retains same-person idempotency', () => {
  withRepository((repository, first) => {
    const payload = reviewBundle();
    const imported = importExecutionReviewBundle(repository, { personId: first.id, reviewBundle: payload });
    const before = personSnapshot(repository, first.id);
    const repeated = importExecutionReviewBundle(repository, { personId: first.id, reviewBundle: payload });

    assert.equal(repeated.reusedExisting, true);
    assert.equal(repeated.bundle.id, imported.bundle.id);
    assert.equal(repeated.bundle.personId, first.id);
    assert.deepEqual(repeated.items, imported.items);
    assert.deepEqual(personSnapshot(repository, first.id), before);
  });
});

test('review import rolls back a newly created bundle and items when a later item conflicts', () => {
  withRepository((repository, first, second) => {
    const firstPayload = reviewBundle('first-bundle');
    firstPayload.observations = [{ observationId: 'shared-observation', field: 'jobTitle', nextValue: 'Designer' }];
    importExecutionReviewBundle(repository, { personId: first.id, reviewBundle: firstPayload });
    const firstBefore = personSnapshot(repository, first.id);
    const secondBefore = personSnapshot(repository, second.id);
    const secondPayload = reviewBundle('second-bundle');
    secondPayload.observations = [{ observationId: 'shared-observation', field: 'jobTitle', nextValue: 'Engineer' }];

    assert.throws(
      () => importExecutionReviewBundle(repository, { personId: second.id, reviewBundle: secondPayload }),
      /UNIQUE constraint failed/,
    );
    assert.deepEqual(personSnapshot(repository, first.id), firstBefore);
    assert.deepEqual(personSnapshot(repository, second.id), secondBefore);
    assert.equal(repository.findReviewBundleBySourceBundleId('second-bundle'), null);
  });
});

test('maintenance import rejects cross-person batch ID reuse and rolls back earlier wiki changes', () => {
  withRepository((repository, first, second) => {
    importGemmaMaintenanceBatch(repository, {
      maintenanceBatch: maintenanceBatch(first.id, [reviewAction('first-review-action')]),
    });
    const existingWiki = repository.createWikiEntry({
      personId: second.id,
      title: 'Fictional existing note',
      summaryText: 'Preserve this original text.',
      status: 'verified',
      trustLevel: 'user_asserted',
    });
    const firstBefore = personSnapshot(repository, first.id);
    const secondBefore = personSnapshot(repository, second.id);
    const actions = [
      {
        actionId: 'second-wiki-update',
        actionType: 'upsert_wiki_entry',
        entryId: existingWiki.id,
        title: 'Attempted update',
        summaryText: 'This change must roll back.',
        rationale: 'Fictional proposed change.',
        confidence: 'medium',
        riskLevel: 'low',
      },
      {
        actionId: 'second-wiki-create',
        actionType: 'upsert_wiki_entry',
        title: 'Attempted new note',
        summaryText: 'This new entry must roll back.',
        rationale: 'Fictional proposed note.',
        confidence: 'medium',
        riskLevel: 'low',
      },
      reviewAction('second-review-action'),
    ];

    assert.throws(
      () => importGemmaMaintenanceBatch(repository, { maintenanceBatch: maintenanceBatch(second.id, actions) }),
      /Maintenance review bundle belongs to a different person/,
    );
    assert.deepEqual(personSnapshot(repository, first.id), firstBefore);
    assert.deepEqual(personSnapshot(repository, second.id), secondBefore);
  });
});

test('maintenance import retains same-person action idempotency for a repeated batch', () => {
  withRepository((repository, first) => {
    const payload = maintenanceBatch(first.id, [reviewAction()]);
    const imported = importGemmaMaintenanceBatch(repository, { maintenanceBatch: payload });
    const before = personSnapshot(repository, first.id);
    const repeated = importGemmaMaintenanceBatch(repository, { maintenanceBatch: payload });
    const after = personSnapshot(repository, first.id);

    assert.equal(repeated.reviewBundleId, imported.reviewBundleId);
    assert.equal(repeated.appliedCount, 0);
    assert.equal(repeated.skippedCount, 1);
    assert.equal(repeated.skipped[0].reason, 'already_imported');
    assert.deepEqual(repeated.acknowledgedActionIds, ['fixture-review-action']);
    assert.deepEqual(after.bundles, before.bundles);
    assert.deepEqual(after.reviewItems, before.reviewItems);
    assert.deepEqual(after.memory, before.memory);
    assert.deepEqual(after.wikiEntries, before.wikiEntries);
    // Each import attempt intentionally adds a batch audit event and timeline entry.
    assert.equal(after.audit.length, before.audit.length + 1);
    assert.equal(after.timeline.length, before.timeline.length + 1);
  });
});
