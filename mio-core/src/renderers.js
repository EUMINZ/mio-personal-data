import { buildCompiledIdentitySummary, buildContinuationTimeline } from './identity-context.js';
import { formatMemoryPreview, selectRelevantMemoryItems } from './memory-sidecar.js';

function formatClaimValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function titleizeClaimKey(key) {
  return key.replaceAll('.', ' / ');
}

export function renderPersonDossier(repository, personId) {
  const person = repository.getPerson(personId);
  if (!person) {
    throw new Error(`Unknown person: ${personId}`);
  }

  const claims = repository.listClaimsForPerson(personId);
  const evidence = repository.listEvidenceForPerson(personId);
  const grants = repository.listGrantsForPerson(personId);
  const continuationTimeline = buildContinuationTimeline(repository, personId, { limit: 16 });
  const memoryItems = repository.listMemoryItemsForPerson(personId);
  const wikiEntries = repository.listWikiEntriesForPerson(personId, { limit: 12 });
  const pendingReviewBundles = repository.listReviewBundlesForPerson(personId, {
    statuses: ['pending', 'partially_applied'],
  });
  const pendingReviewItems = repository.listPendingReviewItemsForPerson(personId);
  const compiledIdentity = buildCompiledIdentitySummary(repository, personId);

  const stableClaims = claims.filter((claim) => ['confirmed', 'verified', 'asserted'].includes(claim.status));
  const extractedClaims = claims.filter((claim) => claim.status === 'extracted');

  const lines = [
    `# Identity Dossier: ${person.displayName}`,
    '',
    `- Person ID: \`${person.id}\``,
    `- Generated at: ${new Date().toISOString()}`,
    `- Stable claims: ${stableClaims.length}`,
    `- Extracted claims pending review: ${extractedClaims.length}`,
    `- Evidence records: ${evidence.length}`,
    `- Grants: ${grants.length}`,
    `- Pending review bundles: ${pendingReviewBundles.length}`,
    `- Pending review items: ${pendingReviewItems.length}`,
    `- Explainable notes: ${memoryItems.length}`,
    `- Identity wiki entries: ${wikiEntries.length}`,
    '',
    '## Compiled Identity Summary',
    '',
    compiledIdentity.summaryText,
    '',
    `- Headline: ${compiledIdentity.headlineText}`,
    `- Last updated at: ${compiledIdentity.lastUpdatedAt}`,
    `- Attention fields: ${compiledIdentity.attentionFields.length > 0 ? compiledIdentity.attentionFields.join(', ') : 'none'}`,
    '',
    '## Stable Claims',
    '',
  ];

  if (stableClaims.length === 0) {
    lines.push('_No stable claims yet._', '');
  } else {
    for (const claim of stableClaims) {
      lines.push(
        `- **${titleizeClaimKey(claim.claimTypeKey)}**: ${formatClaimValue(claim.value)} ` +
          `(status: ${claim.status}${claim.issuer ? `, issuer: ${claim.issuer}` : ''})`,
      );
    }
    lines.push('');
  }

  lines.push('## Extracted Claims Awaiting Review', '');
  if (extractedClaims.length === 0) {
    lines.push('_No extracted claims pending review._', '');
  } else {
    for (const claim of extractedClaims) {
      lines.push(
        `- **${titleizeClaimKey(claim.claimTypeKey)}**: ${formatClaimValue(claim.value)} ` +
          `(confidence: ${claim.confidence ?? 'n/a'}, issuer: ${claim.issuer ?? 'unknown'})`,
      );
    }
    lines.push('');
  }

  lines.push('## Evidence Ledger', '');
  if (evidence.length === 0) {
    lines.push('_No evidence records yet._', '');
  } else {
    for (const item of evidence) {
      lines.push(
        `- **${item.kind}**: ${item.sourceName || item.storageUri} ` +
          `(\`${item.id}\`, captured: ${item.capturedAt ?? 'unknown'})`,
      );
    }
    lines.push('');
  }

  lines.push('## Identity Wiki', '');
  if (wikiEntries.length === 0) {
    lines.push('_No identity wiki entries yet._', '');
  } else {
    for (const entry of wikiEntries) {
      const headline = entry.valueText || entry.summaryText || entry.title;
      lines.push(
        `- **${entry.title}**: ${headline} ` +
          `(status: ${entry.status}, trust: ${entry.trustLevel}${entry.fieldKey ? `, field: ${entry.fieldKey}` : ''})`,
      );
    }
    lines.push('');
  }

  lines.push('## Active Grants', '');
  const activeGrants = grants.filter((grant) => grant.status === 'active');
  if (activeGrants.length === 0) {
    lines.push('_No active grants._', '');
  } else {
    for (const grant of activeGrants) {
      const scope = grant.scope?.allowedFields ?? [];
      lines.push(
        `- **${grant.purpose}**: requester \`${grant.requesterId}\`, expires ${grant.expiresAt ?? 'unknown'}, ` +
          `fields: ${scope.length}`,
      );
    }
    lines.push('');
  }

  lines.push('## Timeline', '');
  if (continuationTimeline.length === 0) {
    lines.push('_No timeline entries yet._', '');
  } else {
    for (const entry of continuationTimeline) {
      lines.push(`- **${entry.eventAt}**: ${entry.title}`);
      if (entry.detail) {
        lines.push(`  ${entry.detail}`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function renderPendingReviewQueue(repository, personId) {
  const person = repository.getPerson(personId);
  if (!person) {
    throw new Error(`Unknown person: ${personId}`);
  }

  const bundles = repository.listReviewBundlesForPerson(personId, {
    statuses: ['pending', 'partially_applied'],
  });
  const memoryItems = repository.listMemoryItemsForPerson(personId);

  const lines = [
    `# Pending Review Queue: ${person.displayName}`,
    '',
    `- Person ID: \`${person.id}\``,
    `- Pending bundles: ${bundles.length}`,
    `- Generated at: ${new Date().toISOString()}`,
    '',
  ];

  if (bundles.length === 0) {
    lines.push('_No pending review bundles._', '');
    return `${lines.join('\n').trim()}\n`;
  }

  for (const bundle of bundles) {
    const items = repository.listReviewItemsForBundle(bundle.id, {
      statuses: ['pending'],
    });

    lines.push(`## ${bundle.stageLabel || bundle.stageKey || 'Review Bundle'}`, '');
    lines.push(`- Bundle ID: \`${bundle.id}\``);
    lines.push(`- Producer: ${bundle.producer || bundle.sourceSystem}`);
    lines.push(`- Status: ${bundle.status}`);
    lines.push(`- Created at: ${bundle.createdAt}`);
    lines.push(`- Requested fields: ${bundle.requestedFields.length}`);
    lines.push(`- Injected fields: ${bundle.injectedFields.length}`);
    lines.push(`- Pending items: ${items.length}`, '');

    if (items.length === 0) {
      lines.push('_No pending review items in this bundle._', '');
      continue;
    }

    for (const item of items) {
      const relatedMemory = selectRelevantMemoryItems(memoryItems, {
        fieldKey: item.fieldKey,
        sessionOrBundleId: bundle.id,
        limit: 2,
      });

      lines.push(
        `- **${item.fieldKey}** -> ${String(item.suggestedValue)} ` +
          `(type: ${item.itemType}, target: ${item.target}${item.currentValue ? `, current: ${String(item.currentValue)}` : ''})`,
      );
      if (item.rationale) {
        lines.push(`  rationale: ${item.rationale}`);
      }
      if (relatedMemory.length > 0) {
        lines.push(`  why: ${formatMemoryPreview(relatedMemory[0])}`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}
