import { getFieldForClaimTypeKey } from './claim-types.js';
import { summarizeSnippet } from './memory-sidecar.js';
import {
  REVIEWABLE_CLAIM_STATUSES,
  STABLE_CLAIM_STATUSES,
  countBy,
  fieldSemanticTerms,
  maxIsoDate,
  normalizeIdentityText,
  titleizeIdentityField,
  uniqueStrings,
} from './identity-context-shared.js';

function ensurePerson(repository, personId) {
  const person = repository.getPerson(personId);
  if (!person) {
    throw new Error(`Unknown person: ${personId}`);
  }
  return person;
}

function listContextWikiEntries(repository, personId) {
  return repository.listWikiEntriesForPerson(personId, {
    statuses: ['verified', 'candidate', 'stale'],
  });
}

function listActiveGrants(repository, personId) {
  return repository.listGrantsForPerson(personId).filter((grant) => grant.status === 'active');
}

function buildTimelineEvent(entry) {
  return {
    id: entry.id,
    eventType: 'timeline_entry',
    eventAt: normalizeIdentityText(entry.eventDate) || normalizeIdentityText(entry.createdAt),
    title: normalizeIdentityText(entry.summary) || 'Identity event',
    detail: summarizeSnippet(entry.detailMd || entry.source || '', 240),
    sourceKind: normalizeIdentityText(entry.source) || 'timeline_entry',
    sourceRef: entry.id,
  };
}

