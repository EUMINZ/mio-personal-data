function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string';
}

function isNullableString(value) {
  return value === null || isString(value);
}

function isIsoDateTime(value) {
  return isString(value) && !Number.isNaN(Date.parse(value));
}

function assert(condition, path, message, errors) {
  if (!condition) {
    errors.push({ path, message });
  }
}

function assertStringRecord(value, path, errors) {
  assert(isObject(value), path, 'expected object', errors);
  if (!isObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    assert(isString(item), `${path}.${key}`, 'expected string', errors);
  }
}

function assertStringArray(value, path, errors) {
  assert(Array.isArray(value), path, 'expected array', errors);
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    assert(isString(item), `${path}[${index}]`, 'expected string', errors);
  });
}

function assertNoExtraKeys(value, path, allowedKeys, errors) {
  if (!isObject(value)) return;
  const allowedSet = new Set(allowedKeys);
  Object.keys(value).forEach((key) => {
    if (!allowedSet.has(key)) {
      errors.push({ path: `${path}.${key}`, message: 'unexpected property' });
    }
  });
}

function assertMemoryItem(value, path, errors) {
  assert(isObject(value), path, 'expected object', errors);
  if (!isObject(value)) return;
  ['id', 'kind', 'title', 'snippetText', 'rationale', 'sourceKind', 'sourceRef', 'sourceLocator', 'createdAt'].forEach(
    (key) => {
      assert(isString(value[key]), `${path}.${key}`, 'expected string', errors);
    },
  );
  ['field', 'serviceKey', 'sessionOrBundleId'].forEach((key) => {
    if (key in value) {
      assert(isString(value[key]), `${path}.${key}`, 'expected string', errors);
    }
  });
  if ('confidence' in value) {
    assert(
      value.confidence === null || typeof value.confidence === 'number',
      `${path}.confidence`,
      'expected number or null',
      errors,
    );
  }
}

function assertMemoryArray(value, path, errors) {
  assert(Array.isArray(value), path, 'expected array', errors);
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    assertMemoryItem(item, `${path}[${index}]`, errors);
  });
}

function assertWikiEntryItem(value, path, errors) {
  assert(isObject(value), path, 'expected object', errors);
  if (!isObject(value)) return;
  ['id', 'title', 'category', 'fieldKey', 'valueText', 'summaryText', 'status', 'trustLevel', 'sourceKind', 'sourceRef', 'sourceLocator', 'reviewedAt', 'updatedAt'].forEach(
    (key) => {
      assert(isString(value[key]), `${path}.${key}`, 'expected string', errors);
    },
  );
  if ('autofillEligible' in value) {
    assert(typeof value.autofillEligible === 'boolean', `${path}.autofillEligible`, 'expected boolean', errors);
  }
  if ('sourceDocumentIds' in value) {
    assertStringArray(value.sourceDocumentIds, `${path}.sourceDocumentIds`, errors);
  }
  if ('supportingEvidenceIds' in value) {
    assertStringArray(value.supportingEvidenceIds, `${path}.supportingEvidenceIds`, errors);
  }
  if ('tags' in value) {
    assertStringArray(value.tags, `${path}.tags`, errors);
  }
}

function assertWikiEntryArray(value, path, errors) {
  assert(Array.isArray(value), path, 'expected array', errors);
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    assertWikiEntryItem(item, `${path}[${index}]`, errors);
  });
}

function assertCompiledIdentitySummary(value, path, errors) {
  assert(isObject(value), path, 'expected object', errors);
  if (!isObject(value)) return;

  ['headlineText', 'summaryText'].forEach((key) => {
    assert(isString(value[key]), `${path}.${key}`, 'expected string', errors);
  });
  assert(isIsoDateTime(value.lastUpdatedAt), `${path}.lastUpdatedAt`, 'expected ISO date-time', errors);

  ['stableFieldCount', 'extractedFieldCount', 'pendingReviewCount', 'pendingBundleCount', 'wikiEntryCount', 'activeGrantCount'].forEach(
    (key) => {
      assert(
        Number.isInteger(value[key]) && value[key] >= 0,
        `${path}.${key}`,
        'expected non-negative integer',
        errors,
      );
    },
  );

  if ('summaryLines' in value) {
    assertStringArray(value.summaryLines, `${path}.summaryLines`, errors);
  }
  if ('attentionFields' in value) {
    assertStringArray(value.attentionFields, `${path}.attentionFields`, errors);
  }

  assertNoExtraKeys(
    value,
    path,
    [
      'headlineText',
      'summaryText',
      'summaryLines',
      'stableFieldCount',
      'extractedFieldCount',
      'pendingReviewCount',
      'pendingBundleCount',
      'wikiEntryCount',
      'activeGrantCount',
      'attentionFields',
      'lastUpdatedAt',
    ],
    errors,
  );
}

