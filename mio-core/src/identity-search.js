import { PROFILE_CLAIM_TYPES, getFieldForClaimTypeKey } from './claim-types.js';
import { extractSnippetAroundNeedle, formatMemoryPreview, summarizeSnippet } from './memory-sidecar.js';
import { buildEvidenceDigest, buildEvidenceMaps } from './identity-compiler.js';
import {
  FIELD_DESCRIPTIONS,
  fieldSemanticTerms,
  normalizeIdentityText,
  normalizeLower,
  semanticAliasExpansion,
  titleizeIdentityField,
  tokenize,
  uniqueStrings,
} from './identity-context-shared.js';

function buildFieldDirectory() {
  return PROFILE_CLAIM_TYPES.map(([field, claimTypeKey, , sensitivityLevel, description]) => ({
    field,
    claimTypeKey,
    sensitivityLevel,
    description,
    semanticTerms: fieldSemanticTerms(field),
  }));
}

function createSearchRecord({
  id,
  type,
  title,
  fieldKey = '',
  text = '',
  previewText = '',
  sourceKind = '',
  sourceRef = '',
  sourceDocumentIds = [],
  supportingEvidenceIds = [],
  eventAt = '',
  status = '',
  semanticTerms = [],
}) {
  const searchText = uniqueStrings([title, fieldKey, text, previewText, sourceKind, status]).join(' ');
  return {
    id,
    type,
    title: normalizeIdentityText(title) || id,
    fieldKey: normalizeIdentityText(fieldKey),
    searchText,
    previewText: normalizeIdentityText(previewText) || normalizeIdentityText(text) || normalizeIdentityText(title),
    searchTokens: tokenize(searchText),
    sourceKind: normalizeIdentityText(sourceKind),
    sourceRef: normalizeIdentityText(sourceRef) || normalizeIdentityText(id),
    sourceDocumentIds: uniqueStrings(sourceDocumentIds),
    supportingEvidenceIds: uniqueStrings(supportingEvidenceIds),
    eventAt: normalizeIdentityText(eventAt),
    status: normalizeIdentityText(status),
    semanticTerms: uniqueStrings([
      ...semanticTerms,
      ...tokenize(title),
      ...tokenize(fieldKey),
      ...tokenize(text),
    ]),
  };
}

function buildClaimRecords(repository, personId, evidenceById, evidenceIdsByClaimId, claims) {
  return claims.map((claim) => {
    const field = getFieldForClaimTypeKey(claim.claimTypeKey);
    const supportingEvidenceIds = evidenceIdsByClaimId.get(claim.id) ?? [];
    const sourceDocumentIds = supportingEvidenceIds
      .map((evidenceId) => normalizeIdentityText(evidenceById.get(evidenceId)?.metadata?.documentId))
      .filter(Boolean);
    const value = normalizeIdentityText(claim.value);

    return createSearchRecord({
      id: claim.id,
      type: 'claim',
      title: `Claim · ${field ? titleizeIdentityField(field) : claim.claimTypeKey}`,
      fieldKey: field,
      text: [
        value,
        claim.claimTypeKey,
        normalizeIdentityText(claim.issuer),
        normalizeIdentityText(claim.status),
        FIELD_DESCRIPTIONS[field] ?? '',
      ].join(' '),
      previewText: value,
      sourceKind: 'claim',
      sourceRef: claim.id,
      sourceDocumentIds,
      supportingEvidenceIds,
      eventAt: normalizeIdentityText(claim.updatedAt),
      status: claim.status,
      semanticTerms: field ? fieldSemanticTerms(field) : [],
    });
  });
}

function buildEvidenceRecords(evidenceDigest) {
  return evidenceDigest.map((item) => {
    const entries = Object.entries(item.fields);
    const fieldTerms = entries.flatMap(([field]) => fieldSemanticTerms(field));
    const previewText =
      entries.map(([field, value]) => `${titleizeIdentityField(field)}: ${value}`).join(' · ') ||
      item.headline;

    return createSearchRecord({
      id: item.id,
      type: 'evidence',
      title: `Evidence · ${item.headline}`,
      text: [item.headline, previewText, item.kind].join(' '),
      previewText,
      sourceKind: item.kind,
      sourceRef: item.id,
      sourceDocumentIds: item.sourceDocumentIds,
      supportingEvidenceIds: item.supportingEvidenceIds,
      semanticTerms: fieldTerms,
    });
  });
}

