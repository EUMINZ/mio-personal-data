import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateContractPayload,
  validateGemmaCoreContextContract,
  validateGemmaMaintenanceContract,
  validateGemmaMaintenanceResultContract,
  validateReviewDecisionsContract,
  validateReviewQueueContract,
} from '../src/contracts.js';
import { createCoreRepository } from '../src/repository.js';
import { openCoreDatabase, closeCoreDatabase } from '../src/db.js';
import { buildGemmaCoreContext } from '../src/gemma-context.js';
import {
  buildCompiledIdentitySummary,
  buildContinuationTimeline,
  searchPersonContext,
} from '../src/identity-context.js';
import {
  importExecutionReviewBundle,
  importFormPayload,
  importGemmaMaintenanceBatch,
  importReviewDecisionBatch,
  importWebVaultState,
} from '../src/importers.js';
import { buildPendingReviewQueue } from '../src/review-queue.js';
import { renderPendingReviewQueue, renderPersonDossier } from '../src/renderers.js';
import { syncWebToCore } from '../scripts/sync-web-to-core.js';

function withRepository() {
  const db = openCoreDatabase({ filePath: ':memory:' });
  const repository = createCoreRepository(db);
  repository.registerDefaultClaimTypes();
  return {
    repository,
    close() {
      closeCoreDatabase(db);
    },
  };
}

test('repository creates stable claims, evidence, and grants', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    const claim = repository.createClaim({
      personId: person.id,
      claimTypeKey: 'passport.number',
      value: 'TEST00001',
      status: 'confirmed',
      issuer: 'manual-entry',
    });
    const evidence = repository.createEvidence({
      personId: person.id,
      kind: 'passport_scan',
      storageUri: 'vault://demo/passport',
      mimeType: 'application/json',
      sourceSystem: 'test',
      sourceName: 'passport',
    });
    repository.linkClaimEvidence({
      claimId: claim.id,
      evidenceId: evidence.id,
      relationType: 'confirmed_by',
      note: 'Matches scanned passport.',
    });
    const requester = repository.createRequester({
      name: 'Mio Extension',
      origin: 'browser-extension',
      publicKeyOrIdentifier: 'mio.browser-extension',
    });
    const grant = repository.createGrant({
      personId: person.id,
      requesterId: requester.id,
      purpose: 'PROFILE-DEMO autofill',
      status: 'active',
      scope: { allowedFields: ['passport.number'] },
      actions: ['read-granted-fields'],
    });
    repository.attachGrantClaim({
      grantId: grant.id,
      claimId: claim.id,
      accessMode: 'verify_only',
    });

    assert.equal(repository.listClaimsForPerson(person.id).length, 1);
    assert.equal(repository.listEvidenceForPerson(person.id).length, 1);
    assert.equal(repository.listGrantsForPerson(person.id).length, 1);
    assert.equal(repository.listGrantClaims(grant.id).length, 1);
  } finally {
    close();
  }
});

test('repository persists identity wiki entries and audit events separately from canonical claims', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    const entry = repository.createWikiEntry({
      personId: person.id,
      title: 'Preferred employer name',
      category: 'employment',
      fieldKey: 'employer',
      valueText: 'ACME Robotics',
      summaryText: 'Use ACME Robotics in profile employment sections unless a newer official HR letter supersedes it.',
      status: 'candidate',
      trustLevel: 'user_asserted',
      autofillEligible: false,
      tags: ['employment', 'profile'],
      actorType: 'user',
      actorId: 'alice.local',
    });

    const updated = repository.updateWikiEntry(entry.id, {
      status: 'verified',
      trustLevel: 'reviewed_merge',
      autofillEligible: true,
      actorType: 'user',
      actorId: 'alice.local',
    });

    const wikiEntries = repository.listWikiEntriesForPerson(person.id);
    const wikiEvents = repository.listWikiEventsForEntry(entry.id);
    const claims = repository.listClaimsForPerson(person.id);

    assert.equal(wikiEntries.length, 1);
    assert.equal(updated.status, 'verified');
    assert.equal(updated.trustLevel, 'reviewed_merge');
    assert.equal(updated.autofillEligible, true);
    assert.equal(wikiEvents.length, 2);
    assert.ok(wikiEvents.some((event) => event.action === 'created'));
    assert.ok(wikiEvents.some((event) => event.action === 'status_changed'));
    assert.equal(claims.length, 0);
  } finally {
    close();
  }
});