function assertTimelineArray(value, path, errors) {
  assert(Array.isArray(value), path, 'expected array', errors);
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    assert(isObject(item), itemPath, 'expected object', errors);
    if (!isObject(item)) return;
    ['id', 'eventType', 'title', 'detail', 'sourceKind', 'sourceRef'].forEach((key) => {
      assert(isString(item[key]), `${itemPath}.${key}`, 'expected string', errors);
    });
    assert(isIsoDateTime(item.eventAt), `${itemPath}.eventAt`, 'expected ISO date-time', errors);
    assertNoExtraKeys(
      item,
      itemPath,
      ['id', 'eventType', 'eventAt', 'title', 'detail', 'sourceKind', 'sourceRef'],
      errors,
    );
  });
}

function assertGemmaMaintenanceSource(value, path, errors) {
  assert(isObject(value), path, 'expected object', errors);
  if (!isObject(value)) return;
  ['producer', 'model', 'mode', 'endpointLabel'].forEach((key) => {
    if (key in value) {
      assert(isString(value[key]), `${path}.${key}`, 'expected string', errors);
    }
  });
  assertNoExtraKeys(value, path, ['producer', 'model', 'mode', 'endpointLabel'], errors);
}

function assertGemmaMaintenanceAction(value, path, errors) {
  assert(isObject(value), path, 'expected object', errors);
  if (!isObject(value)) return;

  ['actionId', 'actionType', 'rationale', 'confidence', 'riskLevel'].forEach((key) => {
    assert(isString(value[key]), `${path}.${key}`, 'expected string', errors);
  });

  if (isString(value.actionType)) {
    assert(
      ['upsert_wiki_entry', 'mark_wiki_entry_stale', 'create_review_item'].includes(value.actionType),
      `${path}.actionType`,
      'expected upsert_wiki_entry|mark_wiki_entry_stale|create_review_item',
      errors,
    );
  }
  if (isString(value.confidence)) {
    assert(['low', 'medium', 'high'].includes(value.confidence), `${path}.confidence`, 'expected low|medium|high', errors);
  }
  if (isString(value.riskLevel)) {
    assert(['low', 'medium', 'high'].includes(value.riskLevel), `${path}.riskLevel`, 'expected low|medium|high', errors);
  }

  [
    'entryId',
    'title',
    'category',
    'fieldKey',
    'valueText',
    'summaryText',
    'suggestedValue',
    'currentValue',
    'target',
    'itemType',
    'createdAt',
  ].forEach((key) => {
    if (key in value) {
      assert(isString(value[key]), `${path}.${key}`, 'expected string', errors);
    }
  });

  if ('sourceDocumentIds' in value) {
    assertStringArray(value.sourceDocumentIds, `${path}.sourceDocumentIds`, errors);
  }
  if ('supportingEvidenceIds' in value) {
    assertStringArray(value.supportingEvidenceIds, `${path}.supportingEvidenceIds`, errors);
  }
  if ('tags' in value) {
    assertStringArray(value.tags, `${path}.tags`, errors);
  }
  if ('metadata' in value) {
    assert(isObject(value.metadata), `${path}.metadata`, 'expected object', errors);
  }

  if (value.actionType === 'upsert_wiki_entry') {
    assert(
      isString(value.title) || isString(value.fieldKey),
      `${path}.title`,
      'expected title or fieldKey for wiki upsert',
      errors,
    );
    assert(
      isString(value.valueText) || isString(value.summaryText),
      `${path}.valueText`,
      'expected valueText or summaryText for wiki upsert',
      errors,
    );
  }

  if (value.actionType === 'mark_wiki_entry_stale') {
    assert(isString(value.entryId), `${path}.entryId`, 'expected string', errors);
  }

  if (value.actionType === 'create_review_item') {
    assert(isString(value.fieldKey), `${path}.fieldKey`, 'expected string', errors);
    assert(
      isString(value.suggestedValue) || isString(value.valueText),
      `${path}.suggestedValue`,
      'expected suggestedValue or valueText',
      errors,
    );
    if ('target' in value) {
      assert(
        ['identity_claim', 'bundle_context', 'service_context', 'trip_context'].includes(value.target),
        `${path}.target`,
        'expected identity_claim|bundle_context|service_context|trip_context',
        errors,
      );
    }
    if ('itemType' in value) {
      assert(['proposal', 'observation'].includes(value.itemType), `${path}.itemType`, 'expected proposal|observation', errors);
    }
  }

  assertNoExtraKeys(
    value,
    path,
    [
      'actionId',
      'actionType',
      'entryId',
      'title',
      'category',
      'fieldKey',
      'valueText',
      'summaryText',
      'suggestedValue',
      'currentValue',
      'target',
      'itemType',
      'rationale',
      'confidence',
      'riskLevel',
      'sourceDocumentIds',
      'supportingEvidenceIds',
      'tags',
      'metadata',
      'createdAt',
    ],
    errors,
  );
}

