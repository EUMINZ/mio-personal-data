import { getClaimTypeKeyForField } from './claim-types.js';
import { nowIso } from './db.js';
import { extractSnippetAroundNeedle, summarizeSnippet } from './memory-sidecar.js';

const STATUS_CONFIRMED = 'confirmed';
const STATUS_EXTRACTED = 'extracted';
const REVIEW_DECISION_VALUES = new Set(['accepted', 'dismissed', 'superseded']);
const REVIEW_ACTOR_TYPES = new Set(['user', 'system', 'agent', 'requester']);
const GEMMA_MAINTENANCE_ACTION_TYPES = new Set([
  'upsert_wiki_entry',
  'mark_wiki_entry_stale',
  'create_review_item',
]);
const GEMMA_MAINTENANCE_CONFIDENCE = new Set(['low', 'medium', 'high']);
const GEMMA_MAINTENANCE_RISK_LEVELS = new Set(['low', 'medium', 'high']);
const GEMMA_MAINTENANCE_REVIEW_TARGETS = new Set([
  'identity_claim',
  'bundle_context',
  'service_context',
  'trip_context',
]);
const GEMMA_MAINTENANCE_REVIEW_ITEM_TYPES = new Set(['proposal', 'observation']);
const WIKI_STATUSES = new Set(['candidate', 'verified', 'stale']);
const WIKI_TRUST_LEVELS = new Set([
  'mrz',
  'official_doc',
  'user_asserted',
  'model_inferred',
  'reviewed_merge',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => readString(entry)).filter(Boolean)
    : [];
}

function normalizeDisplayName(profile, fallback) {
  const pieces = [profile?.firstName, profile?.lastName].filter(Boolean).map((value) => value.trim()).filter(Boolean);
  return pieces.length > 0 ? pieces.join(' ') : fallback;
}

function confidenceToScore(confidence) {
  if (confidence === 'high') return 0.95;
  if (confidence === 'medium') return 0.7;
  if (confidence === 'low') return 0.4;
  return null;
}

function normalizeGemmaMaintenanceSource(source) {
  if (!isObject(source)) return {};
  return {
    producer: readString(source.producer),
    model: readString(source.model),
    mode: readString(source.mode),
    endpointLabel: readString(source.endpointLabel),
  };
}

function makeGemmaMaintenanceActorId(source) {
  return source.model || source.producer || 'mio-core.import-gemma-maintenance';
}

function buildGemmaMaintenanceMetadata(existingMetadata, metadata, { actionId, batchId, confidence, riskLevel, source }) {
  return {
    ...(isObject(existingMetadata) ? existingMetadata : {}),
    ...(isObject(metadata) ? metadata : {}),
    gemmaMaintenance: {
      actionId,
      batchId,
      confidence,
      riskLevel,
      producer: source.producer || '',
      model: source.model || '',
      mode: source.mode || '',
      endpointLabel: source.endpointLabel || '',
    },
  };
}

function findWikiEntryByMaintenanceAction(repository, personId, actionId) {
  if (!actionId) return null;
  return (
    repository
      .listWikiEntriesForPerson(personId)
      .find(
        (entry) =>
          readString(entry.sourceKind) === 'gemma_maintenance' &&
          (readString(entry.sourceRef) === actionId ||
            readString(entry.metadata?.gemmaMaintenance?.actionId) === actionId),
      ) ?? null
  );
}

function findReviewItemByMaintenanceAction(repository, bundleId, actionId) {
  if (!actionId) return null;
  return (
    repository
      .listReviewItemsForBundle(bundleId)
      .find(
        (item) =>
          readString(item.metadata?.actionId) === actionId ||
          readString(item.metadata?.gemmaMaintenance?.actionId) === actionId,
      ) ?? null
  );
}

function getOrCreateGemmaMaintenanceReviewBundle(repository, personId, { batchId, generatedAt, source }) {
  const sourceBundleId = `gemma-maintenance:${batchId}`;
  const existing = repository.findReviewBundleBySourceBundleId(sourceBundleId);
  if (existing) {
    if (existing.personId !== personId) {
      throw new Error('Maintenance review bundle belongs to a different person.');
    }
    return existing;
  }

  return repository.createReviewBundle({
    personId,
    sourceBundleId,
    sourceSystem: 'gemma-maintenance',
    producer: source.producer || source.model || 'gemma-maintenance',
    stageKey: 'identity_maintenance',
    stageLabel: 'Gemma Identity Maintenance',
    source: {
      producer: source.producer || null,
      model: source.model || null,
      mode: source.mode || null,
      endpointLabel: source.endpointLabel || null,
    },
    summary: {
      importType: 'gemma-maintenance',
      batchId,
    },
    requestedFields: [],
    injectedFields: [],
    pageProfile: {},
    tripRecord: {},
    status: 'pending',
    createdAt: generatedAt,
    updatedAt: generatedAt,
  });
}