test('importWebVaultState fuses current vault profile, evidence, and intelligence', () => {
  const { repository, close } = withRepository();
  try {
    const person = importWebVaultState(repository, {
      vaultId: 'demo-vault',
      vaultState: {
        profile: {
          lastName: 'Zhang',
          firstName: 'Alice',
          middleName: '',
          passportNo: 'TEST00001',
          nationality: 'CHN',
          dateOfBirth: '1990-01-02',
          birthYear: '',
          birthMonth: '',
          birthDay: '',
          gender: '',
          placeOfBirth: '',
          birthCity: '',
          birthStateProvince: '',
          birthCountry: '',
          passportIssuingCountry: '',
          passportIssuingPost: '',
          issueDate: '',
          expiryDate: '',
          phone: '',
          email: '',
          homeAddress: '',
          employer: '',
          jobTitle: '',
          employerEmail: '',
          employerAddress: '',
          inviterName: '',
          inviterOrganization: '',
          inviterContactName: '',
          inviterAddress: '',
          inviterEmail: '',
          inviterPhone: '',
          maritalStatus: '',
          emergencyContact: '',
          visaHistory: '',
        },
        documents: {
          passportScan: {
            id: 'doc-passport',
            kind: 'passport',
            sourceName: 'Passport PDF',
            sourceType: 'pdf',
            fileHash: 'hash-passport',
            recognizedAt: '2026-04-07T00:00:00.000Z',
            localeHint: 'en',
            recognizedText: 'passport text',
            payload: {
              kind: 'passport',
              fields: {
                passportNo: 'TEST00001',
                nationality: 'CHN',
                dateOfBirth: '1990-01-02',
              },
              confidence: 'high',
            },
          },
          supportingDocuments: [
            {
              id: 'doc-invitation',
              kind: 'invitation',
              sourceName: 'Invitation Letter',
              sourceType: 'pdf',
              fileHash: 'hash-invitation',
              recognizedAt: '2026-04-07T00:10:00.000Z',
              localeHint: 'en',
              recognizedText: 'invite text',
              payload: {
                kind: 'invitation',
                confidence: 'medium',
              },
            },
          ],
        },
        identityIntelligence: {
          evidenceRecords: [
            {
              evidenceId: 'evidence-passport',
              documentId: 'doc-passport',
              documentKind: 'passport',
              sourceName: 'Passport PDF',
              recognizedAt: '2026-04-07T00:00:00.000Z',
              fieldValues: [
                {
                  field: 'passportNo',
                  value: 'TEST00001',
                  confidence: 'high',
                  rationale: 'MRZ matched',
                  extractor: 'passport-mrz-first',
                },
              ],
            },
          ],
          proposals: [{ proposalId: 'p1' }],
          conflicts: [{ conflictId: 'c1' }],
        },
        localWiki: {
          schemaVersion: 'mio.local-wiki.v1',
          lastMaintainedAt: '2026-04-07T00:30:00.000Z',
          entries: [
            {
              id: 'wiki-local-1',
              title: 'Preferred employer wording',
              field: 'employer',
              valueText: 'ACME Robotics',
              summaryText: 'Use ACME Robotics consistently across profile employment sections.',
              rationale: 'Recent employer letter and invitation packet use the same wording.',
              status: 'candidate',
              trustLevel: 'official_doc',
              autofillEligible: true,
              sourceDocumentIds: ['doc-invitation'],
              supportingEvidenceIds: ['evidence-passport'],
              sourceProposalId: 'proposal-employer-1',
              sourceKind: 'manual',
              createdAt: '2026-04-07T00:20:00.000Z',
              updatedAt: '2026-04-07T00:30:00.000Z',
            },
          ],
        },
        audit: {
          createdAt: '2026-04-07T00:00:00.000Z',
          lastUpdatedAt: '2026-04-07T01:00:00.000Z',
        },
      },
    });

    const claims = repository.listClaimsForPerson(person.id);
    const evidence = repository.listEvidenceForPerson(person.id);
    const memory = repository.listMemoryItemsForPerson(person.id);
    const timeline = repository.listTimelineEntries(person.id);
    const audit = repository.listAuditEventsForPerson(person.id);
    const wikiEntries = repository.listWikiEntriesForPerson(person.id);

    assert.equal(person.displayName, 'Alice Zhang');
    assert.ok(claims.some((claim) => claim.claimTypeKey === 'passport.number' && claim.status === 'confirmed'));
    assert.ok(claims.some((claim) => claim.claimTypeKey === 'passport.number' && claim.status === 'extracted'));
    assert.equal(evidence.length, 2);
    assert.equal(memory.length, 1);
    assert.ok(memory.some((item) => item.kind === 'evidence_note' && item.fieldKey === 'passportNo'));
    assert.equal(wikiEntries.length, 1);
    assert.equal(wikiEntries[0].fieldKey, 'employer');
    assert.equal(wikiEntries[0].sourceKind, 'mio_web_local_wiki');
    assert.equal(wikiEntries[0].autofillEligible, true);
    assert.equal(timeline.length, 1);
    assert.equal(audit.length, 1);
  } finally {
    close();
  }
});

test('importFormPayload links current grant model into mio-core and renders dossier', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    repository.createClaim({
      personId: person.id,
      claimTypeKey: 'person.name.first',
      value: 'Alice',
      status: 'confirmed',
      issuer: 'manual-entry',
    });
    repository.createClaim({
      personId: person.id,
      claimTypeKey: 'passport.number',
      value: 'TEST00001',
      status: 'confirmed',
      issuer: 'manual-entry',
    });

    const { grant } = importFormPayload(repository, {
      personId: person.id,
      formPayload: {
        generatedAt: '2026-04-07T02:00:00.000Z',
        templateId: 'example-personal-profile',
        countryCode: 'US',
        formType: 'PROFILE-DEMO',
        allowedFields: ['firstName', 'passportNo'],
        serviceRequest: {
          requestId: 'request-1',
          rationale: 'Prepare a PROFILE-DEMO objective autofill packet.',
          service: {
            id: 'example-personal-profile',
            name: 'Example Profile Form',
          },
        },
        grant: {
          grantId: 'grant-1',
          issuedAt: '2026-04-07T02:00:00.000Z',
          expiresAt: '2026-04-07T02:30:00.000Z',
          grantee: {
            id: 'mio.browser-extension',
            label: 'Mio Browser Extension',
          },
          service: {
            id: 'example-personal-profile',
            countryCode: 'US',
            formType: 'PROFILE-DEMO',
          },
          scope: {
            allowedFields: ['firstName', 'passportNo'],
            requestedFields: ['firstName', 'passportNo'],
            manualSections: [],
          },
          actions: ['detect-page', 'read-granted-fields', 'fill-approved-fields'],
          policy: {
            allowAutofill: true,
            requireManualReview: true,
          },
        },
      },
    });

    const grantClaims = repository.listGrantClaims(grant.id);
    const markdown = renderPersonDossier(repository, person.id);

    assert.equal(grantClaims.length, 2);
    assert.match(markdown, /Identity Dossier: Alice Zhang/);
    assert.match(markdown, /Active Grants/);
    assert.match(markdown, /PROFILE-DEMO/);
  } finally {
    close();
  }
});