function assertGemmaMaintenanceResultItem(value, path, errors) {
  assert(isObject(value), path, 'expected object', errors);
  if (!isObject(value)) return;
  ['actionId', 'actionType', 'resultType'].forEach((key) => {
    assert(isString(value[key]), `${path}.${key}`, 'expected string', errors);
  });
  ['entryId', 'reviewItemId', 'bundleId', 'status'].forEach((key) => {
    if (key in value) {
      assert(isString(value[key]), `${path}.${key}`, 'expected string', errors);
    }
  });
}

function assertGemmaMaintenanceSkippedItem(value, path, errors) {
  assert(isObject(value), path, 'expected object', errors);
  if (!isObject(value)) return;
  assert(isString(value.reason), `${path}.reason`, 'expected string', errors);
  ['actionId', 'actionType', 'entryId', 'reviewItemId', 'bundleId'].forEach((key) => {
    if (key in value && value[key] !== null) {
      assert(isString(value[key]), `${path}.${key}`, 'expected string', errors);
    }
  });
}

export function validateReviewBundleContract(payload) {
  const errors = [];
  const root = '$';

  assert(isObject(payload), root, 'expected object', errors);
  if (!isObject(payload)) return { ok: false, errors };

  const required = [
    'schemaVersion',
    'createdAt',
    'source',
    'summary',
    'requestedFields',
    'injectedFields',
    'pageProfile',
    'observations',
    'proposals',
  ];
  required.forEach((key) => {
    assert(key in payload, `${root}.${key}`, 'missing required property', errors);
  });

  assert(payload.schemaVersion === 'mio.review.bundle.v1', `${root}.schemaVersion`, 'must be mio.review.bundle.v1', errors);
  assert(isIsoDateTime(payload.createdAt), `${root}.createdAt`, 'expected ISO date-time', errors);

  if ('reviewBundleId' in payload) {
    assert(isString(payload.reviewBundleId) && payload.reviewBundleId.length > 0, `${root}.reviewBundleId`, 'expected non-empty string', errors);
  }

  assert(isObject(payload.source), `${root}.source`, 'expected object', errors);
  assert(isObject(payload.summary), `${root}.summary`, 'expected object', errors);
  assertStringArray(payload.requestedFields, `${root}.requestedFields`, errors);
  assertStringArray(payload.injectedFields, `${root}.injectedFields`, errors);
  assertStringRecord(payload.pageProfile, `${root}.pageProfile`, errors);
  if ('tripRecord' in payload) {
    assertStringRecord(payload.tripRecord, `${root}.tripRecord`, errors);
  }

  assert(Array.isArray(payload.observations), `${root}.observations`, 'expected array', errors);
  if (Array.isArray(payload.observations)) {
    payload.observations.forEach((item, index) => {
      const path = `${root}.observations[${index}]`;
      assert(isObject(item), path, 'expected object', errors);
      if (!isObject(item)) return;
      assert(isString(item.field), `${path}.field`, 'expected string', errors);
      if ('nextValue' in item) assert(isString(item.nextValue), `${path}.nextValue`, 'expected string', errors);
      if ('sourceValue' in item) assert(isString(item.sourceValue), `${path}.sourceValue`, 'expected string', errors);
      if ('previousValue' in item) assert(isString(item.previousValue), `${path}.previousValue`, 'expected string', errors);
      if ('observedAt' in item) assert(isIsoDateTime(item.observedAt), `${path}.observedAt`, 'expected ISO date-time', errors);
    });
  }

  assert(Array.isArray(payload.proposals), `${root}.proposals`, 'expected array', errors);
  if (Array.isArray(payload.proposals)) {
    payload.proposals.forEach((item, index) => {
      const path = `${root}.proposals[${index}]`;
      assert(isObject(item), path, 'expected object', errors);
      if (!isObject(item)) return;
      assert(isString(item.field), `${path}.field`, 'expected string', errors);
      assert(isString(item.value), `${path}.value`, 'expected string', errors);
      if ('derivedFrom' in item) assertStringArray(item.derivedFrom, `${path}.derivedFrom`, errors);
      if ('target' in item) {
        assert(item.target === 'service-context', `${path}.target`, 'expected service-context', errors);
      }
      if ('proposedAt' in item) assert(isIsoDateTime(item.proposedAt), `${path}.proposedAt`, 'expected ISO date-time', errors);
    });
  }

  assertNoExtraKeys(
    payload,
    root,
    [
      'schemaVersion',
      'reviewBundleId',
      'createdAt',
      'source',
      'summary',
      'requestedFields',
      'injectedFields',
      'pageProfile',
      'tripRecord',
      'observations',
      'proposals',
      'mergeGuidance',
    ],
    errors,
  );

  return { ok: errors.length === 0, errors };
}