function buildWikiRecords(repository, personId) {
  return repository
    .listWikiEntriesForPerson(personId, {
      statuses: ['verified', 'candidate', 'stale'],
    })
    .map((entry) =>
      createSearchRecord({
        id: entry.id,
        type: 'wiki',
        title: `Wiki · ${entry.title || titleizeIdentityField(entry.fieldKey)}`,
        fieldKey: entry.fieldKey,
        text: [
          entry.title,
          entry.summaryText,
          entry.valueText,
          entry.category,
          entry.status,
          entry.trustLevel,
        ].join(' '),
        previewText: entry.summaryText || entry.valueText || entry.title,
        sourceKind: 'wiki_entry',
        sourceRef: entry.id,
        sourceDocumentIds: entry.sourceDocumentIds,
        supportingEvidenceIds: entry.supportingEvidenceIds,
        eventAt: normalizeIdentityText(entry.updatedAt),
        status: entry.status,
        semanticTerms: fieldSemanticTerms(entry.fieldKey),
      }),
    );
}

function buildTimelineRecords(repository, personId) {
  return repository.listTimelineEntries(personId).map((entry) =>
    createSearchRecord({
      id: entry.id,
      type: 'timeline',
      title: `Timeline · ${entry.summary}`,
      text: [entry.summary, entry.detailMd, entry.source].join(' '),
      previewText: entry.detailMd || entry.summary,
      sourceKind: entry.source || 'timeline_entry',
      sourceRef: entry.id,
      eventAt: normalizeIdentityText(entry.eventDate) || normalizeIdentityText(entry.createdAt),
    }),
  );
}

function buildReviewRecords(repository, personId) {
  return repository.listPendingReviewItemsForPerson(personId).map((item) =>
    createSearchRecord({
      id: item.id,
      type: 'review',
      title: `Review · ${item.fieldKey}`,
      fieldKey: item.fieldKey,
      text: [
        normalizeIdentityText(item.fieldKey),
        normalizeIdentityText(item.target),
        normalizeIdentityText(item.suggestedValue),
        normalizeIdentityText(item.currentValue),
        normalizeIdentityText(item.rationale),
      ].join(' '),
      previewText: [
        normalizeIdentityText(item.suggestedValue)
          ? `suggested: ${normalizeIdentityText(item.suggestedValue)}`
          : '',
        normalizeIdentityText(item.currentValue)
          ? `current: ${normalizeIdentityText(item.currentValue)}`
          : '',
        normalizeIdentityText(item.rationale),
      ]
        .filter(Boolean)
        .join(' · '),
      sourceKind: 'review_item',
      sourceRef: item.id,
      sourceDocumentIds: item.sourceDocumentIds,
      supportingEvidenceIds: item.supportingEvidenceIds,
      eventAt: normalizeIdentityText(item.createdAt),
      status: item.status,
      semanticTerms: fieldSemanticTerms(item.fieldKey),
    }),
  );
}

function buildNoteRecords(repository, personId) {
  return repository.listMemoryItemsForPerson(personId, { limit: 64 }).map((item) =>
    createSearchRecord({
      id: item.id,
      type: 'note',
      title: `Note · ${item.title}`,
      fieldKey: item.fieldKey,
      text: [
        item.title,
        item.snippetText,
        item.rationale,
        item.kind,
        formatMemoryPreview(item),
      ].join(' '),
      previewText: item.snippetText || item.rationale || item.title,
      sourceKind: item.kind,
      sourceRef: item.id,
      eventAt: normalizeIdentityText(item.createdAt),
      semanticTerms: fieldSemanticTerms(item.fieldKey),
    }),
  );
}

function buildSearchRecords(repository, personId) {
  const { claims, evidenceById, evidenceIdsByClaimId } = buildEvidenceMaps(repository, personId);
  const evidenceDigest = buildEvidenceDigest(repository, personId);

  return [
    ...buildClaimRecords(repository, personId, evidenceById, evidenceIdsByClaimId, claims),
    ...buildEvidenceRecords(evidenceDigest),
    ...buildWikiRecords(repository, personId),
    ...buildTimelineRecords(repository, personId),
    ...buildReviewRecords(repository, personId),
    ...buildNoteRecords(repository, personId),
  ];
}

