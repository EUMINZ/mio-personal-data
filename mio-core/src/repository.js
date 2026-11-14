import { randomUUID } from 'node:crypto';
import { buildDefaultClaimTypes, getClaimTypeKeyForField } from './claim-types.js';
import { decodeJson, encodeJson, nowIso, transaction } from './db.js';

function createId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function normalizeClaimRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    personId: row.person_id,
    claimTypeId: row.claim_type_id,
    claimTypeKey: row.claim_type_key,
    value: decodeJson(row.value_json),
    status: row.status,
    confidence: row.confidence,
    issuer: row.issuer,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    supersededByClaimId: row.superseded_by_claim_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeEvidenceRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    personId: row.person_id,
    kind: row.kind,
    storageUri: row.storage_uri,
    mimeType: row.mime_type,
    sha256: row.sha256,
    sourceSystem: row.source_system,
    sourceName: row.source_name,
    capturedAt: row.captured_at,
    metadata: decodeJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function normalizeGrantRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    personId: row.person_id,
    requesterId: row.requester_id,
    purpose: row.purpose,
    status: row.status,
    service: decodeJson(row.service_json, {}),
    scope: decodeJson(row.scope_json, {}),
    actions: decodeJson(row.actions_json, []),
    policy: decodeJson(row.policy_json, {}),
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

function normalizeReviewBundleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    personId: row.person_id,
    sourceBundleId: row.source_bundle_id,
    sourceSystem: row.source_system,
    producer: row.producer,
    stageKey: row.stage_key,
    stageLabel: row.stage_label,
    source: decodeJson(row.source_json, {}),
    summary: decodeJson(row.summary_json, {}),
    requestedFields: decodeJson(row.requested_fields_json, []),
    injectedFields: decodeJson(row.injected_fields_json, []),
    pageProfile: decodeJson(row.page_profile_json, {}),
    tripRecord: decodeJson(row.trip_record_json, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeReviewItemRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bundleId: row.bundle_id,
    personId: row.person_id,
    itemType: row.item_type,
    fieldKey: row.field_key,
    target: row.target,
    suggestedValue: decodeJson(row.suggested_value_json),
    currentValue: decodeJson(row.current_value_json),
    rationale: row.rationale,
    sourceDocumentIds: decodeJson(row.source_document_ids_json, []),
    supportingEvidenceIds: decodeJson(row.supporting_evidence_ids_json, []),
    metadata: decodeJson(row.metadata_json, {}),
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedByActorType: row.resolved_by_actor_type,
    resolvedByActorId: row.resolved_by_actor_id,
    resolutionNote: row.resolution_note,
    appliedClaimId: row.applied_claim_id,
  };
}

function normalizeReviewDecisionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    reviewItemId: row.review_item_id,
    bundleId: row.bundle_id,
    personId: row.person_id,
    decision: row.decision,
    actorType: row.actor_type,
    actorId: row.actor_id,
    note: row.note,
    appliedClaimId: row.applied_claim_id,
    createdAt: row.created_at,
  };
}

function normalizeMemoryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    personId: row.person_id,
    kind: row.kind,
    fieldKey: row.field_key,
    serviceKey: row.service_key,
    sessionOrBundleId: row.session_or_bundle_id,
    title: row.title,
    snippetText: row.snippet_text,
    rationale: row.rationale,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    sourceLocator: row.source_locator,
    confidence: row.confidence,
    metadata: decodeJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function normalizeWikiEntryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    personId: row.person_id,
    title: row.title,
    category: row.category,
    fieldKey: row.field_key,
    valueText: row.value_text,
    summaryText: row.summary_text,
    status: row.status,
    trustLevel: row.trust_level,
    autofillEligible: Boolean(row.autofill_eligible),
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    sourceLocator: row.source_locator,
    sourceDocumentIds: decodeJson(row.source_document_ids_json, []),
    supportingEvidenceIds: decodeJson(row.supporting_evidence_ids_json, []),
    tags: decodeJson(row.tags_json, []),
    metadata: decodeJson(row.metadata_json, {}),
    reviewedAt: row.reviewed_at,
    supersededByEntryId: row.superseded_by_entry_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeWikiEventRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    personId: row.person_id,
    entryId: row.entry_id,
    action: row.action,
    actorType: row.actor_type,
    actorId: row.actor_id,
    payload: decodeJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function stringifyValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(value);
}

function buildDynamicInClause(values) {
  return values.map(() => '?').join(', ');
}