export function validateGemmaCoreContextContract(payload) {
  const errors = [];
  const root = '$';

  assert(isObject(payload), root, 'expected object', errors);
  if (!isObject(payload)) return { ok: false, errors };

  const required = ['schemaVersion', 'generatedAt', 'person', 'profileSummary', 'knowledgeCards', 'evidence', 'proposals'];
  required.forEach((key) => {
    assert(key in payload, `${root}.${key}`, 'missing required property', errors);
  });

  assert(payload.schemaVersion === 'mio.gemma.core-context.v1', `${root}.schemaVersion`, 'must be mio.gemma.core-context.v1', errors);
  assert(isIsoDateTime(payload.generatedAt), `${root}.generatedAt`, 'expected ISO date-time', errors);

  assert(isObject(payload.person), `${root}.person`, 'expected object', errors);
  if (isObject(payload.person)) {
    assert(isString(payload.person.id), `${root}.person.id`, 'expected string', errors);
    assert(isString(payload.person.displayName), `${root}.person.displayName`, 'expected string', errors);
  }

  assertStringRecord(payload.profileSummary, `${root}.profileSummary`, errors);

  assert(Array.isArray(payload.knowledgeCards), `${root}.knowledgeCards`, 'expected array', errors);
  if (Array.isArray(payload.knowledgeCards)) {
    payload.knowledgeCards.forEach((card, index) => {
      const path = `${root}.knowledgeCards[${index}]`;
      assert(isObject(card), path, 'expected object', errors);
      if (!isObject(card)) return;
      ['id', 'titleEn', 'titleZh', 'summaryEn', 'summaryZh'].forEach((key) => {
        assert(isString(card[key]), `${path}.${key}`, 'expected string', errors);
      });
      assertStringArray(card.facts, `${path}.facts`, errors);
    });
  }

  assert(Array.isArray(payload.evidence), `${root}.evidence`, 'expected array', errors);
  if (Array.isArray(payload.evidence)) {
    payload.evidence.forEach((item, index) => {
      const path = `${root}.evidence[${index}]`;
      assert(isObject(item), path, 'expected object', errors);
      if (!isObject(item)) return;
      ['id', 'kind', 'headline'].forEach((key) => {
        assert(isString(item[key]), `${path}.${key}`, 'expected string', errors);
      });
      assertStringRecord(item.fields, `${path}.fields`, errors);
      if ('sourceDocumentIds' in item) assertStringArray(item.sourceDocumentIds, `${path}.sourceDocumentIds`, errors);
      if ('supportingEvidenceIds' in item) assertStringArray(item.supportingEvidenceIds, `${path}.supportingEvidenceIds`, errors);
    });
  }

  assert(Array.isArray(payload.proposals), `${root}.proposals`, 'expected array', errors);
  if (Array.isArray(payload.proposals)) {
    payload.proposals.forEach((proposal, index) => {
      const path = `${root}.proposals[${index}]`;
      assert(isObject(proposal), path, 'expected object', errors);
      if (!isObject(proposal)) return;
      ['field', 'currentValue', 'suggestedValue', 'rationale', 'confidence', 'action'].forEach((key) => {
        assert(isString(proposal[key]), `${path}.${key}`, 'expected string', errors);
      });
      if ('sourceDocumentIds' in proposal) assertStringArray(proposal.sourceDocumentIds, `${path}.sourceDocumentIds`, errors);
      if ('supportingEvidenceIds' in proposal) {
        assertStringArray(proposal.supportingEvidenceIds, `${path}.supportingEvidenceIds`, errors);
      }
      if ('relatedMemory' in proposal) {
        assertMemoryArray(proposal.relatedMemory, `${path}.relatedMemory`, errors);
      }
    });
  }

  if ('pendingReview' in payload) {
    assert(Array.isArray(payload.pendingReview), `${root}.pendingReview`, 'expected array', errors);
    if (Array.isArray(payload.pendingReview)) {
      payload.pendingReview.forEach((item, index) => {
        const path = `${root}.pendingReview[${index}]`;
        assert(isObject(item), path, 'expected object', errors);
        if (!isObject(item)) return;
        ['itemId', 'bundleId', 'field', 'target', 'suggestedValue', 'status', 'createdAt'].forEach((key) => {
          assert(isString(item[key]), `${path}.${key}`, 'expected string', errors);
        });
        if ('currentValue' in item) assert(isString(item.currentValue), `${path}.currentValue`, 'expected string', errors);
        if ('relatedMemory' in item) {
          assertMemoryArray(item.relatedMemory, `${path}.relatedMemory`, errors);
        }
      });
    }
  }

  if ('memory' in payload) {
    assertMemoryArray(payload.memory, `${root}.memory`, errors);
  }

  if ('wikiEntries' in payload) {
    assertWikiEntryArray(payload.wikiEntries, `${root}.wikiEntries`, errors);
  }

  if ('compiledIdentity' in payload) {
    assertCompiledIdentitySummary(payload.compiledIdentity, `${root}.compiledIdentity`, errors);
  }

  if ('timeline' in payload) {
    assertTimelineArray(payload.timeline, `${root}.timeline`, errors);
  }

  if ('activeGrants' in payload) {
    assert(Array.isArray(payload.activeGrants), `${root}.activeGrants`, 'expected array', errors);
    if (Array.isArray(payload.activeGrants)) {
      payload.activeGrants.forEach((grant, index) => {
        const path = `${root}.activeGrants[${index}]`;
        assert(isObject(grant), path, 'expected object', errors);
        if (!isObject(grant)) return;
        ['grantId', 'purpose', 'requesterId'].forEach((key) => {
          assert(isString(grant[key]), `${path}.${key}`, 'expected string', errors);
        });
        assertStringArray(grant.allowedFields, `${path}.allowedFields`, errors);
        if ('expiresAt' in grant) {
          assert(isNullableString(grant.expiresAt), `${path}.expiresAt`, 'expected string or null', errors);
        }
      });
    }
  }

  assertNoExtraKeys(
    payload,
    root,
    [
      'schemaVersion',
      'generatedAt',
      'person',
      'profileSummary',
      'knowledgeCards',
      'evidence',
      'proposals',
      'pendingReview',
      'memory',
      'wikiEntries',
      'compiledIdentity',
      'timeline',
      'activeGrants',
    ],
    errors,
  );

  return { ok: errors.length === 0, errors };
}