function buildGrantEvent(grant) {
  return {
    id: grant.id,
    eventType: 'grant',
    eventAt: normalizeIdentityText(grant.grantedAt) || normalizeIdentityText(grant.createdAt),
    title: `Grant ${grant.status} · ${normalizeIdentityText(grant.purpose) || grant.id}`,
    detail: summarizeSnippet(
      [
        `requester: ${normalizeIdentityText(grant.requesterId) || 'unknown'}`,
        `allowed fields: ${(grant.scope?.allowedFields ?? []).length}`,
        grant.expiresAt ? `expires: ${grant.expiresAt}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      240,
    ),
    sourceKind: 'grant',
    sourceRef: grant.id,
  };
}

function buildReviewDecisionEvents(repository, personId) {
  const reviewItemsById = new Map();
  for (const bundle of repository.listReviewBundlesForPerson(personId)) {
    for (const item of repository.listReviewItemsForBundle(bundle.id)) {
      reviewItemsById.set(item.id, item);
    }
  }

  return repository.listReviewDecisionsForPerson(personId).map((decision) => {
    const item = reviewItemsById.get(decision.reviewItemId);
    const fieldLabel = normalizeIdentityText(item?.fieldKey) || 'field';
    const suggestedValue = normalizeIdentityText(item?.suggestedValue);
    const currentValue = normalizeIdentityText(item?.currentValue);

    return {
      id: decision.id,
      eventType: 'review_decision',
      eventAt: normalizeIdentityText(decision.createdAt),
      title: `Review ${decision.decision} · ${fieldLabel}`,
      detail: summarizeSnippet(
        [
          suggestedValue ? `suggested: ${suggestedValue}` : '',
          currentValue ? `current: ${currentValue}` : '',
          normalizeIdentityText(decision.note),
        ]
          .filter(Boolean)
          .join(' · '),
        240,
      ),
      sourceKind: 'review_decision',
      sourceRef: decision.id,
    };
  });
}

function buildWikiEvents(repository, personId) {
  const wikiEntriesById = new Map(listContextWikiEntries(repository, personId).map((entry) => [entry.id, entry]));

  return repository.listWikiEventsForPerson(personId).map((event) => {
    const entry = wikiEntriesById.get(event.entryId);
    const titleSource =
      normalizeIdentityText(entry?.title) ||
      normalizeIdentityText(entry?.fieldKey) ||
      normalizeIdentityText(event.entryId);

    return {
      id: event.id,
      eventType: 'wiki_event',
      eventAt: normalizeIdentityText(event.createdAt),
      title: `Wiki ${normalizeIdentityText(event.action) || 'updated'} · ${titleSource}`,
      detail: summarizeSnippet(
        [
          normalizeIdentityText(event.payload?.nextStatus),
          normalizeIdentityText(entry?.summaryText),
          normalizeIdentityText(entry?.valueText),
        ]
          .filter(Boolean)
          .join(' · '),
        240,
      ),
      sourceKind: 'wiki_event',
      sourceRef: event.id,
    };
  });
}

export function buildProfileSummary(repository, personId) {
  const claims = repository.listClaimsForPerson(personId, { statuses: STABLE_CLAIM_STATUSES });
  const summary = {};

  for (const claim of claims) {
    const field = getFieldForClaimTypeKey(claim.claimTypeKey);
    const value = normalizeIdentityText(claim.value);
    if (!field || !value || summary[field]) continue;
    summary[field] = value;
  }

  return summary;
}

export function buildEvidenceMaps(repository, personId) {
  const claims = repository.listClaimsForPerson(personId);
  const evidenceIdsByClaimId = new Map();
  const evidenceById = new Map();

  for (const evidence of repository.listEvidenceForPerson(personId)) {
    evidenceById.set(evidence.id, evidence);
  }

  for (const claim of claims) {
    const links = repository.listClaimEvidenceLinks(claim.id);
    evidenceIdsByClaimId.set(
      claim.id,
      links.map((link) => link.evidenceId),
    );
  }

  return {
    claims,
    evidenceById,
    evidenceIdsByClaimId,
  };
}

export function buildEvidenceDigest(repository, personId) {
  const { claims, evidenceById, evidenceIdsByClaimId } = buildEvidenceMaps(repository, personId);
  const claimsByEvidenceId = new Map();

  for (const claim of claims) {
    const field = getFieldForClaimTypeKey(claim.claimTypeKey);
    const value = normalizeIdentityText(claim.value);
    if (!field || !value) continue;

    for (const evidenceId of evidenceIdsByClaimId.get(claim.id) ?? []) {
      const existing = claimsByEvidenceId.get(evidenceId) ?? [];
      existing.push({ claim, field, value });
      claimsByEvidenceId.set(evidenceId, existing);
    }
  }

  return [...evidenceById.values()].map((evidence) => {
    const supportingClaims = claimsByEvidenceId.get(evidence.id) ?? [];
    const fields = {};
    const sourceDocumentIds = [];

    for (const item of supportingClaims) {
      if (!fields[item.field]) {
        fields[item.field] = item.value;
      }
    }

    const metadataDocumentId = normalizeIdentityText(evidence.metadata?.documentId);
    if (metadataDocumentId) {
      sourceDocumentIds.push(metadataDocumentId);
    }

    const headline =
      normalizeIdentityText(evidence.sourceName) ||
      normalizeIdentityText(evidence.storageUri) ||
      evidence.kind;
    const confidenceScores = supportingClaims
      .map((item) => item.claim.confidence)
      .filter((value) => typeof value === 'number');

    return {
      id: evidence.id,
      kind: evidence.kind,
      headline,
      confidence: confidenceScores.length > 0 ? Math.max(...confidenceScores) : null,
      fields,
      sourceDocumentIds,
      supportingEvidenceIds: [evidence.id],
    };
  });
}

export function buildCompiledIdentitySummary(repository, personId, { generatedAt = new Date().toISOString() } = {}) {
  const person = ensurePerson(repository, personId);
  const profileSummary = buildProfileSummary(repository, personId);
  const stableClaims = repository.listClaimsForPerson(personId, { statuses: STABLE_CLAIM_STATUSES });
  const extractedClaims = repository.listClaimsForPerson(personId, { statuses: REVIEWABLE_CLAIM_STATUSES });
  const pendingReviewItems = repository.listPendingReviewItemsForPerson(personId);
  const pendingBundles = repository.listReviewBundlesForPerson(personId, {
    statuses: ['pending', 'partially_applied'],
  });
  const wikiEntries = listContextWikiEntries(repository, personId);
  const activeGrants = listActiveGrants(repository, personId);
  const timelineEntries = repository.listTimelineEntries(personId);
  const wikiCounts = countBy(wikiEntries, (entry) => entry.status);
  const attentionFields = uniqueStrings([
    ...pendingReviewItems.map((item) => item.fieldKey),
    ...wikiEntries
      .filter((entry) => entry.status === 'candidate' || entry.status === 'stale')
      .map((entry) => entry.fieldKey),
  ]).slice(0, 8);
  const headlineParts = [
    uniqueStrings([profileSummary.firstName, profileSummary.lastName]).join(' '),
    profileSummary.passportNo,
    profileSummary.nationality,
    profileSummary.dateOfBirth,
  ].filter(Boolean);
  const lastUpdatedAt = maxIsoDate(
    [
      person.updatedAt,
      ...stableClaims.map((claim) => claim.updatedAt),
      ...extractedClaims.map((claim) => claim.updatedAt),
      ...pendingReviewItems.map((item) => item.createdAt),
      ...wikiEntries.map((entry) => entry.updatedAt),
      ...activeGrants.map((grant) => grant.createdAt),
      ...timelineEntries.flatMap((entry) => [entry.eventDate, entry.createdAt]),
    ],
    generatedAt,
  );

  const summaryLines = [
    `${stableClaims.length} stable identity fields are currently accepted into Mio Core.`,
    pendingReviewItems.length > 0
      ? `${pendingReviewItems.length} review items across ${pendingBundles.length} bundle(s) still need a merge or dismissal decision.`
      : 'No pending review items are currently blocking canonical identity state.',
    wikiEntries.length > 0
      ? `Identity wiki holds ${(wikiCounts.verified ?? 0)} verified, ${(wikiCounts.candidate ?? 0)} candidate, and ${(wikiCounts.stale ?? 0)} stale entries.`
      : 'No identity wiki entries are currently attached to this subject.',
    activeGrants.length > 0
      ? `${activeGrants.length} active grant(s) remain live for downstream executors.`
      : 'There are no active grants at the moment.',
  ];

  return {
    headlineText: headlineParts.join(' · ') || person.displayName,
    summaryText: summaryLines.join(' '),
    summaryLines,
    stableFieldCount: stableClaims.length,
    extractedFieldCount: extractedClaims.length,
    pendingReviewCount: pendingReviewItems.length,
    pendingBundleCount: pendingBundles.length,
    wikiEntryCount: wikiEntries.length,
    activeGrantCount: activeGrants.length,
    attentionFields,
    lastUpdatedAt,
  };
}

export function buildContinuationTimeline(repository, personId, { limit = 12 } = {}) {
  ensurePerson(repository, personId);

  return [
    ...repository.listTimelineEntries(personId).map(buildTimelineEvent),
    ...buildReviewDecisionEvents(repository, personId),
    ...buildWikiEvents(repository, personId),
    ...repository.listGrantsForPerson(personId).map(buildGrantEvent),
  ]
    .filter((item) => item.eventAt)
    .sort((left, right) => {
      const leftScore = Date.parse(left.eventAt);
      const rightScore = Date.parse(right.eventAt);
      if (Number.isNaN(leftScore) && Number.isNaN(rightScore)) {
        return right.id.localeCompare(left.id);
      }
      if (Number.isNaN(leftScore)) return 1;
      if (Number.isNaN(rightScore)) return -1;
      return rightScore - leftScore || right.id.localeCompare(left.id);
    })
    .slice(0, Math.max(limit, 0));
}

export { REVIEWABLE_CLAIM_STATUSES, STABLE_CLAIM_STATUSES, fieldSemanticTerms, titleizeIdentityField };