function buildGemmaMaintenanceTimelineDetail({ source, appliedCount, skippedCount, reviewBundleId = null }) {
  return [
    `- Applied actions: ${appliedCount}`,
    `- Skipped actions: ${skippedCount}`,
    `- Source producer: ${source.producer || 'unknown'}`,
    source.model ? `- Model: ${source.model}` : '',
    reviewBundleId ? `- Review bundle: ${reviewBundleId}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function mapDocumentKindToEvidenceKind(kind) {
  switch (kind) {
    case 'passport':
      return 'passport_scan';
    case 'flight':
      return 'travel_itinerary';
    case 'hotel':
      return 'hotel_booking';
    case 'invitation':
      return 'invitation_letter';
    default:
      return 'document';
  }
}

function mapFormFieldToAccessMode(field) {
  if (
    field.startsWith('passport.') ||
    field.startsWith('person.birth.') ||
    field.startsWith('person.name.') ||
    field.startsWith('person.nationality')
  ) {
    return 'verify_only';
  }
  return 'autofill';
}

function inferReviewTarget(field, explicitTarget = '') {
  if (explicitTarget === 'service-context') return 'service_context';
  return getClaimTypeKeyForField(field) ? 'identity_claim' : 'bundle_context';
}

function pickCurrentReviewValue(repository, personId, field) {
  const claimTypeKey = getClaimTypeKeyForField(field);
  if (!claimTypeKey) return null;
  const claim = repository.getLatestClaimForType(personId, claimTypeKey);
  return claim?.value ?? null;
}

function inferServiceKey(source, summary = {}, fallback = '') {
  return (
    readString(source?.serviceId) ||
    readString(source?.serviceKey) ||
    readString(summary?.serviceId) ||
    readString(summary?.serviceKey) ||
    readString(fallback) ||
    null
  );
}

function buildEvidenceMemorySnippet(document, fieldValue) {
  const recognizedText = readString(document?.recognizedText);
  const extractedValue = readString(fieldValue?.value);
  const extractedSnippet = extractSnippetAroundNeedle(recognizedText, extractedValue);
  if (extractedSnippet) return extractedSnippet;

  return summarizeSnippet(
    [document?.sourceName, extractedValue, readString(fieldValue?.rationale)]
      .filter(Boolean)
      .join(' · '),
  );
}

function buildExecutionMemorySnippet({ itemType, fieldKey, suggestedValue, currentValue, metadata }) {
  const nextValue = readString(suggestedValue);
  const previousValue = readString(currentValue);

  if (itemType === 'observation') {
    return summarizeSnippet(
      [
        `Observed ${fieldKey} -> ${nextValue}`,
        previousValue ? `(previous: ${previousValue})` : '',
        readString(metadata?.selector) ? `selector: ${readString(metadata.selector)}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  if (itemType === 'proposal') {
    const derivedFrom = readStringArray(metadata?.derivedFrom);
    return summarizeSnippet(
      [
        `Queued ${fieldKey} = ${nextValue}`,
        derivedFrom.length > 0 ? `derived from ${derivedFrom.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  if (itemType === 'trip_record') {
    return summarizeSnippet(`Captured trip context ${fieldKey} = ${nextValue}`);
  }

  return summarizeSnippet(
    [
      `Page reported ${fieldKey} = ${nextValue}`,
      previousValue ? `(current: ${previousValue})` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function normalizeWikiStatus(value) {
  const normalized = readString(value);
  return WIKI_STATUSES.has(normalized) ? normalized : 'candidate';
}

function normalizeWikiTrustLevel(value) {
  const normalized = readString(value);
  return WIKI_TRUST_LEVELS.has(normalized) ? normalized : 'user_asserted';
}

function importLocalWikiEntries(repository, personId, vaultId, localWiki) {
  const entries = Array.isArray(localWiki?.entries) ? localWiki.entries : [];

  for (const entry of entries) {
    const title = readString(entry.title);
    const fieldKey = readString(entry.field);
    const valueText = readString(entry.valueText);
    const summaryText = readString(entry.summaryText);
    const rationale = readString(entry.rationale);

    if (!title && !fieldKey && !valueText && !summaryText && !rationale) {
      continue;
    }

    const updatedAt = readString(entry.updatedAt) || readString(entry.createdAt) || nowIso();
    const status = normalizeWikiStatus(entry.status);

    repository.createWikiEntry({
      personId,
      title: title || fieldKey || 'Imported wiki note',
      category: fieldKey ? 'identity' : 'note',
      fieldKey,
      valueText,
      summaryText: summaryText || rationale,
      status,
      trustLevel: normalizeWikiTrustLevel(entry.trustLevel),
      autofillEligible: Boolean(entry.autofillEligible),
      sourceKind: 'mio_web_local_wiki',
      sourceRef: readString(entry.sourceProposalId) || readString(entry.id),
      sourceLocator: `vault:${vaultId};wiki:${readString(entry.id) || title || fieldKey || 'entry'}`,
      sourceDocumentIds: readStringArray(entry.sourceDocumentIds),
      supportingEvidenceIds: readStringArray(entry.supportingEvidenceIds),
      metadata: {
        importedFrom: 'mio-web.localWiki',
        originalEntryId: readString(entry.id) || null,
        sourceKind: readString(entry.sourceKind) || null,
        rationale: rationale || null,
        lastAutoGeneratedAt: readString(entry.lastAutoGeneratedAt) || null,
      },
      reviewedAt: status === 'verified' ? updatedAt : null,
      createdAt: readString(entry.createdAt) || updatedAt,
      updatedAt,
      actorType: readString(entry.sourceKind) === 'manual' ? 'user' : 'system',
      actorId: readString(entry.sourceKind) === 'manual' ? 'mio-web.local-wiki' : 'mio-web.identity-intelligence',
    });
  }
}

function stringifyCurrentValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(value);
}

export function importWebVaultState(repository, { vaultId = 'local-vault', vaultState, personId = null } = {}) {
  if (!vaultState || typeof vaultState !== 'object') {
    throw new Error('A plaintext vaultState object is required.');
  }

  repository.registerDefaultClaimTypes();

  return repository.importWithinTransaction(() => {
    const person =
      (personId && repository.getPerson(personId)) ??
      repository.createPerson({
        id: personId ?? undefined,
        displayName: normalizeDisplayName(vaultState.profile, `Vault ${vaultId}`),
        createdAt: vaultState.audit?.createdAt ?? nowIso(),
        updatedAt: vaultState.audit?.lastUpdatedAt ?? vaultState.audit?.createdAt ?? nowIso(),
      });

    const evidenceIdByDocumentId = new Map();
    const documents = [
      vaultState.documents?.passportScan ?? null,
      ...(vaultState.documents?.supportingDocuments ?? []),
    ].filter(Boolean);
    const documentsById = new Map(documents.map((document) => [document.id, document]));

    for (const document of documents) {
      const evidence = repository.createEvidence({
        personId: person.id,
        kind: mapDocumentKindToEvidenceKind(document.kind),
        storageUri: `vault://${vaultId}/documents/${document.id}`,
        mimeType: 'application/json',
        sha256: document.fileHash ?? null,
        sourceSystem: 'mio-web.document-vault',
        sourceName: document.sourceName ?? document.kind,
        capturedAt: document.recognizedAt ?? null,
        metadata: {
          documentKind: document.kind,
          sourceType: document.sourceType,
          localeHint: document.localeHint,
          recognitionMeta: document.recognitionMeta ?? null,
        },
        createdAt: document.recognizedAt ?? nowIso(),
      });

      evidenceIdByDocumentId.set(document.id, evidence.id);
    }

    if (vaultState.documents?.tripContext) {
      repository.createEvidence({
        personId: person.id,
        kind: 'trip_context',
        storageUri: `vault://${vaultId}/trip-context/current`,
        mimeType: 'application/json',
        sourceSystem: 'mio-web.trip-context',
        sourceName: 'current-trip-context',
        capturedAt: vaultState.documents.tripContext.reviewedAt ?? nowIso(),
        metadata: vaultState.documents.tripContext,
        createdAt: vaultState.documents.tripContext.reviewedAt ?? nowIso(),
      });
    }

    for (const [field, rawValue] of Object.entries(vaultState.profile ?? {})) {
      const value = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (!value) continue;

      const claimTypeKey = getClaimTypeKeyForField(field);
      if (!claimTypeKey) continue;

      repository.createClaim({
        personId: person.id,
        claimTypeKey,
        value,
        status: STATUS_CONFIRMED,
        confidence: 1,
        issuer: 'mio-web.profile',
        observedAt: vaultState.audit?.lastUpdatedAt ?? vaultState.audit?.createdAt ?? nowIso(),
      });
    }

    for (const evidenceRecord of vaultState.identityIntelligence?.evidenceRecords ?? []) {
      const evidenceId =
        evidenceIdByDocumentId.get(evidenceRecord.documentId) ??
        repository.createEvidence({
          personId: person.id,
          kind: evidenceRecord.documentKind ?? 'compiled_evidence',
          storageUri: `vault://${vaultId}/compiled-evidence/${evidenceRecord.evidenceId}`,
          mimeType: 'application/json',
          sourceSystem: 'mio.identity-intelligence',
          sourceName: evidenceRecord.sourceName ?? evidenceRecord.documentKind ?? 'compiled-evidence',
          capturedAt: evidenceRecord.recognizedAt ?? nowIso(),
          metadata: {
            documentId: evidenceRecord.documentId,
            evidenceId: evidenceRecord.evidenceId,
          },
          createdAt: evidenceRecord.recognizedAt ?? nowIso(),
        }).id;

      for (const fieldValue of evidenceRecord.fieldValues ?? []) {
        const claimTypeKey = getClaimTypeKeyForField(fieldValue.field);
        if (!claimTypeKey) continue;
        if (typeof fieldValue.value !== 'string' || !fieldValue.value.trim()) continue;

        const claim = repository.createClaim({
          personId: person.id,
          claimTypeKey,
          value: fieldValue.value.trim(),
          status: STATUS_EXTRACTED,
          confidence: confidenceToScore(fieldValue.confidence),
          issuer: fieldValue.extractor ?? 'identity-intelligence',
          observedAt: evidenceRecord.recognizedAt ?? nowIso(),
        });

        repository.linkClaimEvidence({
          claimId: claim.id,
          evidenceId,
          relationType: 'extracted_from',
          note: fieldValue.rationale ?? '',
        });

        const sourceDocument = documentsById.get(evidenceRecord.documentId);
        repository.createMemoryItem({
          personId: person.id,
          kind: 'evidence_note',
          fieldKey: fieldValue.field,
          title: `${evidenceRecord.sourceName ?? sourceDocument?.sourceName ?? 'Evidence'} · ${fieldValue.field}`,
          snippetText: buildEvidenceMemorySnippet(sourceDocument, fieldValue),
          rationale: readString(fieldValue.rationale) || 'Compiled from imported identity evidence.',
          sourceKind: sourceDocument ? 'vault_document' : 'compiled_evidence',
          sourceRef: sourceDocument?.id ?? evidenceId,
          sourceLocator: `document:${evidenceRecord.documentId ?? sourceDocument?.id ?? evidenceId};field:${fieldValue.field}`,
          confidence: confidenceToScore(fieldValue.confidence),
          metadata: {
            evidenceId,
            documentId: evidenceRecord.documentId ?? sourceDocument?.id ?? null,
            documentKind: sourceDocument?.kind ?? evidenceRecord.documentKind ?? null,
            extractor: readString(fieldValue.extractor) || null,
            value: fieldValue.value.trim(),
          },
          createdAt: evidenceRecord.recognizedAt ?? nowIso(),
        });
      }
    }

    importLocalWikiEntries(repository, person.id, vaultId, vaultState.localWiki);

    const proposalCount = vaultState.identityIntelligence?.proposals?.length ?? 0;
    const conflictCount = vaultState.identityIntelligence?.conflicts?.length ?? 0;

    repository.createAuditEvent({
      personId: person.id,
      actorType: 'system',
      actorId: 'mio-core.import-web-vault',
      eventType: 'vault.imported',
      eventPayload: {
        vaultId,
        importedDocuments: documents.length,
        proposalCount,
        conflictCount,
      },
      createdAt: nowIso(),
    });

    repository.createTimelineEntry({
      personId: person.id,
      eventDate: vaultState.audit?.lastUpdatedAt ?? nowIso(),
      summary: `Imported vault ${vaultId} into mio-core`,
      detailMd: [
        `- Documents imported: ${documents.length}`,
        `- Pending proposals observed: ${proposalCount}`,
        `- Conflicts observed: ${conflictCount}`,
      ].join('\n'),
      source: 'mio-web',
      createdAt: nowIso(),
    });

    return person;
  });
}