export function validateReviewQueueContract(payload) {
  const errors = [];
  const root = '$';

  assert(isObject(payload), root, 'expected object', errors);
  if (!isObject(payload)) return { ok: false, errors };

  const required = ['schemaVersion', 'generatedAt', 'person', 'bundles'];
  required.forEach((key) => {
    assert(key in payload, `${root}.${key}`, 'missing required property', errors);
  });

  assert(payload.schemaVersion === 'mio.review.queue.v1', `${root}.schemaVersion`, 'must be mio.review.queue.v1', errors);
  assert(isIsoDateTime(payload.generatedAt), `${root}.generatedAt`, 'expected ISO date-time', errors);

  assert(isObject(payload.person), `${root}.person`, 'expected object', errors);
  if (isObject(payload.person)) {
    assert(isString(payload.person.id), `${root}.person.id`, 'expected string', errors);
    assert(isString(payload.person.displayName), `${root}.person.displayName`, 'expected string', errors);
  }

  assert(Array.isArray(payload.bundles), `${root}.bundles`, 'expected array', errors);
  if (Array.isArray(payload.bundles)) {
    payload.bundles.forEach((bundle, index) => {
      const path = `${root}.bundles[${index}]`;
      assert(isObject(bundle), path, 'expected object', errors);
      if (!isObject(bundle)) return;

      ['bundleId', 'sourceSystem', 'status', 'createdAt', 'updatedAt'].forEach((key) => {
        assert(isString(bundle[key]), `${path}.${key}`, 'expected string', errors);
      });
      ['sourceBundleId', 'producer', 'stageKey', 'stageLabel'].forEach((key) => {
        if (key in bundle) {
          assert(isNullableString(bundle[key]), `${path}.${key}`, 'expected string or null', errors);
        }
      });

      assertStringArray(bundle.requestedFields, `${path}.requestedFields`, errors);
      assertStringArray(bundle.injectedFields, `${path}.injectedFields`, errors);
      assertStringRecord(bundle.pageProfile, `${path}.pageProfile`, errors);
      assertStringRecord(bundle.tripRecord, `${path}.tripRecord`, errors);
      assert(Number.isInteger(bundle.pendingItemCount) && bundle.pendingItemCount >= 0, `${path}.pendingItemCount`, 'expected non-negative integer', errors);

      assert(Array.isArray(bundle.items), `${path}.items`, 'expected array', errors);
      if (Array.isArray(bundle.items)) {
        bundle.items.forEach((item, itemIndex) => {
          const itemPath = `${path}.items[${itemIndex}]`;
          assert(isObject(item), itemPath, 'expected object', errors);
          if (!isObject(item)) return;
          ['itemId', 'itemType', 'field', 'target', 'suggestedValue', 'currentValue', 'rationale', 'status', 'createdAt'].forEach((key) => {
            assert(isString(item[key]), `${itemPath}.${key}`, 'expected string', errors);
          });
          assertStringArray(item.sourceDocumentIds, `${itemPath}.sourceDocumentIds`, errors);
          assertStringArray(item.supportingEvidenceIds, `${itemPath}.supportingEvidenceIds`, errors);
          if ('relatedMemory' in item) {
            assertMemoryArray(item.relatedMemory, `${itemPath}.relatedMemory`, errors);
          }
        });
      }
    });
  }

  assertNoExtraKeys(payload, root, ['schemaVersion', 'generatedAt', 'person', 'bundles'], errors);
  return { ok: errors.length === 0, errors };
}