test('importExecutionReviewBundle captures pending review queue and decisions', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    repository.createClaim({
      personId: person.id,
      claimTypeKey: 'passport.number',
      value: 'TEST00001',
      status: 'confirmed',
      issuer: 'manual-entry',
    });

    const { bundle, items, reusedExisting } = importExecutionReviewBundle(repository, {
      personId: person.id,
      reviewBundle: {
        schemaVersion: 'mio.review.bundle.v1',
        reviewBundleId: 'review-bundle-1',
        createdAt: '2026-04-07T03:00:00.000Z',
        source: {
          producer: 'mio-autofill-extension',
          pageStage: 'passport',
          pageStageLabel: 'Passport Information',
        },
        summary: {
          requestedFieldCount: 2,
          injectedFieldCount: 2,
          proposalCount: 1,
          observationCount: 1,
        },
        requestedFields: ['passportNo', 'arrivalDate'],
        injectedFields: ['passportNo', 'arrivalDate'],
        pageProfile: {
          passportNo: 'TEST00001',
        },
        tripRecord: {
          arrivalDate: '2026-05-10',
        },
        observations: [
          {
            observationId: 'obs:passportNo:20260407030000',
            field: 'passportNo',
            nextValue: 'TEST00001',
            previousValue: '',
            sourceValue: 'TEST00001',
            observedAt: '2026-04-07T03:00:00.000Z',
          },
        ],
        proposals: [
          {
            proposalId: 'proposal:arrivalDate:20260407030000',
            field: 'arrivalDate',
            target: 'service-context',
            value: '2026-05-10',
            derivedFrom: ['departureDate'],
            rationale: 'Travel context should be reviewed before merge.',
            proposedAt: '2026-04-07T03:00:01.000Z',
          },
        ],
      },
    });

    assert.equal(reusedExisting, false);
    assert.equal(bundle.status, 'pending');
    assert.equal(items.length, 3);

    const pendingItems = repository.listPendingReviewItemsForPerson(person.id);
    const memory = repository.listMemoryItemsForPerson(person.id);
    assert.equal(pendingItems.length, 3);
    assert.ok(pendingItems.some((item) => item.fieldKey === 'passportNo' && item.target === 'identity_claim'));
    assert.ok(pendingItems.some((item) => item.fieldKey === 'arrivalDate' && item.target === 'service_context'));
    assert.ok(pendingItems.some((item) => item.fieldKey === 'arrivalDate' && item.target === 'trip_context'));
    assert.equal(memory.length, 3);
    assert.ok(memory.some((item) => item.kind === 'execution_note' && item.fieldKey === 'passportNo'));
    assert.ok(memory.some((item) => item.kind === 'review_rationale' && item.fieldKey === 'arrivalDate'));

    const queueMarkdown = renderPendingReviewQueue(repository, person.id);
    assert.match(queueMarkdown, /Pending Review Queue: Alice Zhang/);
    assert.match(queueMarkdown, /Passport Information/);
    assert.match(queueMarkdown, /arrivalDate/);
    assert.match(queueMarkdown, /why:/);

    const arrivalProposal = pendingItems.find((item) => item.target === 'service_context');
    const decision = repository.recordReviewDecision({
      reviewItemId: arrivalProposal.id,
      decision: 'dismissed',
      actorType: 'user',
      actorId: 'alice.local',
      note: 'Keep travel context local for now.',
    });

    assert.equal(decision.item.status, 'dismissed');
    assert.equal(repository.listReviewDecisionsForItem(arrivalProposal.id).length, 1);
    assert.equal(repository.listPendingReviewItemsForPerson(person.id).length, 2);
    assert.equal(repository.getReviewBundle(bundle.id).status, 'partially_applied');
  } finally {
    close();
  }
});

