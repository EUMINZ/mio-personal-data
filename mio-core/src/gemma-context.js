import { getFieldForClaimTypeKey } from './claim-types.js';
import {
  REVIEWABLE_CLAIM_STATUSES,
  buildCompiledIdentitySummary,
  buildContinuationTimeline,
  buildEvidenceDigest,
  buildEvidenceMaps,
  buildProfileSummary,
  confidenceLabel,
} from './identity-context.js';
import { formatMemoryPreview, selectRelevantMemoryItems } from './memory-sidecar.js';

function isString(value) {
  return typeof value === 'string';
}

function normalizeString(value) {
  return isString(value) ? value.trim() : '';
}

function formatMemoryItem(memoryItem) {
  return {
    id: memoryItem.id,
    kind: memoryItem.kind,
    field: normalizeString(memoryItem.fieldKey),
    serviceKey: normalizeString(memoryItem.serviceKey),
    sessionOrBundleId: normalizeString(memoryItem.sessionOrBundleId),
    title: normalizeString(memoryItem.title),
    snippetText: normalizeString(memoryItem.snippetText),
    rationale: normalizeString(memoryItem.rationale),
    sourceKind: normalizeString(memoryItem.sourceKind),
    sourceRef: normalizeString(memoryItem.sourceRef),
    sourceLocator: normalizeString(memoryItem.sourceLocator),
    confidence: typeof memoryItem.confidence === 'number' ? memoryItem.confidence : null,
    createdAt: normalizeString(memoryItem.createdAt),
  };
}

function formatWikiEntry(wikiEntry) {
  return {
    id: wikiEntry.id,
    title: normalizeString(wikiEntry.title),
    category: normalizeString(wikiEntry.category),
    fieldKey: normalizeString(wikiEntry.fieldKey),
    valueText: normalizeString(wikiEntry.valueText),
    summaryText: normalizeString(wikiEntry.summaryText),
    status: normalizeString(wikiEntry.status),
    trustLevel: normalizeString(wikiEntry.trustLevel),
    autofillEligible: Boolean(wikiEntry.autofillEligible),
    sourceKind: normalizeString(wikiEntry.sourceKind),
    sourceRef: normalizeString(wikiEntry.sourceRef),
    sourceLocator: normalizeString(wikiEntry.sourceLocator),
    sourceDocumentIds: Array.isArray(wikiEntry.sourceDocumentIds) ? wikiEntry.sourceDocumentIds : [],
    supportingEvidenceIds: Array.isArray(wikiEntry.supportingEvidenceIds) ? wikiEntry.supportingEvidenceIds : [],
    tags: Array.isArray(wikiEntry.tags) ? wikiEntry.tags : [],
    reviewedAt: normalizeString(wikiEntry.reviewedAt),
    updatedAt: normalizeString(wikiEntry.updatedAt),
  };
}

function formatWikiPreview(wikiEntry) {
  const headline = normalizeString(wikiEntry.title);
  const detail = normalizeString(wikiEntry.summaryText) || normalizeString(wikiEntry.valueText);
  if (headline && detail) {
    return `${headline}: ${detail}`;
  }
  return headline || detail;
}