export function validateReviewDecisionsContract(payload) {
  const errors = [];
  const root = '$';

  assert(isObject(payload), root, 'expected object', errors);
  if (!isObject(payload)) return { ok: false, errors };

  const required = ['schemaVersion', 'generatedAt', 'person', 'decisions'];
  required.forEach((key) => {
    assert(key in payload, `${root}.${key}`, 'missing required property', errors);
  });

  assert(
    payload.schemaVersion === 'mio.review.decisions.v1',
    `${root}.schemaVersion`,
    'must be mio.review.decisions.v1',
    errors,
  );
  assert(isIsoDateTime(payload.generatedAt), `${root}.generatedAt`, 'expected ISO date-time', errors);

  assert(isObject(payload.person), `${root}.person`, 'expected object', errors);
  if (isObject(payload.person)) {
    assert(isString(payload.person.id), `${root}.person.id`, 'expected string', errors);
    if ('displayName' in payload.person) {
      assert(isString(payload.person.displayName), `${root}.person.displayName`, 'expected string', errors);
    }
  }

  if ('batchId' in payload) {
    assert(isString(payload.batchId), `${root}.batchId`, 'expected string', errors);
  }
  if ('source' in payload) {
    assert(isObject(payload.source), `${root}.source`, 'expected object', errors);
  }

  assert(Array.isArray(payload.decisions), `${root}.decisions`, 'expected array', errors);
  if (Array.isArray(payload.decisions)) {
    payload.decisions.forEach((item, index) => {
      const path = `${root}.decisions[${index}]`;
      assert(isObject(item), path, 'expected object', errors);
      if (!isObject(item)) return;

      ['decisionId', 'reviewItemId', 'bundleId', 'decision', 'actorType', 'actorId', 'createdAt'].forEach((key) => {
        assert(isString(item[key]), `${path}.${key}`, 'expected string', errors);
      });
      if ('note' in item) {
        assert(isString(item.note), `${path}.note`, 'expected string', errors);
      }
      if (isString(item.decision)) {
        assert(
          ['accepted', 'dismissed', 'superseded'].includes(item.decision),
          `${path}.decision`,
          'expected accepted|dismissed|superseded',
          errors,
        );
      }
      if (isString(item.actorType)) {
        assert(
          ['user', 'system', 'agent', 'requester'].includes(item.actorType),
          `${path}.actorType`,
          'expected user|system|agent|requester',
          errors,
        );
      }
      if ('createdAt' in item) {
        assert(isIsoDateTime(item.createdAt), `${path}.createdAt`, 'expected ISO date-time', errors);
      }
    });
  }

  assertNoExtraKeys(payload, root, ['schemaVersion', 'generatedAt', 'batchId', 'person', 'source', 'decisions'], errors);
  return { ok: errors.length === 0, errors };
}