test('buildGemmaCoreContext exports stable summary, evidence, and pending review proposals', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    repository.createClaim({
      personId: person.id,
      claimTypeKey: 'person.name.first',
      value: 'Alice',
      status: 'confirmed',
      issuer: 'manual-entry',
    });
    const extractedClaim = repository.createClaim({
      personId: person.id,
      claimTypeKey: 'passport.number',
      value: 'TEST00001',
      status: 'extracted',
      confidence: 0.95,
      issuer: 'passport-mrz-first',
    });
    const evidence = repository.createEvidence({
      personId: person.id,
      kind: 'passport_scan',
      storageUri: 'vault://demo/passport',
      mimeType: 'application/json',
      sourceSystem: 'mio-web.document-vault',
      sourceName: 'Passport PDF',
      metadata: {
        documentId: 'doc-passport',
      },
    });
    repository.linkClaimEvidence({
      claimId: extractedClaim.id,
      evidenceId: evidence.id,
      relationType: 'extracted_from',
      note: 'MRZ matched.',
    });
    repository.createWikiEntry({
      personId: person.id,
      title: 'Passport issue note',
      category: 'document',
      fieldKey: 'passportNo',
      valueText: 'TEST00001',
      summaryText: 'Passport number confirmed from the latest MRZ scan and kept in the identity wiki for future autofill review.',
      status: 'verified',
      trustLevel: 'mrz',
      autofillEligible: true,
      supportingEvidenceIds: [evidence.id],
      sourceDocumentIds: ['doc-passport'],
      actorType: 'system',
      actorId: 'test-seed',
    });

    const { bundle } = importExecutionReviewBundle(repository, {
      personId: person.id,
      reviewBundle: {
        schemaVersion: 'mio.review.bundle.v1',
        reviewBundleId: 'review-bundle-2',
        createdAt: '2026-04-07T04:00:00.000Z',
        source: {
          producer: 'mio-autofill-extension',
          pageStage: 'passport',
          pageStageLabel: 'Passport Information',
        },
        summary: {},
        requestedFields: ['passportNo'],
        injectedFields: ['passportNo'],
        pageProfile: {
          passportNo: 'TEST00001',
        },
        observations: [],
        proposals: [],
      },
    });

    const context = buildGemmaCoreContext(repository, person.id);
    const validation = validateGemmaCoreContextContract(context);

    assert.equal(context.schemaVersion, 'mio.gemma.core-context.v1');
    assert.equal(context.person.displayName, 'Alice Zhang');
    assert.equal(context.profileSummary.firstName, 'Alice');
    assert.ok(context.knowledgeCards.some((card) => card.id === 'identity-wiki'));
    assert.ok(context.knowledgeCards.some((card) => card.id === 'review-queue'));
    assert.ok(context.knowledgeCards.some((card) => card.id === 'memory-sidecar'));
    assert.ok(context.evidence.some((item) => item.kind === 'passport_scan'));
    assert.ok(Array.isArray(context.wikiEntries));
    assert.ok(context.wikiEntries.some((entry) => entry.fieldKey === 'passportNo' && entry.trustLevel === 'mrz'));
    assert.ok(context.proposals.some((proposal) => proposal.field === 'passportNo'));
    assert.ok(context.pendingReview.some((item) => item.bundleId === bundle.id));
    assert.ok(Array.isArray(context.memory));
    assert.ok(context.memory.some((item) => item.field === 'passportNo'));
    assert.equal(context.compiledIdentity.pendingReviewCount, context.pendingReview.length);
    assert.ok(Array.isArray(context.timeline));
    assert.ok(context.timeline.some((item) => item.eventType === 'wiki_event' || item.eventType === 'review_decision' || item.eventType === 'grant' || item.eventType === 'timeline_entry'));
    assert.ok(context.proposals.some((proposal) => proposal.field === 'passportNo' && proposal.relatedMemory.length > 0));
    assert.ok(context.pendingReview.some((item) => item.field === 'passportNo' && item.relatedMemory.length > 0));
    assert.equal(validation.ok, true);
  } finally {
    close();
  }
});

test('buildPendingReviewQueue exports pending bundles and passes contract validation', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    const createdAt = '2026-04-07T05:00:00.000Z';

    const { bundle } = importExecutionReviewBundle(repository, {
      personId: person.id,
      reviewBundle: {
        schemaVersion: 'mio.review.bundle.v1',
        reviewBundleId: 'review-bundle-queue-1',
        createdAt,
        source: {
          producer: 'mio-autofill-extension',
          pageStage: 'travel',
          pageStageLabel: 'Travel Information',
        },
        summary: {
          injectedFieldCount: 1,
        },
        requestedFields: ['arrivalDate'],
        injectedFields: ['arrivalDate'],
        pageProfile: {
          arrivalDate: '2026-05-10',
        },
        tripRecord: {
          arrivalDate: '2026-05-10',
        },
        observations: [],
        proposals: [],
      },
    });

    const queue = buildPendingReviewQueue(repository, person.id, {
      generatedAt: '2026-04-07T05:01:00.000Z',
    });
    const validation = validateReviewQueueContract(queue);

    assert.equal(queue.schemaVersion, 'mio.review.queue.v1');
    assert.equal(queue.person.id, person.id);
    assert.equal(queue.bundles.length, 1);
    assert.equal(queue.bundles[0].bundleId, bundle.id);
    assert.ok(queue.bundles[0].items.every((item) => item.status === 'pending'));
    assert.ok(queue.bundles[0].items.every((item) => Array.isArray(item.relatedMemory)));
    assert.ok(queue.bundles[0].items.some((item) => item.field === 'arrivalDate' && item.relatedMemory.length > 0));
    assert.equal(validation.ok, true);
  } finally {
    close();
  }
});

test('compiled identity summary and continuation timeline expose resumable state', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    repository.createClaim({
      personId: person.id,
      claimTypeKey: 'person.name.first',
      value: 'Alice',
      status: 'confirmed',
      issuer: 'manual-entry',
    });
    repository.createClaim({
      personId: person.id,
      claimTypeKey: 'passport.number',
      value: 'TEST00001',
      status: 'confirmed',
      issuer: 'manual-entry',
    });
    repository.createWikiEntry({
      personId: person.id,
      title: 'Employer wording',
      category: 'employment',
      fieldKey: 'employer',
      summaryText: 'Prefer ACME Robotics until a new HR letter lands.',
      status: 'candidate',
      trustLevel: 'user_asserted',
      actorType: 'user',
      actorId: 'seed.local',
    });
    const requester = repository.createRequester({
      name: 'Mio Extension',
      origin: 'browser-extension',
      publicKeyOrIdentifier: 'mio.browser-extension',
    });
    repository.createGrant({
      personId: person.id,
      requesterId: requester.id,
      purpose: 'Resume profile packet',
      status: 'active',
      scope: { allowedFields: ['passport.number'] },
      actions: ['read-granted-fields'],
      grantedAt: '2026-04-07T09:00:00.000Z',
      createdAt: '2026-04-07T09:00:00.000Z',
    });
    const { items } = importExecutionReviewBundle(repository, {
      personId: person.id,
      reviewBundle: {
        schemaVersion: 'mio.review.bundle.v1',
        reviewBundleId: 'review-bundle-summary-1',
        createdAt: '2026-04-07T10:00:00.000Z',
        source: {
          producer: 'mio-autofill-extension',
          pageStage: 'passport',
          pageStageLabel: 'Passport Information',
        },
        summary: {},
        requestedFields: ['passportNo'],
        injectedFields: ['passportNo'],
        pageProfile: {
          passportNo: 'TEST00001',
        },
        observations: [],
        proposals: [],
      },
    });
    repository.recordReviewDecision({
      reviewItemId: items[0].id,
      decision: 'accepted',
      actorType: 'user',
      actorId: 'alice.local',
      note: 'Passport number confirmed.',
      createdAt: '2026-04-07T10:05:00.000Z',
    });
    repository.createTimelineEntry({
      personId: person.id,
      eventDate: '2026-04-07T10:10:00.000Z',
      summary: 'Imported refreshed passport packet',
      detailMd: 'Passport packet refreshed after manual verification.',
      source: 'mio-web',
      createdAt: '2026-04-07T10:10:00.000Z',
    });

    const compiled = buildCompiledIdentitySummary(repository, person.id, {
      generatedAt: '2026-04-07T10:20:00.000Z',
    });
    const timeline = buildContinuationTimeline(repository, person.id, { limit: 10 });

    assert.match(compiled.summaryText, /stable identity fields/i);
    assert.equal(compiled.activeGrantCount, 1);
    assert.ok(compiled.attentionFields.includes('employer'));
    assert.ok(timeline.some((item) => item.eventType === 'review_decision'));
    assert.ok(timeline.some((item) => item.eventType === 'wiki_event'));
    assert.ok(timeline.some((item) => item.eventType === 'grant'));
    assert.ok(timeline.some((item) => item.eventType === 'timeline_entry'));
  } finally {
    close();
  }
});