function scoreExact(record, query, fieldKey) {
  let score = 0;
  if (fieldKey && normalizeLower(record.fieldKey) === normalizeLower(fieldKey)) {
    score += 100;
  }
  if (!query) return score;

  const normalizedQuery = normalizeLower(query);
  if (!normalizedQuery) return score;

  if (normalizeLower(record.id) === normalizedQuery) score += 120;
  if (normalizeLower(record.fieldKey) === normalizedQuery) score += 110;
  if (normalizeLower(record.title) === normalizedQuery) score += 100;
  if (normalizeLower(record.previewText) === normalizedQuery) score += 90;
  if (record.sourceDocumentIds.some((value) => normalizeLower(value) === normalizedQuery)) score += 80;
  if (record.supportingEvidenceIds.some((value) => normalizeLower(value) === normalizedQuery)) score += 70;
  if (` ${normalizeLower(record.searchText)} `.includes(` ${normalizedQuery} `)) score += 60;
  if (normalizeLower(record.searchText).includes(normalizedQuery)) score += 30;
  return score;
}

function scoreKeyword(record, query, fieldKey) {
  const normalizedQuery = normalizeLower(query);
  const tokens = tokenize(query);
  let score = fieldKey && normalizeLower(record.fieldKey) === normalizeLower(fieldKey) ? 12 : 0;

  if (normalizedQuery && normalizeLower(record.searchText).includes(normalizedQuery)) {
    score += 15;
  }

  for (const token of tokens) {
    if (record.searchTokens.includes(token)) {
      score += 5;
    }
    if (normalizeLower(record.title).includes(token)) {
      score += 3;
    }
    if (normalizeLower(record.previewText).includes(token)) {
      score += 2;
    }
  }

  return score;
}

function scoreSemantic(record, query, fieldKey) {
  const queryTokens = tokenize(query);
  const expandedTokens = new Set(
    uniqueStrings([
      ...queryTokens,
      ...queryTokens.flatMap((token) => semanticAliasExpansion(token)),
      fieldKey,
      ...fieldSemanticTerms(fieldKey),
    ]).flatMap((value) => tokenize(value)),
  );

  let overlap = 0;
  for (const token of expandedTokens) {
    if (record.semanticTerms.includes(token)) {
      overlap += 1;
    }
  }

  const lexicalHits = queryTokens.filter((token) => record.searchTokens.includes(token)).length;
  const titleHits = queryTokens.filter((token) => normalizeLower(record.title).includes(token)).length;
  return overlap * 8 + lexicalHits * 4 + titleHits * 2;
}

function formatSearchResult(record, query, score) {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    fieldKey: record.fieldKey,
    excerpt: query
      ? extractSnippetAroundNeedle(record.previewText || record.searchText, query, { maxLength: 220 })
      : summarizeSnippet(record.previewText || record.searchText, 220),
    sourceKind: record.sourceKind,
    sourceRef: record.sourceRef,
    sourceDocumentIds: record.sourceDocumentIds,
    supportingEvidenceIds: record.supportingEvidenceIds,
    eventAt: record.eventAt,
    status: record.status,
    score,
  };
}

function pickSearchScorer(mode) {
  if (mode === 'exact') return scoreExact;
  if (mode === 'semantic') return scoreSemantic;
  return scoreKeyword;
}

export function searchPersonContext(
  repository,
  personId,
  { mode = 'keyword', query = '', fieldKey = '', limit = 10 } = {},
) {
  const person = repository.getPerson(personId);
  if (!person) {
    throw new Error(`Unknown person: ${personId}`);
  }

  const supportedModes = new Set(['exact', 'keyword', 'semantic']);
  if (!supportedModes.has(mode)) {
    throw new Error(`Unsupported search mode: ${mode}`);
  }

  const normalizedQuery = normalizeIdentityText(query);
  const normalizedFieldKey = normalizeIdentityText(fieldKey);
  if (!normalizedQuery && !normalizedFieldKey) {
    throw new Error('Provide --query or --field-key when searching person context.');
  }

  const scored = buildSearchRecords(repository, personId)
    .map((record) => ({
      record,
      score: pickSearchScorer(mode)(record, normalizedQuery, normalizedFieldKey),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDate = Date.parse(left.record.eventAt);
      const rightDate = Date.parse(right.record.eventAt);
      if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate) && rightDate !== leftDate) {
        return rightDate - leftDate;
      }
      return right.record.id.localeCompare(left.record.id);
    });

  return {
    mode,
    query: normalizedQuery,
    fieldKey: normalizedFieldKey,
    totalHits: scored.length,
    fieldDirectory: buildFieldDirectory(),
    results: scored.slice(0, Math.max(limit, 0)).map((item) => formatSearchResult(item.record, normalizedQuery, item.score)),
  };
}