export function importFormPayload(repository, { personId, formPayload } = {}) {
  if (!personId) {
    throw new Error('personId is required.');
  }
  if (!formPayload || typeof formPayload !== 'object') {
    throw new Error('formPayload is required.');
  }

  repository.registerDefaultClaimTypes();

  return repository.importWithinTransaction(() => {
    const requester = repository.createRequester({
      id: formPayload.grant?.grantee?.id ?? undefined,
      name: formPayload.grant?.grantee?.label ?? formPayload.serviceRequest?.service?.name ?? 'Unknown requester',
      origin: formPayload.templateId ?? formPayload.serviceRequest?.service?.id ?? null,
      publicKeyOrIdentifier:
        formPayload.grant?.grantee?.id ??
        `${formPayload.serviceRequest?.service?.id ?? 'requester'}:${formPayload.templateId ?? 'unknown'}`,
      createdAt: formPayload.generatedAt ?? nowIso(),
    });

    const grant = repository.createGrant({
      id: formPayload.grant?.grantId ?? undefined,
      personId,
      requesterId: requester.id,
      purpose:
        formPayload.serviceRequest?.rationale ??
        `Authorize ${formPayload.countryCode ?? ''} ${formPayload.formType ?? ''}`.trim(),
      status: formPayload.grant?.expiresAt ? 'active' : 'proposed',
      service: formPayload.grant?.service ?? formPayload.serviceRequest?.service ?? {},
      scope: formPayload.grant?.scope ?? {
        allowedFields: formPayload.allowedFields ?? [],
        requestedFields: formPayload.allowedFields ?? [],
      },
      actions: formPayload.grant?.actions ?? ['read-granted-fields'],
      policy: formPayload.grant?.policy ?? {},
      grantedAt: formPayload.grant?.issuedAt ?? formPayload.generatedAt ?? nowIso(),
      expiresAt: formPayload.grant?.expiresAt ?? null,
      createdAt: formPayload.grant?.issuedAt ?? formPayload.generatedAt ?? nowIso(),
    });

    for (const field of formPayload.grant?.scope?.allowedFields ?? formPayload.allowedFields ?? []) {
      const claimTypeKey = getClaimTypeKeyForField(field);
      if (!claimTypeKey) continue;
      const claim = repository.getLatestClaimForType(personId, claimTypeKey);
      if (!claim) continue;

      repository.attachGrantClaim({
        grantId: grant.id,
        claimId: claim.id,
        accessMode: mapFormFieldToAccessMode(claimTypeKey),
      });
    }

    repository.createAuditEvent({
      personId,
      actorType: 'system',
      actorId: 'mio-core.import-form-payload',
      eventType: 'grant.imported',
      eventPayload: {
        requestId: formPayload.serviceRequest?.requestId ?? null,
        grantId: grant.id,
        templateId: formPayload.templateId ?? null,
        allowedFields: formPayload.grant?.scope?.allowedFields ?? formPayload.allowedFields ?? [],
      },
      createdAt: nowIso(),
    });

    return { requester, grant };
  });
}

