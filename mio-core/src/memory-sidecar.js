function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function collapseWhitespace(value) {
  return normalizeString(value).replace(/\s+/g, ' ');
}

export function summarizeSnippet(value, maxLength = 220) {
  const normalized = collapseWhitespace(value);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function extractSnippetAroundNeedle(text, needle, { window = 96, maxLength = 220 } = {}) {
  const normalizedText = collapseWhitespace(text);
  if (!normalizedText) return '';

  const normalizedNeedle = collapseWhitespace(needle);
  if (!normalizedNeedle) {
    return summarizeSnippet(normalizedText, maxLength);
  }

  const index = normalizedText.toLowerCase().indexOf(normalizedNeedle.toLowerCase());
  if (index === -1) {
    return summarizeSnippet(normalizedText, maxLength);
  }

  const start = Math.max(0, index - window);
  const end = Math.min(normalizedText.length, index + normalizedNeedle.length + window);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedText.length ? '...' : '';
  return summarizeSnippet(`${prefix}${normalizedText.slice(start, end)}${suffix}`, maxLength);
}

const KIND_PRIORITIES = {
  review_rationale: 3,
  execution_note: 2,
  evidence_note: 1,
};

function kindPriority(kind) {
  return KIND_PRIORITIES[normalizeString(kind)] ?? 0;
}

export function selectRelevantMemoryItems(
  memoryItems,
  { fieldKey = '', sessionOrBundleId = '', limit = 3 } = {},
) {
  const normalizedFieldKey = normalizeString(fieldKey);
  const normalizedSessionId = normalizeString(sessionOrBundleId);

  return [...memoryItems]
    .filter((item) => {
      if (normalizedFieldKey && normalizeString(item.fieldKey) !== normalizedFieldKey) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const leftSameSession =
        normalizedSessionId &&
        normalizeString(left.sessionOrBundleId) === normalizedSessionId;
      const rightSameSession =
        normalizedSessionId &&
        normalizeString(right.sessionOrBundleId) === normalizedSessionId;

      if (leftSameSession !== rightSameSession) {
        return leftSameSession ? -1 : 1;
      }

      const leftKindPriority = kindPriority(left.kind);
      const rightKindPriority = kindPriority(right.kind);
      if (leftKindPriority !== rightKindPriority) {
        return rightKindPriority - leftKindPriority;
      }

      return normalizeString(right.createdAt).localeCompare(normalizeString(left.createdAt));
    })
    .slice(0, limit);
}

export function formatMemoryPreview(memoryItem) {
  const headline = summarizeSnippet(memoryItem.title || '', 72);
  const detail = summarizeSnippet(memoryItem.snippetText || memoryItem.rationale || '', 140);
  if (headline && detail) {
    return `${headline}: ${detail}`;
  }
  return headline || detail;
}