function makeKnowledgeCards(
  person,
  compiledIdentity,
  profileSummary,
  evidenceDigest,
  pendingReviewItems,
  wikiEntries,
  activeGrants,
  memoryItems,
  totalMemoryCount,
) {
  const cards = [];
  const identityFacts = [
    profileSummary.lastName,
    profileSummary.firstName,
    profileSummary.passportNo,
    profileSummary.nationality,
    profileSummary.dateOfBirth,
  ].filter(Boolean);

  cards.push({
    id: 'identity-card',
    titleEn: 'Identity card',
    titleZh: '身份卡',
    summaryEn: compiledIdentity.summaryText,
    summaryZh: `当前身份状态摘要：${compiledIdentity.summaryLines.join(' ')}`,
    facts: identityFacts,
  });

  if (evidenceDigest.length > 0) {
    cards.push({
      id: 'evidence-ledger',
      titleEn: 'Evidence ledger',
      titleZh: '证据台账',
      summaryEn: `${evidenceDigest.length} structured evidence records are available in mio-core.`,
      summaryZh: `mio-core 中当前有 ${evidenceDigest.length} 条结构化证据记录。`,
      facts: evidenceDigest.slice(0, 4).map((item) => item.headline).filter(Boolean),
    });
  }

  if (pendingReviewItems.length > 0) {
    cards.push({
      id: 'review-queue',
      titleEn: 'Review queue',
      titleZh: '待审队列',
      summaryEn: `${pendingReviewItems.length} pending review items are waiting for merge or dismissal.`,
      summaryZh: `当前有 ${pendingReviewItems.length} 条待审记录等待合并或忽略。`,
      facts: pendingReviewItems.slice(0, 4).map((item) => item.field).filter(Boolean),
    });
  }

  if (wikiEntries.length > 0) {
    cards.push({
      id: 'identity-wiki',
      titleEn: 'Identity wiki',
      titleZh: '身份 wiki',
      summaryEn: `${wikiEntries.length} structured wiki entries are available for maintenance and review.`,
      summaryZh: `当前有 ${wikiEntries.length} 条结构化 wiki 条目可供维护和复核。`,
      facts: wikiEntries.slice(0, 4).map((entry) => formatWikiPreview(entry)).filter(Boolean),
    });
  }

  if (activeGrants.length > 0) {
    cards.push({
      id: 'active-grants',
      titleEn: 'Active grants',
      titleZh: '当前授权',
      summaryEn: `${activeGrants.length} active grants currently exist for this identity.`,
      summaryZh: `这个身份当前有 ${activeGrants.length} 条有效授权。`,
      facts: activeGrants.slice(0, 4).map((grant) => grant.purpose).filter(Boolean),
    });
  }

  if (memoryItems.length > 0) {
    cards.push({
      id: 'memory-sidecar',
      titleEn: 'Explainable notes',
      titleZh: '解释笔记',
      summaryEn: `${totalMemoryCount} constrained notes are available for review, resume, and troubleshooting.`,
      summaryZh: `当前有 ${totalMemoryCount} 条受控解释笔记可用于复核、续办和排障。`,
      facts: memoryItems.slice(0, 3).map((item) => formatMemoryPreview(item)).filter(Boolean),
    });
  }

  cards.push({
    id: 'core-subject',
    titleEn: 'Mio Core subject',
    titleZh: 'Mio Core 主体',
    summaryEn: 'Structured identity subject currently loaded from mio-core.',
    summaryZh: '当前从 mio-core 读取的结构化身份主体。',
    facts: [person.displayName, person.id].filter(Boolean),
  });

  return cards;
}

function makePendingReviewProposals(repository, personId, profileSummary, evidenceById, memoryItems) {
  const proposals = [];
  const seen = new Set();
  const pendingReviewItems = repository.listPendingReviewItemsForPerson(personId);

  for (const item of pendingReviewItems) {
    if (item.target !== 'identity_claim') continue;

    const field = normalizeString(item.fieldKey);
    const suggestedValue = normalizeString(item.suggestedValue);
    if (!field || !suggestedValue) continue;

    const dedupeKey = `${field}|${suggestedValue}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const supportingEvidenceIds = item.supportingEvidenceIds ?? [];
    const sourceDocumentIds = [
      ...(item.sourceDocumentIds ?? []),
      ...supportingEvidenceIds
        .map((evidenceId) => normalizeString(evidenceById.get(evidenceId)?.metadata?.documentId))
        .filter(Boolean),
    ];

    proposals.push({
      field,
      currentValue: normalizeString(item.currentValue) || normalizeString(profileSummary[field]),
      suggestedValue,
      rationale: normalizeString(item.rationale) || 'Pending review item from mio-core review lifecycle.',
      confidence:
        item.itemType === 'observation'
          ? 'high'
          : item.itemType === 'page_profile'
            ? 'medium'
            : 'medium',
      action: normalizeString(item.currentValue) || normalizeString(profileSummary[field]) ? 'review-conflict' : 'fill-empty',
      sourceDocumentIds,
      supportingEvidenceIds,
      relatedMemory: selectRelevantMemoryItems(memoryItems, {
        fieldKey: field,
        sessionOrBundleId: item.bundleId,
        limit: 3,
      }).map(formatMemoryItem),
    });
  }

  return {
    proposals,
    pendingReviewItems: pendingReviewItems.map((item) => ({
      itemId: item.id,
      bundleId: item.bundleId,
      field: item.fieldKey,
      target: item.target,
      suggestedValue: normalizeString(item.suggestedValue),
      currentValue: normalizeString(item.currentValue),
      rationale: item.rationale,
      status: item.status,
      createdAt: item.createdAt,
      relatedMemory: selectRelevantMemoryItems(memoryItems, {
        fieldKey: item.fieldKey,
        sessionOrBundleId: item.bundleId,
        limit: 3,
      }).map(formatMemoryItem),
    })),
  };
}

function makeExtractedClaimProposals(
  repository,
  personId,
  profileSummary,
  evidenceById,
  existingProposals,
  memoryItems,
) {
  const proposals = [];
  const seen = new Set(existingProposals.map((item) => `${item.field}|${item.suggestedValue}`));
  const extractedClaims = repository.listClaimsForPerson(personId, { statuses: REVIEWABLE_CLAIM_STATUSES });

  for (const claim of extractedClaims) {
    const field = getFieldForClaimTypeKey(claim.claimTypeKey);
    const suggestedValue = normalizeString(claim.value);
    if (!field || !suggestedValue) continue;

    const dedupeKey = `${field}|${suggestedValue}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const supportingEvidenceIds = repository
      .listClaimEvidenceLinks(claim.id)
      .map((link) => link.evidenceId);
    const sourceDocumentIds = supportingEvidenceIds
      .map((evidenceId) => normalizeString(evidenceById.get(evidenceId)?.metadata?.documentId))
      .filter(Boolean);
    const currentValue = normalizeString(profileSummary[field]);

    proposals.push({
      field,
      currentValue,
      suggestedValue,
      rationale: `Extracted claim from ${claim.issuer || 'mio-core'} is awaiting review.`,
      confidence: confidenceLabel(claim.confidence),
      action: currentValue ? 'review-conflict' : 'fill-empty',
      sourceDocumentIds,
      supportingEvidenceIds,
      relatedMemory: selectRelevantMemoryItems(memoryItems, {
        fieldKey: field,
        limit: 3,
      }).map(formatMemoryItem),
    });
  }

  return proposals;
}