export function importExecutionReviewBundle(repository, { personId, reviewBundle } = {}) {
  if (!personId) {
    throw new Error('personId is required.');
  }
  if (!isObject(reviewBundle) || reviewBundle.schemaVersion !== 'mio.review.bundle.v1') {
    throw new Error('reviewBundle with schemaVersion "mio.review.bundle.v1" is required.');
  }

  return repository.importWithinTransaction(() => {
    const sourceBundleId = readString(reviewBundle.reviewBundleId);
    if (sourceBundleId) {
      const existing = repository.findReviewBundleBySourceBundleId(sourceBundleId);
      if (existing) {
        if (existing.personId !== personId) {
          throw new Error('Review bundle belongs to a different person.');
        }
        return {
          bundle: existing,
          items: repository.listReviewItemsForBundle(existing.id),
          reusedExisting: true,
        };
      }
    }

    const createdAt = readString(reviewBundle.createdAt) || nowIso();
    const source = isObject(reviewBundle.source) ? reviewBundle.source : {};
    const summary = isObject(reviewBundle.summary) ? reviewBundle.summary : {};
    const pageProfile = isObject(reviewBundle.pageProfile) ? reviewBundle.pageProfile : {};
    const tripRecord = isObject(reviewBundle.tripRecord) ? reviewBundle.tripRecord : {};
    const serviceKey = inferServiceKey(source, summary, source.pageStage);

    const bundle = repository.createReviewBundle({
      id: sourceBundleId || undefined,
      personId,
      sourceBundleId: sourceBundleId || null,
      sourceSystem: 'mio.review.bundle',
      producer: readString(source.producer) || 'mio-autofill-extension',
      stageKey: readString(source.pageStage) || null,
      stageLabel: readString(source.pageStageLabel) || readString(source.pageStage) || null,
      source,
      summary,
      requestedFields: readStringArray(reviewBundle.requestedFields),
      injectedFields: readStringArray(reviewBundle.injectedFields),
      pageProfile,
      tripRecord,
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    });

    const items = [];
    const seenKeys = new Set();

    function createMergedItem({ dedupeTarget = true, itemType, fieldKey, target, suggestedValue, currentValue = null, rationale = '', metadata = {}, sourceDocumentIds = [], supportingEvidenceIds = [], itemCreatedAt = createdAt, preferredId = null }) {
      const normalizedField = readString(fieldKey);
      const normalizedValue = readString(suggestedValue);
      if (!normalizedField || !normalizedValue) return null;

      const seenKey = `${target}:${normalizedField}`;
      if (dedupeTarget && seenKeys.has(seenKey)) return null;

      const item = repository.createReviewItem({
        id: preferredId || undefined,
        bundleId: bundle.id,
        personId,
        itemType,
        fieldKey: normalizedField,
        target,
        suggestedValue: normalizedValue,
        currentValue,
        rationale,
        sourceDocumentIds,
        supportingEvidenceIds,
        metadata,
        createdAt: itemCreatedAt,
      });

      const memoryKind = itemType === 'proposal' ? 'review_rationale' : 'execution_note';
      repository.createMemoryItem({
        personId,
        kind: memoryKind,
        fieldKey: normalizedField,
        serviceKey,
        sessionOrBundleId: bundle.id,
        title: `${bundle.stageLabel ?? bundle.stageKey ?? 'Execution'} · ${normalizedField}`,
        snippetText: buildExecutionMemorySnippet({
          itemType,
          fieldKey: normalizedField,
          suggestedValue: normalizedValue,
          currentValue: readString(currentValue),
          metadata,
        }),
        rationale: rationale || 'Execution context captured for review and troubleshooting.',
        sourceKind: 'review_item',
        sourceRef: item.id,
        sourceLocator: `bundle:${bundle.id};item:${item.id}`,
        metadata: {
          itemType,
          target,
          producer: bundle.producer,
          stageKey: bundle.stageKey,
          sourceDocumentIds,
          supportingEvidenceIds,
          ...metadata,
        },
        createdAt: itemCreatedAt,
      });

      if (dedupeTarget) {
        seenKeys.add(seenKey);
      }
      items.push(item);
      return item;
    }

    for (const [field, rawValue] of Object.entries(pageProfile)) {
      const value = readString(rawValue);
      if (!value) continue;

      createMergedItem({
        itemType: 'page_profile',
        fieldKey: field,
        target: inferReviewTarget(field),
        suggestedValue: value,
        currentValue: pickCurrentReviewValue(repository, personId, field),
        rationale: 'Observed on the official form page after autofill execution.',
        metadata: {
          source: 'pageProfile',
        },
      });
    }

    for (const observation of Array.isArray(reviewBundle.observations) ? reviewBundle.observations : []) {
      const field = readString(observation?.field);
      const observedValue = readString(observation?.nextValue) || readString(observation?.sourceValue);
      if (!field || !observedValue) continue;

      createMergedItem({
        itemType: 'observation',
        fieldKey: field,
        target: inferReviewTarget(field),
        suggestedValue: observedValue,
        currentValue: readString(observation?.previousValue) || pickCurrentReviewValue(repository, personId, field),
        rationale: 'Observed on the official form page during execution and held for review.',
        metadata: {
          observationId: readString(observation?.observationId) || null,
          selector: readString(observation?.selector) || null,
          observationType: readString(observation?.type) || 'fill',
          sourceValue: readString(observation?.sourceValue) || null,
        },
        itemCreatedAt: readString(observation?.observedAt) || createdAt,
        preferredId: readString(observation?.observationId) || undefined,
      });
    }

    for (const proposal of Array.isArray(reviewBundle.proposals) ? reviewBundle.proposals : []) {
      const field = readString(proposal?.field);
      const value = readString(proposal?.value);
      if (!field || !value) continue;

      const target = inferReviewTarget(field, readString(proposal?.target));
      createMergedItem({
        itemType: 'proposal',
        fieldKey: field,
        target,
        suggestedValue: value,
        currentValue: target === 'identity_claim' ? pickCurrentReviewValue(repository, personId, field) : null,
        rationale:
          readString(proposal?.rationale) ||
          'Derived during execution and queued for manual review before merge.',
        metadata: {
          proposalId: readString(proposal?.proposalId) || null,
          derivedFrom: readStringArray(proposal?.derivedFrom),
        },
        itemCreatedAt: readString(proposal?.proposedAt) || createdAt,
        preferredId: readString(proposal?.proposalId) || undefined,
      });
    }

    for (const [field, rawValue] of Object.entries(tripRecord)) {
      const value = readString(rawValue);
      if (!value) continue;

      createMergedItem({
        itemType: 'trip_record',
        fieldKey: field,
        target: 'trip_context',
        suggestedValue: value,
        rationale: 'Bundle-specific travel context captured during execution.',
        metadata: {
          source: 'tripRecord',
        },
        dedupeTarget: false,
      });
    }

    repository.createAuditEvent({
      personId,
      actorType: 'system',
      actorId: 'mio-core.import-review-bundle',
      eventType: 'review.bundle.imported',
      eventPayload: {
        bundleId: bundle.id,
        sourceBundleId: bundle.sourceBundleId,
        producer: bundle.producer,
        stageKey: bundle.stageKey,
        pendingItemCount: items.length,
      },
      createdAt,
    });

    repository.createTimelineEntry({
      personId,
      eventDate: createdAt,
      summary: `Imported review bundle ${bundle.stageLabel ?? bundle.id}`,
      detailMd: [
        `- Producer: ${bundle.producer ?? 'unknown'}`,
        `- Pending review items: ${items.length}`,
        `- Requested fields: ${bundle.requestedFields.length}`,
        `- Injected fields: ${bundle.injectedFields.length}`,
      ].join('\n'),
      source: 'mio-autofill-extension',
      createdAt,
    });

    return {
      bundle,
      items,
      reusedExisting: false,
    };
  });
}