export function createCoreRepository(db) {
  return {
    registerDefaultClaimTypes() {
      const stmt = db.prepare(`
        INSERT INTO claim_types (id, key, value_type, sensitivity_level, description)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_type = excluded.value_type,
          sensitivity_level = excluded.sensitivity_level,
          description = excluded.description
      `);

      for (const claimType of buildDefaultClaimTypes()) {
        stmt.run(
          claimType.id,
          claimType.key,
          claimType.valueType,
          claimType.sensitivityLevel,
          claimType.description,
        );
      }
    },

    createPerson({ id = createId('person'), displayName, createdAt = nowIso(), updatedAt = createdAt }) {
      const row = db
        .prepare(`
          INSERT INTO persons (id, display_name, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          RETURNING id, display_name, created_at, updated_at
        `)
        .get(id, displayName, createdAt, updatedAt);

      return {
        id: row.id,
        displayName: row.display_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    getPerson(personId) {
      const row = db
        .prepare('SELECT id, display_name, created_at, updated_at FROM persons WHERE id = ?')
        .get(personId);

      if (!row) return null;
      return {
        id: row.id,
        displayName: row.display_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    listPersons() {
      return db
        .prepare('SELECT id, display_name, created_at, updated_at FROM persons ORDER BY created_at ASC')
        .all()
        .map((row) => ({
          id: row.id,
          displayName: row.display_name,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
    },

    getClaimTypeByKey(key) {
      const row = db
        .prepare('SELECT id, key, value_type, sensitivity_level, description FROM claim_types WHERE key = ?')
        .get(key);

      if (!row) return null;
      return {
        id: row.id,
        key: row.key,
        valueType: row.value_type,
        sensitivityLevel: row.sensitivity_level,
        description: row.description,
      };
    },

    createClaim({
      id = createId('claim'),
      personId,
      claimTypeKey,
      value,
      status,
      confidence = null,
      issuer = null,
      observedAt = null,
      expiresAt = null,
      supersededByClaimId = null,
      createdAt = nowIso(),
      updatedAt = createdAt,
    }) {
      const claimType = this.getClaimTypeByKey(claimTypeKey);
      if (!claimType) {
        throw new Error(`Unknown claim type: ${claimTypeKey}`);
      }

      const row = db
        .prepare(`
          INSERT INTO claims (
            id, person_id, claim_type_id, value_json, status, confidence, issuer,
            observed_at, expires_at, superseded_by_claim_id, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING
            id,
            person_id,
            claim_type_id,
            ? AS claim_type_key,
            value_json,
            status,
            confidence,
            issuer,
            observed_at,
            expires_at,
            superseded_by_claim_id,
            created_at,
            updated_at
        `)
        .get(
          id,
          personId,
          claimType.id,
          encodeJson(value),
          status,
          confidence,
          issuer,
          observedAt,
          expiresAt,
          supersededByClaimId,
          createdAt,
          updatedAt,
          claimType.key,
        );

      return normalizeClaimRow(row);
    },

    listClaimsForPerson(personId, { statuses = null } = {}) {
      let query = `
        SELECT
          claims.id,
          claims.person_id,
          claims.claim_type_id,
          claim_types.key AS claim_type_key,
          claims.value_json,
          claims.status,
          claims.confidence,
          claims.issuer,
          claims.observed_at,
          claims.expires_at,
          claims.superseded_by_claim_id,
          claims.created_at,
          claims.updated_at
        FROM claims
        JOIN claim_types ON claim_types.id = claims.claim_type_id
        WHERE claims.person_id = ?
      `;
      const params = [personId];

      if (Array.isArray(statuses) && statuses.length > 0) {
        query += ` AND claims.status IN (${statuses.map(() => '?').join(', ')})`;
        params.push(...statuses);
      }

      query += ' ORDER BY claim_types.key ASC, claims.updated_at DESC';
      return db.prepare(query).all(...params).map(normalizeClaimRow);
    },

    getLatestClaimForType(personId, claimTypeKey, statuses = ['confirmed', 'verified', 'asserted']) {
      const row = db
        .prepare(`
          SELECT
            claims.id,
            claims.person_id,
            claims.claim_type_id,
            claim_types.key AS claim_type_key,
            claims.value_json,
            claims.status,
            claims.confidence,
            claims.issuer,
            claims.observed_at,
            claims.expires_at,
            claims.superseded_by_claim_id,
            claims.created_at,
            claims.updated_at
          FROM claims
          JOIN claim_types ON claim_types.id = claims.claim_type_id
          WHERE claims.person_id = ?
            AND claim_types.key = ?
            AND claims.status IN (${statuses.map(() => '?').join(', ')})
          ORDER BY claims.updated_at DESC
          LIMIT 1
        `)
        .get(personId, claimTypeKey, ...statuses);

      return normalizeClaimRow(row);
    },

    createEvidence({
      id = createId('evidence'),
      personId,
      kind,
      storageUri,
      mimeType,
      sha256 = null,
      sourceSystem = null,
      sourceName = null,
      capturedAt = null,
      metadata = {},
      createdAt = nowIso(),
    }) {
      const row = db
        .prepare(`
          INSERT INTO evidence (
            id, person_id, kind, storage_uri, mime_type, sha256, source_system,
            source_name, captured_at, metadata_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING
            id, person_id, kind, storage_uri, mime_type, sha256, source_system,
            source_name, captured_at, metadata_json, created_at
        `)
        .get(
          id,
          personId,
          kind,
          storageUri,
          mimeType,
          sha256,
          sourceSystem,
          sourceName,
          capturedAt,
          encodeJson(metadata),
          createdAt,
        );

      return normalizeEvidenceRow(row);
    },

    listEvidenceForPerson(personId) {
      return db
        .prepare(`
          SELECT
            id, person_id, kind, storage_uri, mime_type, sha256, source_system,
            source_name, captured_at, metadata_json, created_at
          FROM evidence
          WHERE person_id = ?
          ORDER BY created_at DESC
        `)
        .all(personId)
        .map(normalizeEvidenceRow);
    },

    linkClaimEvidence({
      id = createId('claim_evidence_link'),
      claimId,
      evidenceId,
      relationType,
      note = '',
    }) {
      const row = db
        .prepare(`
          INSERT INTO claim_evidence_links (id, claim_id, evidence_id, relation_type, note)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(claim_id, evidence_id, relation_type) DO UPDATE SET note = excluded.note
          RETURNING id, claim_id, evidence_id, relation_type, note
        `)
        .get(id, claimId, evidenceId, relationType, note);

      return {
        id: row.id,
        claimId: row.claim_id,
        evidenceId: row.evidence_id,
        relationType: row.relation_type,
        note: row.note,
      };
    },

    listClaimEvidenceLinks(claimId) {
      return db
        .prepare(`
          SELECT id, claim_id, evidence_id, relation_type, note
          FROM claim_evidence_links
          WHERE claim_id = ?
          ORDER BY relation_type ASC
        `)
        .all(claimId)
        .map((row) => ({
          id: row.id,
          claimId: row.claim_id,
          evidenceId: row.evidence_id,
          relationType: row.relation_type,
          note: row.note,
        }));
    },

    createRequester({
      id = createId('requester'),
      name,
      origin = null,
      publicKeyOrIdentifier,
      createdAt = nowIso(),
    }) {
      const row = db
        .prepare(`
          INSERT INTO requesters (id, name, origin, public_key_or_identifier, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(public_key_or_identifier) DO UPDATE SET
            name = excluded.name,
            origin = excluded.origin
          RETURNING id, name, origin, public_key_or_identifier, created_at
        `)
        .get(id, name, origin, publicKeyOrIdentifier, createdAt);

      return {
        id: row.id,
        name: row.name,
        origin: row.origin,
        publicKeyOrIdentifier: row.public_key_or_identifier,
        createdAt: row.created_at,
      };
    },

    findRequesterByIdentifier(identifier) {
      const row = db
        .prepare('SELECT id, name, origin, public_key_or_identifier, created_at FROM requesters WHERE public_key_or_identifier = ?')
        .get(identifier);

      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        origin: row.origin,
        publicKeyOrIdentifier: row.public_key_or_identifier,
        createdAt: row.created_at,
      };
    },

    createGrant({
      id = createId('grant'),
      personId,
      requesterId,
      purpose,
      status,
      service = {},
      scope = {},
      actions = [],
      policy = {},
      grantedAt = null,
      expiresAt = null,
      revokedAt = null,
      createdAt = nowIso(),
    }) {
      const row = db
        .prepare(`
          INSERT INTO grants (
            id, person_id, requester_id, purpose, status, service_json, scope_json,
            actions_json, policy_json, granted_at, expires_at, revoked_at, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING
            id, person_id, requester_id, purpose, status, service_json, scope_json,
            actions_json, policy_json, granted_at, expires_at, revoked_at, created_at
        `)
        .get(
          id,
          personId,
          requesterId,
          purpose,
          status,
          encodeJson(service),
          encodeJson(scope),
          encodeJson(actions),
          encodeJson(policy),
          grantedAt,
          expiresAt,
          revokedAt,
          createdAt,
        );

      return normalizeGrantRow(row);
    },

    listGrantsForPerson(personId) {
      return db
        .prepare(`
          SELECT
            id, person_id, requester_id, purpose, status, service_json, scope_json,
            actions_json, policy_json, granted_at, expires_at, revoked_at, created_at
          FROM grants
          WHERE person_id = ?
          ORDER BY created_at DESC
        `)
        .all(personId)
        .map(normalizeGrantRow);
    },

    revokeGrant(grantId, revokedAt = nowIso()) {
      const row = db
        .prepare(`
          UPDATE grants
          SET status = 'revoked', revoked_at = ?
          WHERE id = ?
          RETURNING
            id, person_id, requester_id, purpose, status, service_json, scope_json,
            actions_json, policy_json, granted_at, expires_at, revoked_at, created_at
        `)
        .get(revokedAt, grantId);

      return normalizeGrantRow(row);
    },

    attachGrantClaim({
      id = createId('grant_claim'),
      grantId,
      claimId,
      accessMode,
    }) {
      const row = db
        .prepare(`
          INSERT INTO grant_claims (id, grant_id, claim_id, access_mode)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(grant_id, claim_id, access_mode) DO NOTHING
          RETURNING id, grant_id, claim_id, access_mode
        `)
        .get(id, grantId, claimId, accessMode);

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        grantId: row.grant_id,
        claimId: row.claim_id,
        accessMode: row.access_mode,
      };
    },

    listGrantClaims(grantId) {
      return db
        .prepare(`
          SELECT
            grant_claims.id,
            grant_claims.grant_id,
            grant_claims.claim_id,
            grant_claims.access_mode,
            claim_types.key AS claim_type_key
          FROM grant_claims
          JOIN claims ON claims.id = grant_claims.claim_id
          JOIN claim_types ON claim_types.id = claims.claim_type_id
          WHERE grant_claims.grant_id = ?
          ORDER BY claim_types.key ASC
        `)
        .all(grantId)
        .map((row) => ({
          id: row.id,
          grantId: row.grant_id,
          claimId: row.claim_id,
          accessMode: row.access_mode,
          claimTypeKey: row.claim_type_key,
        }));
    },

    createReviewBundle({
      id = createId('review_bundle'),
      personId,
      sourceBundleId = null,
      sourceSystem,
      producer = null,
      stageKey = null,
      stageLabel = null,
      source = {},
      summary = {},
      requestedFields = [],
      injectedFields = [],
      pageProfile = {},
      tripRecord = {},
      status = 'pending',
      createdAt = nowIso(),
      updatedAt = createdAt,
    }) {
      const row = db
        .prepare(`
          INSERT INTO review_bundles (
            id, person_id, source_bundle_id, source_system, producer, stage_key, stage_label,
            source_json, summary_json, requested_fields_json, injected_fields_json,
            page_profile_json, trip_record_json, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING
            id, person_id, source_bundle_id, source_system, producer, stage_key, stage_label,
            source_json, summary_json, requested_fields_json, injected_fields_json,
            page_profile_json, trip_record_json, status, created_at, updated_at
        `)
        .get(
          id,
          personId,
          sourceBundleId,
          sourceSystem,
          producer,
          stageKey,
          stageLabel,
          encodeJson(source),
          encodeJson(summary),
          encodeJson(requestedFields),
          encodeJson(injectedFields),
          encodeJson(pageProfile),
          encodeJson(tripRecord),
          status,
          createdAt,
          updatedAt,
        );

      return normalizeReviewBundleRow(row);
    },

    getReviewBundle(bundleId) {
      const row = db
        .prepare(`
          SELECT
            id, person_id, source_bundle_id, source_system, producer, stage_key, stage_label,
            source_json, summary_json, requested_fields_json, injected_fields_json,
            page_profile_json, trip_record_json, status, created_at, updated_at
          FROM review_bundles
          WHERE id = ?
        `)
        .get(bundleId);

      return normalizeReviewBundleRow(row);
    },

    findReviewBundleBySourceBundleId(sourceBundleId) {
      const row = db
        .prepare(`
          SELECT
            id, person_id, source_bundle_id, source_system, producer, stage_key, stage_label,
            source_json, summary_json, requested_fields_json, injected_fields_json,
            page_profile_json, trip_record_json, status, created_at, updated_at
          FROM review_bundles
          WHERE source_bundle_id = ?
        `)
        .get(sourceBundleId);

      return normalizeReviewBundleRow(row);
    },

    listReviewBundlesForPerson(personId, { statuses = null } = {}) {
      let query = `
        SELECT
          id, person_id, source_bundle_id, source_system, producer, stage_key, stage_label,
          source_json, summary_json, requested_fields_json, injected_fields_json,
          page_profile_json, trip_record_json, status, created_at, updated_at
        FROM review_bundles
        WHERE person_id = ?
      `;
      const params = [personId];

      if (Array.isArray(statuses) && statuses.length > 0) {
        query += ` AND status IN (${buildDynamicInClause(statuses)})`;
        params.push(...statuses);
      }

      query += ' ORDER BY created_at DESC';
      return db.prepare(query).all(...params).map(normalizeReviewBundleRow);
    },

    updateReviewBundleStatus(bundleId, status, updatedAt = nowIso()) {
      const row = db
        .prepare(`
          UPDATE review_bundles
          SET status = ?, updated_at = ?
          WHERE id = ?
          RETURNING
            id, person_id, source_bundle_id, source_system, producer, stage_key, stage_label,
            source_json, summary_json, requested_fields_json, injected_fields_json,
            page_profile_json, trip_record_json, status, created_at, updated_at
        `)
        .get(status, updatedAt, bundleId);

      return normalizeReviewBundleRow(row);
    },

    createReviewItem({
      id = createId('review_item'),
      bundleId,
      personId,
      itemType,
      fieldKey,
      target,
      suggestedValue,
      currentValue = null,
      rationale = '',
      sourceDocumentIds = [],
      supportingEvidenceIds = [],
      metadata = {},
      status = 'pending',
      createdAt = nowIso(),
      resolvedAt = null,
      resolvedByActorType = null,
      resolvedByActorId = null,
      resolutionNote = '',
      appliedClaimId = null,
    }) {
      const row = db
        .prepare(`
          INSERT INTO review_items (
            id, bundle_id, person_id, item_type, field_key, target, suggested_value_json,
            current_value_json, rationale, source_document_ids_json,
            supporting_evidence_ids_json, metadata_json, status, created_at, resolved_at,
            resolved_by_actor_type, resolved_by_actor_id, resolution_note, applied_claim_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING
            id, bundle_id, person_id, item_type, field_key, target, suggested_value_json,
            current_value_json, rationale, source_document_ids_json,
            supporting_evidence_ids_json, metadata_json, status, created_at, resolved_at,
            resolved_by_actor_type, resolved_by_actor_id, resolution_note, applied_claim_id
        `)
        .get(
          id,
          bundleId,
          personId,
          itemType,
          fieldKey,
          target,
          encodeJson(suggestedValue),
          currentValue === null ? null : encodeJson(currentValue),
          rationale,
          encodeJson(sourceDocumentIds),
          encodeJson(supportingEvidenceIds),
          encodeJson(metadata),
          status,
          createdAt,
          resolvedAt,
          resolvedByActorType,
          resolvedByActorId,
          resolutionNote,
          appliedClaimId,
        );

      return normalizeReviewItemRow(row);
    },

    getReviewItem(reviewItemId) {
      const row = db
        .prepare(`
          SELECT
            id, bundle_id, person_id, item_type, field_key, target, suggested_value_json,
            current_value_json, rationale, source_document_ids_json,
            supporting_evidence_ids_json, metadata_json, status, created_at, resolved_at,
            resolved_by_actor_type, resolved_by_actor_id, resolution_note, applied_claim_id
          FROM review_items
          WHERE id = ?
        `)
        .get(reviewItemId);

      return normalizeReviewItemRow(row);
    },

    listReviewItemsForBundle(bundleId, { statuses = null } = {}) {
      let query = `
        SELECT
          id, bundle_id, person_id, item_type, field_key, target, suggested_value_json,
          current_value_json, rationale, source_document_ids_json,
          supporting_evidence_ids_json, metadata_json, status, created_at, resolved_at,
          resolved_by_actor_type, resolved_by_actor_id, resolution_note, applied_claim_id
        FROM review_items
        WHERE bundle_id = ?
      `;
      const params = [bundleId];

      if (Array.isArray(statuses) && statuses.length > 0) {
        query += ` AND status IN (${buildDynamicInClause(statuses)})`;
        params.push(...statuses);
      }

      query += ' ORDER BY created_at DESC, field_key ASC';
      return db.prepare(query).all(...params).map(normalizeReviewItemRow);
    },

    listPendingReviewItemsForPerson(personId) {
      return db
        .prepare(`
          SELECT
            review_items.id,
            review_items.bundle_id,
            review_items.person_id,
            review_items.item_type,
            review_items.field_key,
            review_items.target,
            review_items.suggested_value_json,
            review_items.current_value_json,
            review_items.rationale,
            review_items.source_document_ids_json,
            review_items.supporting_evidence_ids_json,
            review_items.metadata_json,
            review_items.status,
            review_items.created_at,
            review_items.resolved_at,
            review_items.resolved_by_actor_type,
            review_items.resolved_by_actor_id,
            review_items.resolution_note,
            review_items.applied_claim_id
          FROM review_items
          WHERE person_id = ? AND status = 'pending'
          ORDER BY created_at DESC, field_key ASC
        `)
        .all(personId)
        .map(normalizeReviewItemRow);
    },

    refreshReviewBundleStatus(bundleId, updatedAt = nowIso()) {
      const counts = db
        .prepare(`
          SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) AS applied_count,
            SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed_count,
            SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END) AS superseded_count
          FROM review_items
          WHERE bundle_id = ?
        `)
        .get(bundleId);

      const totalCount = Number(counts?.total_count || 0);
      const pendingCount = Number(counts?.pending_count || 0);
      const appliedCount = Number(counts?.applied_count || 0);
      const dismissedCount = Number(counts?.dismissed_count || 0);
      const supersededCount = Number(counts?.superseded_count || 0);

      let nextStatus = 'pending';
      if (pendingCount === 0 && totalCount > 0) {
        if (appliedCount > 0 && dismissedCount === 0 && supersededCount === 0) {
          nextStatus = 'applied';
        } else if (dismissedCount > 0 && appliedCount === 0 && supersededCount === 0) {
          nextStatus = 'dismissed';
        } else {
          nextStatus = 'partially_applied';
        }
      } else if (pendingCount < totalCount) {
        nextStatus = 'partially_applied';
      }

      return this.updateReviewBundleStatus(bundleId, nextStatus, updatedAt);
    },

    createReviewDecision({
      id = createId('review_decision'),
      reviewItemId,
      bundleId,
      personId = null,
      decision,
      actorType,
      actorId,
      note = '',
      appliedClaimId = null,
      createdAt = nowIso(),
    }) {
      const row = db
        .prepare(`
          INSERT INTO review_decisions (
            id, review_item_id, bundle_id, person_id, decision, actor_type,
            actor_id, note, applied_claim_id, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING
            id, review_item_id, bundle_id, person_id, decision, actor_type,
            actor_id, note, applied_claim_id, created_at
        `)
        .get(id, reviewItemId, bundleId, personId, decision, actorType, actorId, note, appliedClaimId, createdAt);

      return normalizeReviewDecisionRow(row);
    },

    getReviewDecision(reviewDecisionId) {
      const row = db
        .prepare(`
          SELECT
            id, review_item_id, bundle_id, person_id, decision, actor_type,
            actor_id, note, applied_claim_id, created_at
          FROM review_decisions
          WHERE id = ?
        `)
        .get(reviewDecisionId);

      return normalizeReviewDecisionRow(row);
    },

    listReviewDecisionsForItem(reviewItemId) {
      return db
        .prepare(`
          SELECT
            id, review_item_id, bundle_id, person_id, decision, actor_type,
            actor_id, note, applied_claim_id, created_at
          FROM review_decisions
          WHERE review_item_id = ?
          ORDER BY created_at DESC
        `)
        .all(reviewItemId)
        .map(normalizeReviewDecisionRow);
    },

    listReviewDecisionsForPerson(personId) {
      return db
        .prepare(`
          SELECT
            id, review_item_id, bundle_id, person_id, decision, actor_type,
            actor_id, note, applied_claim_id, created_at
          FROM review_decisions
          WHERE person_id = ?
          ORDER BY created_at DESC, id DESC
        `)
        .all(personId)
        .map(normalizeReviewDecisionRow);
    },

    resolveReviewItem({
      reviewItemId,
      status,
      resolvedAt = nowIso(),
      resolvedByActorType = null,
      resolvedByActorId = null,
      resolutionNote = '',
      appliedClaimId = null,
    }) {
      const row = db
        .prepare(`
          UPDATE review_items
          SET
            status = ?,
            resolved_at = ?,
            resolved_by_actor_type = ?,
            resolved_by_actor_id = ?,
            resolution_note = ?,
            applied_claim_id = ?
          WHERE id = ?
          RETURNING
            id, bundle_id, person_id, item_type, field_key, target, suggested_value_json,
            current_value_json, rationale, source_document_ids_json,
            supporting_evidence_ids_json, metadata_json, status, created_at, resolved_at,
            resolved_by_actor_type, resolved_by_actor_id, resolution_note, applied_claim_id
        `)
        .get(
          status,
          resolvedAt,
          resolvedByActorType,
          resolvedByActorId,
          resolutionNote,
          appliedClaimId,
          reviewItemId,
        );

      const item = normalizeReviewItemRow(row);
      if (!item) return null;
      this.refreshReviewBundleStatus(item.bundleId, resolvedAt);
      return item;
    },

    recordReviewDecision({
      decisionId = null,
      reviewItemId,
      decision,
      actorType,
      actorId,
      note = '',
      appliedClaimId = null,
      createdAt = nowIso(),
    }) {
      return transaction(db, () => {
        const item = this.getReviewItem(reviewItemId);
        if (!item) {
          throw new Error(`Unknown review item: ${reviewItemId}`);
        }

        const decisionRecord = this.createReviewDecision({
          id: decisionId || undefined,
          reviewItemId: item.id,
          bundleId: item.bundleId,
          personId: item.personId,
          decision,
          actorType,
          actorId,
          note,
          appliedClaimId,
          createdAt,
        });

        const nextStatus =
          decision === 'accepted' ? 'applied' : decision === 'dismissed' ? 'dismissed' : 'superseded';
        const nextItem = this.resolveReviewItem({
          reviewItemId: item.id,
          status: nextStatus,
          resolvedAt: createdAt,
          resolvedByActorType: actorType,
          resolvedByActorId: actorId,
          resolutionNote: note,
          appliedClaimId,
        });
        const nextBundle = this.getReviewBundle(item.bundleId);

        this.createMemoryItem({
          personId: item.personId,
          kind: 'review_rationale',
          fieldKey: item.fieldKey,
          serviceKey:
            (typeof nextBundle?.source?.serviceId === 'string' && nextBundle.source.serviceId.trim()) ||
            nextBundle?.stageKey ||
            null,
          sessionOrBundleId: item.bundleId,
          title: `Review decision · ${item.fieldKey}`,
          snippetText: [
            `${decision} ${item.fieldKey} = ${stringifyValue(item.suggestedValue)}`,
            item.currentValue ? `(current: ${stringifyValue(item.currentValue)})` : '',
            note ? `note: ${note}` : '',
          ]
            .filter(Boolean)
            .join(' '),
          rationale: note || item.rationale || 'Review decision recorded in mio-core.',
          sourceKind: 'review_decision',
          sourceRef: decisionRecord.id,
          sourceLocator: `bundle:${item.bundleId};item:${item.id}`,
          metadata: {
            reviewItemId: item.id,
            bundleId: item.bundleId,
            decision,
            actorType,
            actorId,
            target: item.target,
          },
          createdAt,
        });

        return {
          decision: decisionRecord,
          item: nextItem,
          bundle: nextBundle,
        };
      });
    },

    createAuditEvent({
      id = createId('audit'),
      personId = null,
      actorType,
      actorId,
      eventType,
      eventPayload = {},
      createdAt = nowIso(),
    }) {
      const row = db
        .prepare(`
          INSERT INTO audit_events (
            id, person_id, actor_type, actor_id, event_type, event_payload_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          RETURNING
            id, person_id, actor_type, actor_id, event_type, event_payload_json, created_at
        `)
        .get(
          id,
          personId,
          actorType,
          actorId,
          eventType,
          encodeJson(eventPayload),
          createdAt,
        );

      return {
        id: row.id,
        personId: row.person_id,
        actorType: row.actor_type,
        actorId: row.actor_id,
        eventType: row.event_type,
        eventPayload: decodeJson(row.event_payload_json, {}),
        createdAt: row.created_at,
      };
    },

    listAuditEventsForPerson(personId) {
      return db
        .prepare(`
          SELECT id, person_id, actor_type, actor_id, event_type, event_payload_json, created_at
          FROM audit_events
          WHERE person_id = ?
          ORDER BY created_at DESC
        `)
        .all(personId)
        .map((row) => ({
          id: row.id,
          personId: row.person_id,
          actorType: row.actor_type,
          actorId: row.actor_id,
          eventType: row.event_type,
          eventPayload: decodeJson(row.event_payload_json, {}),
          createdAt: row.created_at,
        }));
    },

    createTimelineEntry({
      id = createId('timeline'),
      personId,
      eventDate,
      summary,
      detailMd = '',
      source = '',
      createdAt = nowIso(),
    }) {
      const row = db
        .prepare(`
          INSERT INTO timeline_entries (
            id, person_id, event_date, summary, detail_md, source, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          RETURNING id, person_id, event_date, summary, detail_md, source, created_at
        `)
        .get(id, personId, eventDate, summary, detailMd, source, createdAt);

      return {
        id: row.id,
        personId: row.person_id,
        eventDate: row.event_date,
        summary: row.summary,
        detailMd: row.detail_md,
        source: row.source,
        createdAt: row.created_at,
      };
    },

    listTimelineEntries(personId) {
      return db
        .prepare(`
          SELECT id, person_id, event_date, summary, detail_md, source, created_at
          FROM timeline_entries
          WHERE person_id = ?
          ORDER BY event_date DESC, created_at DESC
        `)
        .all(personId)
        .map((row) => ({
          id: row.id,
          personId: row.person_id,
          eventDate: row.event_date,
          summary: row.summary,
          detailMd: row.detail_md,
          source: row.source,
          createdAt: row.created_at,
        }));
    },

    createMemoryItem({
      id = createId('memory'),
      personId,
      kind,
      fieldKey = null,
      serviceKey = null,
      sessionOrBundleId = null,
      title,
      snippetText = '',
      rationale = '',
      sourceKind = '',
      sourceRef = '',
      sourceLocator = '',
      confidence = null,
      metadata = {},
      createdAt = nowIso(),
    }) {
      const row = db
        .prepare(`
          INSERT INTO memory_items (
            id, person_id, kind, field_key, service_key, session_or_bundle_id, title,
            snippet_text, rationale, source_kind, source_ref, source_locator,
            confidence, metadata_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING
            id, person_id, kind, field_key, service_key, session_or_bundle_id, title,
            snippet_text, rationale, source_kind, source_ref, source_locator,
            confidence, metadata_json, created_at
        `)
        .get(
          id,
          personId,
          kind,
          fieldKey,
          serviceKey,
          sessionOrBundleId,
          title,
          snippetText,
          rationale,
          sourceKind,
          sourceRef,
          sourceLocator,
          confidence,
          encodeJson(metadata),
          createdAt,
        );

      return normalizeMemoryRow(row);
    },

    listMemoryItemsForPerson(
      personId,
      { kinds = null, fieldKey = null, serviceKey = null, sessionOrBundleId = null, limit = null } = {},
    ) {
      let query = `
        SELECT
          id, person_id, kind, field_key, service_key, session_or_bundle_id, title,
          snippet_text, rationale, source_kind, source_ref, source_locator,
          confidence, metadata_json, created_at
        FROM memory_items
        WHERE person_id = ?
      `;
      const params = [personId];

      if (Array.isArray(kinds) && kinds.length > 0) {
        query += ` AND kind IN (${buildDynamicInClause(kinds)})`;
        params.push(...kinds);
      }

      if (fieldKey) {
        query += ' AND field_key = ?';
        params.push(fieldKey);
      }

      if (serviceKey) {
        query += ' AND service_key = ?';
        params.push(serviceKey);
      }

      if (sessionOrBundleId) {
        query += ' AND session_or_bundle_id = ?';
        params.push(sessionOrBundleId);
      }

      query += ' ORDER BY created_at DESC, id DESC';

      if (Number.isInteger(limit) && limit > 0) {
        query += ` LIMIT ${limit}`;
      }

      return db.prepare(query).all(...params).map(normalizeMemoryRow);
    },

    countMemoryItemsForPerson(personId) {
      const row = db
        .prepare(`
          SELECT COUNT(*) AS total_count
          FROM memory_items
          WHERE person_id = ?
        `)
        .get(personId);

      return Number(row?.total_count || 0);
    },

    getWikiEntry(entryId) {
      const row = db
        .prepare(`
          SELECT
            id, person_id, title, category, field_key, value_text, summary_text,
            status, trust_level, autofill_eligible, source_kind, source_ref,
            source_locator, source_document_ids_json, supporting_evidence_ids_json,
            tags_json, metadata_json, reviewed_at, superseded_by_entry_id,
            created_at, updated_at
          FROM wiki_entries
          WHERE id = ?
        `)
        .get(entryId);

      return normalizeWikiEntryRow(row);
    },

    createWikiEntry({
      id = createId('wiki'),
      personId,
      title,
      category = 'identity',
      fieldKey = '',
      valueText = '',
      summaryText = '',
      status = 'candidate',
      trustLevel = 'user_asserted',
      autofillEligible = false,
      sourceKind = '',
      sourceRef = '',
      sourceLocator = '',
      sourceDocumentIds = [],
      supportingEvidenceIds = [],
      tags = [],
      metadata = {},
      reviewedAt = null,
      supersededByEntryId = null,
      createdAt = nowIso(),
      updatedAt = createdAt,
      actorType = 'system',
      actorId = 'repository.createWikiEntry',
    }) {
      const row = db
        .prepare(`
          INSERT INTO wiki_entries (
            id, person_id, title, category, field_key, value_text, summary_text,
            status, trust_level, autofill_eligible, source_kind, source_ref,
            source_locator, source_document_ids_json, supporting_evidence_ids_json,
            tags_json, metadata_json, reviewed_at, superseded_by_entry_id,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING
            id, person_id, title, category, field_key, value_text, summary_text,
            status, trust_level, autofill_eligible, source_kind, source_ref,
            source_locator, source_document_ids_json, supporting_evidence_ids_json,
            tags_json, metadata_json, reviewed_at, superseded_by_entry_id,
            created_at, updated_at
        `)
        .get(
          id,
          personId,
          title,
          category,
          fieldKey,
          valueText,
          summaryText,
          status,
          trustLevel,
          autofillEligible ? 1 : 0,
          sourceKind,
          sourceRef,
          sourceLocator,
          encodeJson(sourceDocumentIds),
          encodeJson(supportingEvidenceIds),
          encodeJson(tags),
          encodeJson(metadata),
          reviewedAt,
          supersededByEntryId,
          createdAt,
          updatedAt,
        );

      const entry = normalizeWikiEntryRow(row);
      this.createWikiEvent({
        personId,
        entryId: entry.id,
        action: 'created',
        actorType,
        actorId,
        payload: {
          status: entry.status,
          trustLevel: entry.trustLevel,
          category: entry.category,
        },
        createdAt,
      });
      return entry;
    },

    updateWikiEntry(
      entryId,
      {
        title,
        category,
        fieldKey,
        valueText,
        summaryText,
        status,
        trustLevel,
        autofillEligible,
        sourceKind,
        sourceRef,
        sourceLocator,
        sourceDocumentIds,
        supportingEvidenceIds,
        tags,
        metadata,
        reviewedAt,
        supersededByEntryId,
        updatedAt = nowIso(),
        actorType = 'system',
        actorId = 'repository.updateWikiEntry',
      } = {},
    ) {
      const existing = this.getWikiEntry(entryId);
      if (!existing) {
        throw new Error(`Unknown wiki entry: ${entryId}`);
      }

      const next = {
        ...existing,
        title: title ?? existing.title,
        category: category ?? existing.category,
        fieldKey: fieldKey ?? existing.fieldKey,
        valueText: valueText ?? existing.valueText,
        summaryText: summaryText ?? existing.summaryText,
        status: status ?? existing.status,
        trustLevel: trustLevel ?? existing.trustLevel,
        autofillEligible: autofillEligible ?? existing.autofillEligible,
        sourceKind: sourceKind ?? existing.sourceKind,
        sourceRef: sourceRef ?? existing.sourceRef,
        sourceLocator: sourceLocator ?? existing.sourceLocator,
        sourceDocumentIds: sourceDocumentIds ?? existing.sourceDocumentIds,
        supportingEvidenceIds: supportingEvidenceIds ?? existing.supportingEvidenceIds,
        tags: tags ?? existing.tags,
        metadata: metadata ?? existing.metadata,
        reviewedAt: reviewedAt ?? existing.reviewedAt,
        supersededByEntryId: supersededByEntryId ?? existing.supersededByEntryId,
        updatedAt,
      };

      const row = db
        .prepare(`
          UPDATE wiki_entries
          SET
            title = ?,
            category = ?,
            field_key = ?,
            value_text = ?,
            summary_text = ?,
            status = ?,
            trust_level = ?,
            autofill_eligible = ?,
            source_kind = ?,
            source_ref = ?,
            source_locator = ?,
            source_document_ids_json = ?,
            supporting_evidence_ids_json = ?,
            tags_json = ?,
            metadata_json = ?,
            reviewed_at = ?,
            superseded_by_entry_id = ?,
            updated_at = ?
          WHERE id = ?
          RETURNING
            id, person_id, title, category, field_key, value_text, summary_text,
            status, trust_level, autofill_eligible, source_kind, source_ref,
            source_locator, source_document_ids_json, supporting_evidence_ids_json,
            tags_json, metadata_json, reviewed_at, superseded_by_entry_id,
            created_at, updated_at
        `)
        .get(
          next.title,
          next.category,
          next.fieldKey,
          next.valueText,
          next.summaryText,
          next.status,
          next.trustLevel,
          next.autofillEligible ? 1 : 0,
          next.sourceKind,
          next.sourceRef,
          next.sourceLocator,
          encodeJson(next.sourceDocumentIds),
          encodeJson(next.supportingEvidenceIds),
          encodeJson(next.tags),
          encodeJson(next.metadata),
          next.reviewedAt,
          next.supersededByEntryId,
          next.updatedAt,
          entryId,
        );

      const entry = normalizeWikiEntryRow(row);
      const action = existing.status !== entry.status
        ? entry.status === 'stale'
          ? 'marked_stale'
          : 'status_changed'
        : 'updated';
      this.createWikiEvent({
        personId: entry.personId,
        entryId: entry.id,
        action,
        actorType,
        actorId,
        payload: {
          previousStatus: existing.status,
          nextStatus: entry.status,
          trustLevel: entry.trustLevel,
          autofillEligible: entry.autofillEligible,
        },
        createdAt: updatedAt,
      });
      return entry;
    },

    listWikiEntriesForPerson(
      personId,
      { statuses = null, categories = null, fieldKey = null, limit = null } = {},
    ) {
      let query = `
        SELECT
          id, person_id, title, category, field_key, value_text, summary_text,
          status, trust_level, autofill_eligible, source_kind, source_ref,
          source_locator, source_document_ids_json, supporting_evidence_ids_json,
          tags_json, metadata_json, reviewed_at, superseded_by_entry_id,
          created_at, updated_at
        FROM wiki_entries
        WHERE person_id = ?
      `;
      const params = [personId];

      if (Array.isArray(statuses) && statuses.length > 0) {
        query += ` AND status IN (${buildDynamicInClause(statuses)})`;
        params.push(...statuses);
      }

      if (Array.isArray(categories) && categories.length > 0) {
        query += ` AND category IN (${buildDynamicInClause(categories)})`;
        params.push(...categories);
      }

      if (fieldKey) {
        query += ' AND field_key = ?';
        params.push(fieldKey);
      }

      query += ' ORDER BY updated_at DESC, created_at DESC, id DESC';

      if (Number.isInteger(limit) && limit > 0) {
        query += ` LIMIT ${limit}`;
      }

      return db.prepare(query).all(...params).map(normalizeWikiEntryRow);
    },

    countWikiEntriesForPerson(personId, { statuses = null } = {}) {
      let query = `
        SELECT COUNT(*) AS total_count
        FROM wiki_entries
        WHERE person_id = ?
      `;
      const params = [personId];

      if (Array.isArray(statuses) && statuses.length > 0) {
        query += ` AND status IN (${buildDynamicInClause(statuses)})`;
        params.push(...statuses);
      }

      const row = db.prepare(query).get(...params);
      return Number(row?.total_count || 0);
    },

    createWikiEvent({
      id = createId('wiki_event'),
      personId,
      entryId,
      action,
      actorType,
      actorId = '',
      payload = {},
      createdAt = nowIso(),
    }) {
      const row = db
        .prepare(`
          INSERT INTO wiki_events (
            id, person_id, entry_id, action, actor_type, actor_id, payload_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING
            id, person_id, entry_id, action, actor_type, actor_id, payload_json, created_at
        `)
        .get(
          id,
          personId,
          entryId,
          action,
          actorType,
          actorId,
          encodeJson(payload),
          createdAt,
        );

      return normalizeWikiEventRow(row);
    },

    listWikiEventsForEntry(entryId, { limit = null } = {}) {
      let query = `
        SELECT
          id, person_id, entry_id, action, actor_type, actor_id, payload_json, created_at
        FROM wiki_events
        WHERE entry_id = ?
        ORDER BY created_at DESC, id DESC
      `;

      if (Number.isInteger(limit) && limit > 0) {
        query += ` LIMIT ${limit}`;
      }

      return db.prepare(query).all(entryId).map(normalizeWikiEventRow);
    },

    listWikiEventsForPerson(personId, { limit = null } = {}) {
      let query = `
        SELECT
          id, person_id, entry_id, action, actor_type, actor_id, payload_json, created_at
        FROM wiki_events
        WHERE person_id = ?
        ORDER BY created_at DESC, id DESC
      `;

      if (Number.isInteger(limit) && limit > 0) {
        query += ` LIMIT ${limit}`;
      }

      return db.prepare(query).all(personId).map(normalizeWikiEventRow);
    },

    importWithinTransaction(work) {
      return transaction(db, work);
    },

    getClaimTypeKeyForField,
  };
}