export function validateReviewDecisionsResultContract(payload) {
  const errors = [];
  const root = '$';

  assert(isObject(payload), root, 'expected object', errors);
  if (!isObject(payload)) return { ok: false, errors };

  const required = [
    'schemaVersion',
    'generatedAt',
    'person',
    'batchId',
    'totalDecisions',
    'appliedCount',
    'skippedCount',
    'acknowledgedDecisionIds',
    'applied',
    'skipped',
  ];
  required.forEach((key) => {
    assert(key in payload, `${root}.${key}`, 'missing required property', errors);
  });

  assert(
    payload.schemaVersion === 'mio.review.decisions.result.v1',
    `${root}.schemaVersion`,
    'must be mio.review.decisions.result.v1',
    errors,
  );
  assert(isIsoDateTime(payload.generatedAt), `${root}.generatedAt`, 'expected ISO date-time', errors);
  assert(isString(payload.batchId), `${root}.batchId`, 'expected string', errors);
  assert(Number.isInteger(payload.totalDecisions) && payload.totalDecisions >= 0, `${root}.totalDecisions`, 'expected non-negative integer', errors);
  assert(Number.isInteger(payload.appliedCount) && payload.appliedCount >= 0, `${root}.appliedCount`, 'expected non-negative integer', errors);
  assert(Number.isInteger(payload.skippedCount) && payload.skippedCount >= 0, `${root}.skippedCount`, 'expected non-negative integer', errors);

  assert(isObject(payload.person), `${root}.person`, 'expected object', errors);
  if (isObject(payload.person)) {
    assert(isString(payload.person.id), `${root}.person.id`, 'expected string', errors);
    if ('displayName' in payload.person) {
      assert(isString(payload.person.displayName), `${root}.person.displayName`, 'expected string', errors);
    }
  }

  assertStringArray(payload.acknowledgedDecisionIds, `${root}.acknowledgedDecisionIds`, errors);

  assert(Array.isArray(payload.applied), `${root}.applied`, 'expected array', errors);
  if (Array.isArray(payload.applied)) {
    payload.applied.forEach((item, index) => {
      const path = `${root}.applied[${index}]`;
      assert(isObject(item), path, 'expected object', errors);
      if (!isObject(item)) return;
      ['decisionId', 'reviewItemId', 'bundleId', 'decision'].forEach((key) => {
        assert(isString(item[key]), `${path}.${key}`, 'expected string', errors);
      });
      if ('itemStatus' in item) {
        assert(isNullableString(item.itemStatus), `${path}.itemStatus`, 'expected string or null', errors);
      }
      if ('bundleStatus' in item) {
        assert(isNullableString(item.bundleStatus), `${path}.bundleStatus`, 'expected string or null', errors);
      }
    });
  }

  assert(Array.isArray(payload.skipped), `${root}.skipped`, 'expected array', errors);
  if (Array.isArray(payload.skipped)) {
    payload.skipped.forEach((item, index) => {
      const path = `${root}.skipped[${index}]`;
      assert(isObject(item), path, 'expected object', errors);
      if (!isObject(item)) return;
      assert(isString(item.reason), `${path}.reason`, 'expected string', errors);
      if ('decisionId' in item) {
        assert(isString(item.decisionId), `${path}.decisionId`, 'expected string', errors);
      }
      if ('reviewItemId' in item) {
        assert(isString(item.reviewItemId), `${path}.reviewItemId`, 'expected string', errors);
      }
      if ('bundleId' in item) {
        assert(isString(item.bundleId), `${path}.bundleId`, 'expected string', errors);
      }
      if ('itemStatus' in item) {
        assert(isString(item.itemStatus), `${path}.itemStatus`, 'expected string', errors);
      }
    });
  }

  assertNoExtraKeys(
    payload,
    root,
    [
      'schemaVersion',
      'generatedAt',
      'person',
      'batchId',
      'totalDecisions',
      'appliedCount',
      'skippedCount',
      'acknowledgedDecisionIds',
      'applied',
      'skipped',
    ],
    errors,
  );

  return { ok: errors.length === 0, errors };
}

export function validateGemmaMaintenanceContract(payload) {
  const errors = [];
  const root = '$';

  assert(isObject(payload), root, 'expected object', errors);
  if (!isObject(payload)) return { ok: false, errors };

  ['schemaVersion', 'generatedAt', 'person', 'actions'].forEach((key) => {
    assert(key in payload, `${root}.${key}`, 'missing required property', errors);
  });

  assert(payload.schemaVersion === 'mio.gemma.maintenance.v1', `${root}.schemaVersion`, 'must be mio.gemma.maintenance.v1', errors);
  assert(isIsoDateTime(payload.generatedAt), `${root}.generatedAt`, 'expected ISO date-time', errors);

  assert(isObject(payload.person), `${root}.person`, 'expected object', errors);
  if (isObject(payload.person)) {
    assert(isString(payload.person.id), `${root}.person.id`, 'expected string', errors);
    if ('displayName' in payload.person) {
      assert(isString(payload.person.displayName), `${root}.person.displayName`, 'expected string', errors);
    }
  }

  if ('batchId' in payload) {
    assert(isString(payload.batchId), `${root}.batchId`, 'expected string', errors);
  }
  if ('source' in payload) {
    assertGemmaMaintenanceSource(payload.source, `${root}.source`, errors);
  }

  assert(Array.isArray(payload.actions), `${root}.actions`, 'expected array', errors);
  if (Array.isArray(payload.actions)) {
    payload.actions.forEach((item, index) => {
      assertGemmaMaintenanceAction(item, `${root}.actions[${index}]`, errors);
    });
  }

  assertNoExtraKeys(payload, root, ['schemaVersion', 'generatedAt', 'batchId', 'person', 'source', 'actions'], errors);
  return { ok: errors.length === 0, errors };
}