export function importReviewDecisionBatch(repository, { personId = null, decisionBatch } = {}) {
  if (!isObject(decisionBatch) || decisionBatch.schemaVersion !== 'mio.review.decisions.v1') {
    throw new Error('decisionBatch with schemaVersion "mio.review.decisions.v1" is required.');
  }

  const resolvedPersonId = readString(personId) || readString(decisionBatch.person?.id);
  if (!resolvedPersonId) {
    throw new Error('personId is required either in args.personId or decisionBatch.person.id.');
  }

  const person = repository.getPerson(resolvedPersonId);
  if (!person) {
    throw new Error(`Unknown person: ${resolvedPersonId}`);
  }

  const decisions = Array.isArray(decisionBatch.decisions) ? decisionBatch.decisions : [];
  const generatedAt = readString(decisionBatch.generatedAt) || nowIso();
  const batchId = readString(decisionBatch.batchId) || `batch_${generatedAt}`;
  const source = isObject(decisionBatch.source) ? decisionBatch.source : {};

  const applied = [];
  const skipped = [];

  for (const entry of decisions) {
    const decisionId = readString(entry?.decisionId);
    const reviewItemId = readString(entry?.reviewItemId);
    const bundleId = readString(entry?.bundleId);
    const decision = readString(entry?.decision);
    const actorType = readString(entry?.actorType);
    const actorId = readString(entry?.actorId);
    const note = readString(entry?.note);
    const createdAt = readString(entry?.createdAt) || generatedAt;

    if (!decisionId) {
      skipped.push({ reason: 'missing_decision_id', reviewItemId, bundleId });
      continue;
    }
    if (repository.getReviewDecision(decisionId)) {
      skipped.push({ decisionId, reason: 'already_imported', reviewItemId, bundleId });
      continue;
    }
    if (!reviewItemId) {
      skipped.push({ decisionId, reason: 'missing_review_item_id', bundleId });
      continue;
    }
    if (!REVIEW_DECISION_VALUES.has(decision)) {
      skipped.push({ decisionId, reason: 'invalid_decision', reviewItemId, bundleId });
      continue;
    }
    if (!actorId) {
      skipped.push({ decisionId, reason: 'missing_actor_id', reviewItemId, bundleId });
      continue;
    }

    const item = repository.getReviewItem(reviewItemId);
    if (!item) {
      skipped.push({ decisionId, reason: 'unknown_review_item', reviewItemId, bundleId });
      continue;
    }
    if (item.personId !== resolvedPersonId) {
      skipped.push({ decisionId, reason: 'person_mismatch', reviewItemId, bundleId: item.bundleId });
      continue;
    }
    if (bundleId && item.bundleId !== bundleId) {
      skipped.push({ decisionId, reason: 'bundle_mismatch', reviewItemId, bundleId: item.bundleId });
      continue;
    }
    if (item.status !== 'pending') {
      skipped.push({ decisionId, reason: 'already_resolved', reviewItemId, bundleId: item.bundleId, itemStatus: item.status });
      continue;
    }

    const result = repository.recordReviewDecision({
      decisionId,
      reviewItemId: item.id,
      decision,
      actorType: REVIEW_ACTOR_TYPES.has(actorType) ? actorType : 'user',
      actorId,
      note,
      createdAt,
    });

    applied.push({
      decisionId: result.decision.id,
      reviewItemId: result.item?.id ?? reviewItemId,
      bundleId: result.bundle?.id ?? item.bundleId,
      decision: result.decision.decision,
      itemStatus: result.item?.status ?? null,
      bundleStatus: result.bundle?.status ?? null,
    });
  }

  repository.createAuditEvent({
    personId: resolvedPersonId,
    actorType: 'system',
    actorId: 'mio-core.import-review-decisions',
    eventType: 'review.decision.batch.imported',
    eventPayload: {
      batchId,
      sourceProducer: readString(source.producer) || null,
      totalDecisions: decisions.length,
      appliedCount: applied.length,
      skippedCount: skipped.length,
    },
    createdAt: generatedAt,
  });

  repository.createTimelineEntry({
    personId: resolvedPersonId,
    eventDate: generatedAt,
    summary: `Imported review decision batch ${batchId}`,
    detailMd: [
      `- Applied decisions: ${applied.length}`,
      `- Skipped decisions: ${skipped.length}`,
      `- Source producer: ${readString(source.producer) || 'unknown'}`,
    ].join('\n'),
    source: readString(source.producer) || 'mio-ios',
    createdAt: generatedAt,
  });

  return {
    schemaVersion: 'mio.review.decisions.result.v1',
    generatedAt,
    person: {
      id: person.id,
      displayName: person.displayName,
    },
    batchId,
    totalDecisions: decisions.length,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    acknowledgedDecisionIds: [
      ...applied.map((item) => item.decisionId),
      ...skipped
        .filter((item) => item.reason === 'already_imported')
        .map((item) => item.decisionId)
        .filter(Boolean),
    ],
    applied,
    skipped,
  };
}