test('searchPersonContext supports exact, keyword, and semantic retrieval', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    repository.createClaim({
      personId: person.id,
      claimTypeKey: 'passport.number',
      value: 'TEST00001',
      status: 'confirmed',
      issuer: 'manual-entry',
    });
    repository.createWikiEntry({
      personId: person.id,
      title: 'Employer wording',
      category: 'employment',
      fieldKey: 'employer',
      summaryText: 'Use ACME Robotics consistently in work and employment sections.',
      status: 'verified',
      trustLevel: 'reviewed_merge',
      actorType: 'user',
      actorId: 'seed.local',
    });
    repository.createTimelineEntry({
      personId: person.id,
      eventDate: '2026-04-07T11:00:00.000Z',
      summary: 'Employment evidence refreshed',
      detailMd: 'An updated HR letter confirms ACME Robotics as the current employer.',
      source: 'mio-web',
      createdAt: '2026-04-07T11:00:00.000Z',
    });

    const exact = searchPersonContext(repository, person.id, {
      mode: 'exact',
      fieldKey: 'passportNo',
      limit: 5,
    });
    const keyword = searchPersonContext(repository, person.id, {
      mode: 'keyword',
      query: 'ACME Robotics employment',
      limit: 5,
    });
    const semantic = searchPersonContext(repository, person.id, {
      mode: 'semantic',
      query: 'work company',
      limit: 5,
    });

    assert.ok(exact.results.some((item) => item.fieldKey === 'passportNo'));
    assert.ok(keyword.results.some((item) => item.excerpt.includes('ACME Robotics')));
    assert.ok(semantic.results.some((item) => item.fieldKey === 'employer'));
    assert.equal(exact.mode, 'exact');
    assert.equal(keyword.mode, 'keyword');
    assert.equal(semantic.mode, 'semantic');
  } finally {
    close();
  }
});

test('renderPersonDossier includes identity wiki summary when entries exist', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    repository.createWikiEntry({
      personId: person.id,
      title: 'Inviter relationship',
      category: 'relationship',
      fieldKey: 'inviterName',
      summaryText: 'Host is a long-term business partner and should remain review-only until invitation letters are refreshed.',
      status: 'candidate',
      trustLevel: 'model_inferred',
      actorType: 'system',
      actorId: 'test-seed',
    });

    const markdown = renderPersonDossier(repository, person.id);
    assert.match(markdown, /Compiled Identity Summary/);
    assert.match(markdown, /Identity Wiki/);
    assert.match(markdown, /Inviter relationship/);
  } finally {
    close();
  }
});

test('validateContractPayload reports contract mismatch details', () => {
  const invalid = {
    schemaVersion: 'mio.gemma.core-context.v1',
    generatedAt: 'not-a-time',
  };
  const validation = validateContractPayload('gemma-core-context', invalid);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.path === '$.generatedAt'));

  const unknown = validateContractPayload('unknown-contract', {});
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some((error) => error.path === '$.contract'));
});