export function validateGemmaMaintenanceResultContract(payload) {
  const errors = [];
  const root = '$';

  assert(isObject(payload), root, 'expected object', errors);
  if (!isObject(payload)) return { ok: false, errors };

  [
    'schemaVersion',
    'generatedAt',
    'person',
    'batchId',
    'totalActions',
    'appliedCount',
    'skippedCount',
    'acknowledgedActionIds',
    'applied',
    'skipped',
  ].forEach((key) => {
    assert(key in payload, `${root}.${key}`, 'missing required property', errors);
  });

  assert(
    payload.schemaVersion === 'mio.gemma.maintenance.result.v1',
    `${root}.schemaVersion`,
    'must be mio.gemma.maintenance.result.v1',
    errors,
  );
  assert(isIsoDateTime(payload.generatedAt), `${root}.generatedAt`, 'expected ISO date-time', errors);
  assert(isString(payload.batchId), `${root}.batchId`, 'expected string', errors);
  assert(Number.isInteger(payload.totalActions) && payload.totalActions >= 0, `${root}.totalActions`, 'expected non-negative integer', errors);
  assert(Number.isInteger(payload.appliedCount) && payload.appliedCount >= 0, `${root}.appliedCount`, 'expected non-negative integer', errors);
  assert(Number.isInteger(payload.skippedCount) && payload.skippedCount >= 0, `${root}.skippedCount`, 'expected non-negative integer', errors);

  assert(isObject(payload.person), `${root}.person`, 'expected object', errors);
  if (isObject(payload.person)) {
    assert(isString(payload.person.id), `${root}.person.id`, 'expected string', errors);
    if ('displayName' in payload.person) {
      assert(isString(payload.person.displayName), `${root}.person.displayName`, 'expected string', errors);
    }
  }

  if ('reviewBundleId' in payload) {
    assert(isNullableString(payload.reviewBundleId), `${root}.reviewBundleId`, 'expected string or null', errors);
  }

  assertStringArray(payload.acknowledgedActionIds, `${root}.acknowledgedActionIds`, errors);

  assert(Array.isArray(payload.applied), `${root}.applied`, 'expected array', errors);
  if (Array.isArray(payload.applied)) {
    payload.applied.forEach((item, index) => {
      assertGemmaMaintenanceResultItem(item, `${root}.applied[${index}]`, errors);
    });
  }

  assert(Array.isArray(payload.skipped), `${root}.skipped`, 'expected array', errors);
  if (Array.isArray(payload.skipped)) {
    payload.skipped.forEach((item, index) => {
      assertGemmaMaintenanceSkippedItem(item, `${root}.skipped[${index}]`, errors);
    });
  }

  assertNoExtraKeys(
    payload,
    root,
    [
      'schemaVersion',
      'generatedAt',
      'person',
      'batchId',
      'totalActions',
      'appliedCount',
      'skippedCount',
      'reviewBundleId',
      'acknowledgedActionIds',
      'applied',
      'skipped',
    ],
    errors,
  );

  return { ok: errors.length === 0, errors };
}

export function validateContractPayload(contractName, payload) {
  switch (contractName) {
    case 'review-bundle':
      return validateReviewBundleContract(payload);
    case 'gemma-core-context':
      return validateGemmaCoreContextContract(payload);
    case 'review-queue':
      return validateReviewQueueContract(payload);
    case 'review-decisions':
      return validateReviewDecisionsContract(payload);
    case 'review-decisions-result':
      return validateReviewDecisionsResultContract(payload);
    case 'gemma-maintenance':
      return validateGemmaMaintenanceContract(payload);
    case 'gemma-maintenance-result':
      return validateGemmaMaintenanceResultContract(payload);
    default:
      return {
        ok: false,
        errors: [{ path: '$.contract', message: `Unknown contract: ${contractName}` }],
      };
  }
}