export function importGemmaMaintenanceBatch(repository, { personId = null, maintenanceBatch } = {}) {
  if (!isObject(maintenanceBatch) || maintenanceBatch.schemaVersion !== 'mio.gemma.maintenance.v1') {
    throw new Error('maintenanceBatch with schemaVersion "mio.gemma.maintenance.v1" is required.');
  }

  const resolvedPersonId = readString(personId) || readString(maintenanceBatch.person?.id);
  if (!resolvedPersonId) {
    throw new Error('personId is required either in args.personId or maintenanceBatch.person.id.');
  }

  const person = repository.getPerson(resolvedPersonId);
  if (!person) {
    throw new Error(`Unknown person: ${resolvedPersonId}`);
  }

  return repository.importWithinTransaction(() => {
    const actions = Array.isArray(maintenanceBatch.actions) ? maintenanceBatch.actions : [];
    const generatedAt = readString(maintenanceBatch.generatedAt) || nowIso();
    const batchId = readString(maintenanceBatch.batchId) || `batch_${generatedAt}`;
    const source = normalizeGemmaMaintenanceSource(maintenanceBatch.source);
    const actorId = makeGemmaMaintenanceActorId(source);
    const applied = [];
    const skipped = [];
    let reviewBundle = null;

    for (const entry of actions) {
      const actionId = readString(entry?.actionId);
      const actionType = readString(entry?.actionType);
      const rationale = readString(entry?.rationale);
      const confidence = GEMMA_MAINTENANCE_CONFIDENCE.has(readString(entry?.confidence))
        ? readString(entry.confidence)
        : 'medium';
      const riskLevel = GEMMA_MAINTENANCE_RISK_LEVELS.has(readString(entry?.riskLevel))
        ? readString(entry.riskLevel)
        : 'medium';
      const sourceDocumentIds = readStringArray(entry?.sourceDocumentIds);
      const supportingEvidenceIds = readStringArray(entry?.supportingEvidenceIds);
      const tags = readStringArray(entry?.tags);
      const metadata = isObject(entry?.metadata) ? entry.metadata : {};
      const createdAt = readString(entry?.createdAt) || generatedAt;

      if (!actionId) {
        skipped.push({ actionType, reason: 'missing_action_id' });
        continue;
      }
      if (!GEMMA_MAINTENANCE_ACTION_TYPES.has(actionType)) {
        skipped.push({ actionId, actionType, reason: 'invalid_action_type' });
        continue;
      }

      if (actionType === 'upsert_wiki_entry') {
        const duplicate = findWikiEntryByMaintenanceAction(repository, resolvedPersonId, actionId);
        if (duplicate) {
          skipped.push({ actionId, actionType, reason: 'already_imported', entryId: duplicate.id });
          continue;
        }

        const entryId = readString(entry.entryId);
        const existing = entryId ? repository.getWikiEntry(entryId) : null;
        if (entryId && !existing) {
          skipped.push({ actionId, actionType, reason: 'unknown_wiki_entry', entryId });
          continue;
        }
        if (existing && existing.personId !== resolvedPersonId) {
          skipped.push({ actionId, actionType, reason: 'person_mismatch', entryId });
          continue;
        }

        const fieldKey = readString(entry.fieldKey);
        const title = readString(entry.title) || fieldKey || 'Gemma wiki note';
        const valueText = readString(entry.valueText);
        const summaryText = readString(entry.summaryText);
        if (!valueText && !summaryText) {
          skipped.push({ actionId, actionType, reason: 'missing_wiki_content', entryId: existing?.id ?? null });
          continue;
        }

        const nextMetadata = buildGemmaMaintenanceMetadata(existing?.metadata, metadata, {
          actionId,
          batchId,
          confidence,
          riskLevel,
          source,
        });

        const wikiEntry = existing
          ? repository.updateWikiEntry(existing.id, {
              title,
              category: readString(entry.category) || existing.category || 'identity',
              fieldKey: fieldKey || existing.fieldKey,
              valueText: valueText || existing.valueText,
              summaryText: summaryText || existing.summaryText,
              status: 'candidate',
              trustLevel: 'model_inferred',
              autofillEligible: false,
              sourceKind: 'gemma_maintenance',
              sourceRef: actionId,
              sourceLocator: `batch:${batchId}`,
              sourceDocumentIds,
              supportingEvidenceIds,
              tags,
              metadata: nextMetadata,
              actorType: 'agent',
              actorId,
              updatedAt: createdAt,
            })
          : repository.createWikiEntry({
              personId: resolvedPersonId,
              title,
              category: readString(entry.category) || 'identity',
              fieldKey,
              valueText,
              summaryText,
              status: 'candidate',
              trustLevel: 'model_inferred',
              autofillEligible: false,
              sourceKind: 'gemma_maintenance',
              sourceRef: actionId,
              sourceLocator: `batch:${batchId}`,
              sourceDocumentIds,
              supportingEvidenceIds,
              tags,
              metadata: nextMetadata,
              actorType: 'agent',
              actorId,
              createdAt,
              updatedAt: createdAt,
            });

        repository.createAuditEvent({
          personId: resolvedPersonId,
          actorType: 'agent',
          actorId,
          eventType: 'gemma.maintenance.action.applied',
          eventPayload: {
            batchId,
            actionId,
            actionType,
            resultType: 'wiki_entry',
            resultId: wikiEntry.id,
            confidence,
            riskLevel,
          },
          createdAt,
        });

        applied.push({
          actionId,
          actionType,
          resultType: 'wiki_entry',
          entryId: wikiEntry.id,
          status: wikiEntry.status,
        });
        continue;
      }

      if (actionType === 'mark_wiki_entry_stale') {
        const entryId = readString(entry.entryId);
        if (!entryId) {
          skipped.push({ actionId, actionType, reason: 'missing_entry_id' });
          continue;
        }

        const existing = repository.getWikiEntry(entryId);
        if (!existing) {
          skipped.push({ actionId, actionType, reason: 'unknown_wiki_entry', entryId });
          continue;
        }
        if (existing.personId !== resolvedPersonId) {
          skipped.push({ actionId, actionType, reason: 'person_mismatch', entryId });
          continue;
        }
        if (readString(existing.metadata?.gemmaMaintenance?.actionId) === actionId) {
          skipped.push({ actionId, actionType, reason: 'already_imported', entryId });
          continue;
        }

        const nextMetadata = buildGemmaMaintenanceMetadata(existing.metadata, metadata, {
          actionId,
          batchId,
          confidence,
          riskLevel,
          source,
        });
        if (rationale) {
          nextMetadata.staleReason = rationale;
        }

        const wikiEntry = repository.updateWikiEntry(existing.id, {
          status: 'stale',
          metadata: nextMetadata,
          sourceKind: 'gemma_maintenance',
          sourceRef: actionId,
          sourceLocator: `batch:${batchId}`,
          actorType: 'agent',
          actorId,
          updatedAt: createdAt,
        });

        if (rationale) {
          repository.createMemoryItem({
            personId: resolvedPersonId,
            kind: 'review_rationale',
            fieldKey: wikiEntry.fieldKey || null,
            serviceKey: 'identity_maintenance',
            sessionOrBundleId: wikiEntry.id,
            title: `Gemma stale note · ${wikiEntry.title || wikiEntry.fieldKey || wikiEntry.id}`,
            snippetText: rationale,
            rationale,
            sourceKind: 'gemma_maintenance',
            sourceRef: actionId,
            sourceLocator: `wiki:${wikiEntry.id}`,
            confidence: confidenceToScore(confidence),
            metadata: nextMetadata,
            createdAt,
          });
        }

        repository.createAuditEvent({
          personId: resolvedPersonId,
          actorType: 'agent',
          actorId,
          eventType: 'gemma.maintenance.action.applied',
          eventPayload: {
            batchId,
            actionId,
            actionType,
            resultType: 'wiki_entry',
            resultId: wikiEntry.id,
            confidence,
            riskLevel,
          },
          createdAt,
        });

        applied.push({
          actionId,
          actionType,
          resultType: 'wiki_entry',
          entryId: wikiEntry.id,
          status: wikiEntry.status,
        });
        continue;
      }

      if (!reviewBundle) {
        reviewBundle = getOrCreateGemmaMaintenanceReviewBundle(repository, resolvedPersonId, {
          batchId,
          generatedAt,
          source,
        });
      }

      const duplicate = findReviewItemByMaintenanceAction(repository, reviewBundle.id, actionId);
      if (duplicate) {
        skipped.push({
          actionId,
          actionType,
          reason: 'already_imported',
          reviewItemId: duplicate.id,
          bundleId: reviewBundle.id,
        });
        continue;
      }

      const fieldKey = readString(entry.fieldKey);
      const suggestedValue = readString(entry.suggestedValue) || readString(entry.valueText);
      if (!fieldKey || !suggestedValue || !rationale) {
        skipped.push({ actionId, actionType, reason: 'missing_review_fields', bundleId: reviewBundle.id });
        continue;
      }

      const target = GEMMA_MAINTENANCE_REVIEW_TARGETS.has(readString(entry.target))
        ? readString(entry.target)
        : inferReviewTarget(fieldKey, readString(entry.target));
      const itemType = GEMMA_MAINTENANCE_REVIEW_ITEM_TYPES.has(readString(entry.itemType))
        ? readString(entry.itemType)
        : 'proposal';
      const currentValue =
        'currentValue' in entry ? readString(entry.currentValue) : stringifyCurrentValue(pickCurrentReviewValue(repository, resolvedPersonId, fieldKey));
      const itemMetadata = buildGemmaMaintenanceMetadata({}, metadata, {
        actionId,
        batchId,
        confidence,
        riskLevel,
        source,
      });
      itemMetadata.actionId = actionId;

      const reviewItem = repository.createReviewItem({
        bundleId: reviewBundle.id,
        personId: resolvedPersonId,
        itemType,
        fieldKey,
        target,
        suggestedValue,
        currentValue: currentValue || null,
        rationale,
        sourceDocumentIds,
        supportingEvidenceIds,
        metadata: itemMetadata,
        status: 'pending',
        createdAt,
      });

      repository.createMemoryItem({
        personId: resolvedPersonId,
        kind: 'review_rationale',
        fieldKey,
        serviceKey: reviewBundle.stageKey || 'identity_maintenance',
        sessionOrBundleId: reviewBundle.id,
        title: `Gemma maintenance proposal · ${fieldKey}`,
        snippetText: `Proposed ${fieldKey} = ${suggestedValue}`,
        rationale,
        sourceKind: 'gemma_maintenance',
        sourceRef: actionId,
        sourceLocator: `bundle:${reviewBundle.id};item:${reviewItem.id}`,
        confidence: confidenceToScore(confidence),
        metadata: itemMetadata,
        createdAt,
      });

      repository.createAuditEvent({
        personId: resolvedPersonId,
        actorType: 'agent',
        actorId,
        eventType: 'gemma.maintenance.action.applied',
        eventPayload: {
          batchId,
          actionId,
          actionType,
          resultType: 'review_item',
          resultId: reviewItem.id,
          bundleId: reviewBundle.id,
          confidence,
          riskLevel,
        },
        createdAt,
      });

      applied.push({
        actionId,
        actionType,
        resultType: 'review_item',
        reviewItemId: reviewItem.id,
        bundleId: reviewBundle.id,
        status: reviewItem.status,
      });
    }

    repository.createAuditEvent({
      personId: resolvedPersonId,
      actorType: 'system',
      actorId: 'mio-core.import-gemma-maintenance',
      eventType: 'gemma.maintenance.batch.imported',
      eventPayload: {
        batchId,
        sourceProducer: source.producer || null,
        sourceModel: source.model || null,
        totalActions: actions.length,
        appliedCount: applied.length,
        skippedCount: skipped.length,
        reviewBundleId: reviewBundle?.id ?? null,
      },
      createdAt: generatedAt,
    });

    repository.createTimelineEntry({
      personId: resolvedPersonId,
      eventDate: generatedAt,
      summary: `Imported Gemma maintenance batch ${batchId}`,
      detailMd: buildGemmaMaintenanceTimelineDetail({
        source,
        appliedCount: applied.length,
        skippedCount: skipped.length,
        reviewBundleId: reviewBundle?.id ?? null,
      }),
      source: source.producer || source.model || 'gemma-maintenance',
      createdAt: generatedAt,
    });

    return {
      schemaVersion: 'mio.gemma.maintenance.result.v1',
      generatedAt,
      person: {
        id: person.id,
        displayName: person.displayName,
      },
      batchId,
      totalActions: actions.length,
      appliedCount: applied.length,
      skippedCount: skipped.length,
      reviewBundleId: reviewBundle?.id ?? null,
      acknowledgedActionIds: [
        ...applied.map((item) => item.actionId),
        ...skipped
          .filter((item) => item.reason === 'already_imported')
          .map((item) => item.actionId)
          .filter(Boolean),
      ],
      applied,
      skipped,
    };
  });
}