test('syncWebToCore runs full sync and decisions import with output artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-core-sync-'));
  const dbPath = path.join(tempDir, 'mio-core.sqlite');
  const vaultFile = path.join(tempDir, 'mio-web-vault.json');
  const payloadFile = path.join(tempDir, 'mio-form-payload.json');
  const reviewQueueOutput = path.join(tempDir, 'mio-review-queue.json');
  const gemmaContextOutput = path.join(tempDir, 'mio-gemma-context.json');
  const fullSummaryOutput = path.join(tempDir, 'mio-core-sync-summary.json');
  const decisionsFile = path.join(tempDir, 'mio-review-decisions.json');
  const decisionsResultOutput = path.join(tempDir, 'mio-review-decisions-result.json');
  const decisionsSummaryOutput = path.join(tempDir, 'mio-review-sync-summary.json');

  try {
    fs.writeFileSync(
      vaultFile,
      JSON.stringify(
        {
          schemaVersion: 'mio.v1',
          profile: {
            lastName: 'Zhang',
            firstName: 'Alice',
            middleName: '',
            passportNo: 'TEST00001',
            nationality: 'CHN',
            dateOfBirth: '1990-01-02',
            birthYear: '',
            birthMonth: '',
            birthDay: '',
            gender: '',
            placeOfBirth: '',
            birthCity: '',
            birthStateProvince: '',
            birthCountry: '',
            passportIssuingCountry: '',
            passportIssuingPost: '',
            issueDate: '',
            expiryDate: '',
            phone: '',
            email: '',
            homeAddress: '',
            employer: '',
            jobTitle: '',
            employerEmail: '',
            employerAddress: '',
            inviterName: '',
            inviterOrganization: '',
            inviterContactName: '',
            inviterAddress: '',
            inviterEmail: '',
            inviterPhone: '',
            maritalStatus: '',
            emergencyContact: '',
            visaHistory: '',
          },
          documents: {
            passportScan: null,
            supportingDocuments: [],
            tripContext: null,
          },
          identityIntelligence: {
            schemaVersion: 'mio.identity-intelligence.v1',
            lastCompiledAt: '2026-04-07T00:00:00.000Z',
            evidenceRecords: [],
            proposals: [],
            conflicts: [],
            coverage: {
              totalProfileFields: 32,
              fieldsWithEvidence: 0,
              alignedFields: 0,
              pendingProposalCount: 0,
              conflictCount: 0,
              evidenceDocumentCount: 0,
            },
          },
          preferences: {
            autoLockMinutes: 10,
            preferredTemplateId: 'example-personal-profile',
            sessionWarningEnabled: true,
            locale: 'en',
          },
          audit: {
            createdAt: '2026-04-07T00:00:00.000Z',
            lastUpdatedAt: '2026-04-07T00:00:00.000Z',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    fs.writeFileSync(
      payloadFile,
      JSON.stringify(
        {
          schemaVersion: 'mio.form-payload.v1',
          generatedAt: '2026-04-07T02:00:00.000Z',
          templateId: 'example-personal-profile',
          countryCode: 'US',
          formType: 'PROFILE-DEMO',
          requestedObjectiveFields: ['firstName', 'passportNo'],
          grantedObjectiveFields: ['firstName', 'passportNo'],
          allowedFields: ['firstName', 'passportNo'],
          missingRequiredFields: [],
          payload: {
            firstName: 'Alice',
            passportNo: 'TEST00001',
          },
          serviceRequest: {
            requestId: 'request-1',
            requestedAt: '2026-04-07T02:00:00.000Z',
            rationale: 'Prepare a PROFILE-DEMO objective autofill packet.',
            service: {
              id: 'example-personal-profile',
              name: 'Example Profile Form',
              countryCode: 'US',
              formType: 'PROFILE-DEMO',
              channels: ['browser-extension'],
            },
            fields: [
              {
                field: 'firstName',
                required: true,
                source: 'objective-autofill',
                reason: 'Objective autofill only.',
              },
              {
                field: 'passportNo',
                required: true,
                source: 'objective-autofill',
                reason: 'Objective autofill only.',
              },
            ],
          },
          grant: {
            grantId: 'grant-1',
            issuedAt: '2026-04-07T02:00:00.000Z',
            expiresAt: '2026-04-07T02:30:00.000Z',
            grantee: {
              id: 'mio.browser-extension',
              label: 'Mio Browser Extension',
            },
            service: {
              id: 'example-personal-profile',
              countryCode: 'US',
              formType: 'PROFILE-DEMO',
            },
            scope: {
              allowedFields: ['firstName', 'passportNo'],
              requestedFields: ['firstName', 'passportNo'],
              manualSections: [],
            },
            actions: ['detect-page', 'read-granted-fields', 'fill-approved-fields'],
            policy: {
              allowAutofill: true,
              requireManualReview: true,
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const fullSummary = syncWebToCore({
      dbPath,
      vaultFile,
      payloadFile,
      vaultId: 'demo-vault',
      reviewQueueOutput,
      gemmaContextOutput,
      summaryOutput: fullSummaryOutput,
      validate: true,
    });

    assert.equal(fullSummary.person?.displayName, 'Alice Zhang');
    assert.equal(fullSummary.outputs.reviewQueue, reviewQueueOutput);
    assert.equal(fullSummary.outputs.gemmaContext, gemmaContextOutput);
    assert.ok(fs.existsSync(reviewQueueOutput));
    assert.ok(fs.existsSync(gemmaContextOutput));
    assert.ok(fs.existsSync(fullSummaryOutput));

    const db = openCoreDatabase({ filePath: dbPath });
    const repository = createCoreRepository(db);
    repository.registerDefaultClaimTypes();

    try {
      const { bundle, items } = importExecutionReviewBundle(repository, {
        personId: fullSummary.person.id,
        reviewBundle: {
          schemaVersion: 'mio.review.bundle.v1',
          reviewBundleId: 'review-bundle-sync-1',
          createdAt: '2026-04-07T03:00:00.000Z',
          source: {
            producer: 'mio-autofill-extension',
            pageStage: 'passport',
            pageStageLabel: 'Passport Information',
          },
          summary: {
            injectedFieldCount: 1,
          },
          requestedFields: ['passportNo'],
          injectedFields: ['passportNo'],
          pageProfile: {
            passportNo: 'TEST00001',
          },
          observations: [],
          proposals: [],
        },
      });

      fs.writeFileSync(
        decisionsFile,
        JSON.stringify(
          {
            schemaVersion: 'mio.review.decisions.v1',
            generatedAt: '2026-04-07T04:00:00.000Z',
            person: {
              id: fullSummary.person.id,
            },
            source: {
              producer: 'mio-web',
            },
            decisions: [
              {
                decisionId: 'web-decision-1',
                reviewItemId: items[0].id,
                bundleId: bundle.id,
                decision: 'accepted',
                actorType: 'user',
                actorId: 'alice.web',
                createdAt: '2026-04-07T04:00:01.000Z',
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );
    } finally {
      closeCoreDatabase(db);
    }

    const decisionSummary = syncWebToCore({
      dbPath,
      personId: fullSummary.person.id,
      decisionsFile,
      decisionsResultOutput,
      summaryOutput: decisionsSummaryOutput,
      validate: true,
    });

    assert.equal(decisionSummary.decisions?.appliedCount, 1);
    assert.equal(decisionSummary.outputs.decisionsResult, decisionsResultOutput);
    assert.ok(fs.existsSync(decisionsResultOutput));
    assert.ok(fs.existsSync(decisionsSummaryOutput));

    const receipt = JSON.parse(fs.readFileSync(decisionsResultOutput, 'utf8'));
    assert.equal(receipt.schemaVersion, 'mio.review.decisions.result.v1');
    assert.equal(receipt.appliedCount, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('importReviewDecisionBatch applies pending decisions idempotently', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    const { bundle, items } = importExecutionReviewBundle(repository, {
      personId: person.id,
      reviewBundle: {
        schemaVersion: 'mio.review.bundle.v1',
        reviewBundleId: 'review-bundle-decision-1',
        createdAt: '2026-04-07T06:00:00.000Z',
        source: {
          producer: 'mio-autofill-extension',
          pageStage: 'passport',
          pageStageLabel: 'Passport Information',
        },
        summary: {},
        requestedFields: ['passportNo', 'arrivalDate'],
        injectedFields: ['passportNo', 'arrivalDate'],
        pageProfile: {
          passportNo: 'TEST00001',
        },
        tripRecord: {
          arrivalDate: '2026-05-10',
        },
        observations: [],
        proposals: [],
      },
    });

    const identityItem = items.find((item) => item.target === 'identity_claim');
    const tripItem = items.find((item) => item.target === 'trip_context');
    assert.ok(identityItem);
    assert.ok(tripItem);

    const batch = {
      schemaVersion: 'mio.review.decisions.v1',
      generatedAt: '2026-04-07T06:05:00.000Z',
      batchId: 'ios-sync-batch-1',
      person: {
        id: person.id,
        displayName: person.displayName,
      },
      source: {
        producer: 'mio-ios-demo',
      },
      decisions: [
        {
          decisionId: 'decision-identity-1',
          reviewItemId: identityItem.id,
          bundleId: bundle.id,
          decision: 'accepted',
          actorType: 'user',
          actorId: 'ios.local.user',
          createdAt: '2026-04-07T06:05:01.000Z',
        },
        {
          decisionId: 'decision-trip-1',
          reviewItemId: tripItem.id,
          bundleId: bundle.id,
          decision: 'dismissed',
          actorType: 'user',
          actorId: 'ios.local.user',
          note: 'Trip context remains manual.',
          createdAt: '2026-04-07T06:05:02.000Z',
        },
      ],
    };

    const validation = validateReviewDecisionsContract(batch);
    assert.equal(validation.ok, true);

    const firstImport = importReviewDecisionBatch(repository, {
      personId: person.id,
      decisionBatch: batch,
    });
    assert.equal(firstImport.applied.length, 2);
    assert.equal(firstImport.skipped.length, 0);
    assert.equal(repository.getReviewBundle(bundle.id).status, 'partially_applied');
    assert.equal(repository.getReviewItem(identityItem.id).status, 'applied');
    assert.equal(repository.getReviewItem(tripItem.id).status, 'dismissed');
    const reviewDecisionMemory = repository
      .listMemoryItemsForPerson(person.id)
      .filter((item) => item.kind === 'review_rationale' && item.sourceKind === 'review_decision');
    assert.equal(reviewDecisionMemory.length, 2);

    const secondImport = importReviewDecisionBatch(repository, {
      personId: person.id,
      decisionBatch: batch,
    });
    assert.equal(secondImport.applied.length, 0);
    assert.equal(secondImport.skipped.length, 2);
    assert.ok(secondImport.skipped.every((item) => item.reason === 'already_imported'));
  } finally {
    close();
  }
});

test('importGemmaMaintenanceBatch only writes wiki or review queue and stays idempotent', () => {
  const { repository, close } = withRepository();
  try {
    const person = repository.createPerson({ displayName: 'Alice Zhang' });
    const existingWikiEntry = repository.createWikiEntry({
      personId: person.id,
      title: 'Old inviter relationship',
      category: 'relationship',
      fieldKey: 'inviterName',
      summaryText: 'Legacy inviter note pending refresh.',
      status: 'candidate',
      trustLevel: 'user_asserted',
      actorType: 'user',
      actorId: 'seed.local',
    });

    const batch = {
      schemaVersion: 'mio.gemma.maintenance.v1',
      generatedAt: '2026-04-08T01:00:00.000Z',
      batchId: 'gemma-maintenance-batch-1',
      person: {
        id: person.id,
        displayName: person.displayName,
      },
      source: {
        producer: 'mio-ios-demo',
        model: 'example-local-model',
        mode: 'remote',
        endpointLabel: 'local-mac-bridge',
      },
      actions: [
        {
          actionId: 'wiki-action-1',
          actionType: 'upsert_wiki_entry',
          title: 'Preferred employer wording',
          category: 'employment',
          fieldKey: 'employer',
          summaryText: 'Prefer ACME Robotics in profile employment forms until the next HR letter arrives.',
          rationale: 'Recent files consistently reference ACME Robotics.',
          confidence: 'medium',
          riskLevel: 'low',
          sourceDocumentIds: ['doc-employer-letter'],
          supportingEvidenceIds: ['evidence-employer-letter'],
          tags: ['employment', 'profile'],
        },
        {
          actionId: 'wiki-action-2',
          actionType: 'mark_wiki_entry_stale',
          entryId: existingWikiEntry.id,
          rationale: 'Invitation relationship changed after the latest trip planning update.',
          confidence: 'medium',
          riskLevel: 'medium',
        },
        {
          actionId: 'review-action-1',
          actionType: 'create_review_item',
          fieldKey: 'passportNo',
          suggestedValue: 'TEST00001',
          target: 'identity_claim',
          rationale: 'Passport evidence suggests a missing passport number should be reviewed before merge.',
          confidence: 'high',
          riskLevel: 'high',
          sourceDocumentIds: ['doc-passport'],
          supportingEvidenceIds: ['evidence-passport'],
        },
      ],
    };

    const validation = validateGemmaMaintenanceContract(batch);
    assert.equal(validation.ok, true);

    const firstImport = importGemmaMaintenanceBatch(repository, {
      personId: person.id,
      maintenanceBatch: batch,
    });
    const resultValidation = validateGemmaMaintenanceResultContract(firstImport);

    assert.equal(resultValidation.ok, true);
    assert.equal(firstImport.appliedCount, 3);
    assert.equal(firstImport.skippedCount, 0);
    assert.ok(firstImport.reviewBundleId);

    const wikiEntries = repository.listWikiEntriesForPerson(person.id);
    const newWikiEntry = wikiEntries.find(
      (entry) =>
        entry.sourceKind === 'gemma_maintenance' &&
        entry.sourceRef === 'wiki-action-1',
    );
    const staleWikiEntry = repository.getWikiEntry(existingWikiEntry.id);
    const reviewItems = repository.listReviewItemsForBundle(firstImport.reviewBundleId);
    const memoryItems = repository.listMemoryItemsForPerson(person.id);

    assert.ok(newWikiEntry);
    assert.equal(newWikiEntry.status, 'candidate');
    assert.equal(newWikiEntry.trustLevel, 'model_inferred');
    assert.equal(newWikiEntry.autofillEligible, false);
    assert.equal(staleWikiEntry.status, 'stale');
    assert.equal(reviewItems.length, 1);
    assert.equal(reviewItems[0].fieldKey, 'passportNo');
    assert.equal(reviewItems[0].status, 'pending');
    assert.equal(reviewItems[0].target, 'identity_claim');
    assert.equal(reviewItems[0].metadata.gemmaMaintenance.actionId, 'review-action-1');
    assert.ok(
      memoryItems.some(
        (item) =>
          item.kind === 'review_rationale' &&
          item.sourceKind === 'gemma_maintenance' &&
          item.sourceRef === 'review-action-1',
      ),
    );
    assert.equal(repository.listClaimsForPerson(person.id).length, 0);

    const secondImport = importGemmaMaintenanceBatch(repository, {
      personId: person.id,
      maintenanceBatch: batch,
    });
    assert.equal(secondImport.appliedCount, 0);
    assert.equal(secondImport.skippedCount, 3);
    assert.ok(secondImport.skipped.every((item) => item.reason === 'already_imported'));
  } finally {
    close();
  }
});

test('importGemmaMaintenanceBatch cannot update wiki entries owned by another person', () => {
  const { repository, close } = withRepository();
  try {
    const sourcePerson = repository.createPerson({ displayName: 'Alice Zhang' });
    const targetPerson = repository.createPerson({ displayName: 'Bob Li' });
    const targetEntry = repository.createWikiEntry({
      personId: targetPerson.id,
      title: 'Bob employer record',
      category: 'employment',
      fieldKey: 'employer',
      valueText: 'Bob Industries',
      summaryText: 'This entry belongs to Bob.',
      status: 'verified',
      trustLevel: 'user_asserted',
      autofillEligible: true,
      actorType: 'user',
      actorId: 'seed.local',
    });

    const result = importGemmaMaintenanceBatch(repository, {
      personId: sourcePerson.id,
      maintenanceBatch: {
        schemaVersion: 'mio.gemma.maintenance.v1',
        generatedAt: '2026-04-08T02:00:00.000Z',
        batchId: 'gemma-maintenance-cross-person-1',
        person: {
          id: sourcePerson.id,
          displayName: sourcePerson.displayName,
        },
        source: {
          producer: 'mio-ios-demo',
          model: 'test-gemma',
          mode: 'local',
          endpointLabel: 'test',
        },
        actions: [
          {
            actionId: 'cross-person-upsert-1',
            actionType: 'upsert_wiki_entry',
            entryId: targetEntry.id,
            title: 'Tampered employer record',
            category: 'employment',
            fieldKey: 'employer',
            valueText: 'Attacker Industries',
            rationale: 'This update must not cross the person boundary.',
            confidence: 'high',
            riskLevel: 'high',
          },
          {
            actionId: 'cross-person-stale-1',
            actionType: 'mark_wiki_entry_stale',
            entryId: targetEntry.id,
            rationale: 'This stale action must not cross the person boundary.',
            confidence: 'high',
            riskLevel: 'high',
          },
        ],
      },
    });

    assert.equal(result.appliedCount, 0);
    assert.equal(result.skippedCount, 2);
    assert.deepEqual(
      result.skipped.map((item) => item.reason),
      ['person_mismatch', 'person_mismatch'],
    );

    const unchangedEntry = repository.getWikiEntry(targetEntry.id);
    assert.equal(unchangedEntry.personId, targetPerson.id);
    assert.equal(unchangedEntry.title, 'Bob employer record');
    assert.equal(unchangedEntry.valueText, 'Bob Industries');
    assert.equal(unchangedEntry.status, 'verified');
    assert.equal(unchangedEntry.sourceKind, '');
    assert.equal(repository.listWikiEntriesForPerson(sourcePerson.id).length, 0);
  } finally {
    close();
  }
});