function loadGemmaContextCollections(repository, personId, generatedAt) {
  const person = repository.getPerson(personId);
  if (!person) {
    throw new Error(`Unknown person: ${personId}`);
  }

  return {
    person,
    profileSummary: buildProfileSummary(repository, personId),
    evidenceDigest: buildEvidenceDigest(repository, personId),
    evidenceById: buildEvidenceMaps(repository, personId).evidenceById,
    compiledIdentity: buildCompiledIdentitySummary(repository, personId, { generatedAt }),
    continuationTimeline: buildContinuationTimeline(repository, personId, { limit: 12 }),
    totalMemoryCount: repository.countMemoryItemsForPerson(personId),
    memoryItems: repository.listMemoryItemsForPerson(personId, { limit: 12 }),
    wikiEntries: repository
      .listWikiEntriesForPerson(personId, {
        statuses: ['verified', 'candidate', 'stale'],
        limit: 16,
      })
      .map(formatWikiEntry),
    activeGrants: repository.listGrantsForPerson(personId).filter((grant) => grant.status === 'active'),
  };
}

function buildGemmaProposals(repository, personId, profileSummary, evidenceById, memoryItems) {
  const pendingReview = makePendingReviewProposals(repository, personId, profileSummary, evidenceById, memoryItems);
  const extractedProposals = makeExtractedClaimProposals(
    repository,
    personId,
    profileSummary,
    evidenceById,
    pendingReview.proposals,
    memoryItems,
  );

  return {
    pendingReview,
    proposals: [...pendingReview.proposals, ...extractedProposals],
  };
}

export function buildGemmaCoreContext(repository, personId, { generatedAt = new Date().toISOString() } = {}) {
  const {
    person,
    profileSummary,
    evidenceDigest,
    evidenceById,
    compiledIdentity,
    continuationTimeline,
    totalMemoryCount,
    memoryItems,
    wikiEntries,
    activeGrants,
  } = loadGemmaContextCollections(repository, personId, generatedAt);
  const { pendingReview, proposals } = buildGemmaProposals(
    repository,
    personId,
    profileSummary,
    evidenceById,
    memoryItems,
  );

  return {
    schemaVersion: 'mio.gemma.core-context.v1',
    generatedAt,
    person: {
      id: person.id,
      displayName: person.displayName,
    },
    profileSummary,
    knowledgeCards: makeKnowledgeCards(
      person,
      compiledIdentity,
      profileSummary,
      evidenceDigest,
      pendingReview.pendingReviewItems,
      wikiEntries,
      activeGrants,
      memoryItems,
      totalMemoryCount,
    ),
    compiledIdentity,
    timeline: continuationTimeline,
    evidence: evidenceDigest,
    proposals,
    wikiEntries,
    pendingReview: pendingReview.pendingReviewItems,
    memory: memoryItems.map(formatMemoryItem),
    activeGrants: activeGrants.map((grant) => ({
      grantId: grant.id,
      purpose: grant.purpose,
      requesterId: grant.requesterId,
      expiresAt: grant.expiresAt,
      allowedFields: grant.scope?.allowedFields ?? [],
    })),
  };
}
