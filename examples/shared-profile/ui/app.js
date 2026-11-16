const fragment = new URLSearchParams(window.location.hash.slice(1));
// The launcher token stays in this document's memory, never in browser storage.
const token = fragment.get('token');
if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);

const $ = (id) => document.getElementById(id);
const EMAIL = 'person.contact.email';
let state = null;
let busy = false;
let refreshPromise = null;
let connected = false;
let connectionNotice = false;
const rendered = new Map();
// Keep in-progress operator notes in this page only, across background polls.
const reviewDrafts = new Map();
const reviewCards = new Map();

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text ?? '');
  return element;
}
function showMessage(text, error = false) {
  const message = $('message');
  message.textContent = text;
  message.classList.toggle('error', error);
  message.hidden = false;
  message.setAttribute('role', error ? 'alert' : 'status');
}
function connection(ok, text) {
  connected = ok;
  $('connection-label').textContent = text;
  $('connection-dot').classList.toggle('connected', ok);
  $('connection-dot').classList.toggle('error', !ok);
  updateControls();
}
function formatTime(value, full = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, full
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}
function display(value) {
  return value === null || value === undefined ? 'Unavailable' : String(value);
}
function renderIfChanged(key, value, render) {
  const signature = JSON.stringify(value);
  if (rendered.get(key) !== signature) {
    render(value);
    rendered.set(key, signature);
  }
}
function updateControls() {
  const assistant = state?.assistants.find((entry) => entry.id === 'a');
  const active = assistant?.status === 'active';
  const emailReadable = assistant?.fields.some((entry) => entry.field === EMAIL && entry.state === 'shared');
  $('proposal-fields').disabled = busy || !connected || !active || !emailReadable;
  $('propose-button').textContent = busy ? 'Working…' : 'Propose email update ↗';
  $('proposal-availability').textContent = !active
    ? 'Assistant A cannot propose changes while its grant is inactive.'
    : !emailReadable
      ? 'Share the current email with A before it can propose another update.'
      : 'Submitting a proposal leaves the confirmed record unchanged.';
  for (const button of document.querySelectorAll('[data-mutation]')) {
    button.disabled = busy || !connected || button.dataset.stale === 'true';
  }
  for (const input of document.querySelectorAll('[data-review-input]')) {
    input.disabled = busy || !connected;
  }
  $('refresh-button').disabled = busy;
  $('workspace').setAttribute('aria-busy', String(busy));
}
async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'X-Mio-Token': token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The local server took too long to respond. Check the latest state before trying an action again.');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
function renderClaims(claims) {
  const items = claims.map((claim) => {
    const row = node('div', 'fact');
    row.append(node('dt', '', claim.label));
    const value = node('dd', '', display(claim.value));
    value.append(node('span', 'source', claim.source || 'Confirmed local record'));
    row.append(value);
    return row;
  });
  $('claims').replaceChildren(...items);
}
function actionButton(label, className, handler) {
  const button = node('button', className, label);
  button.type = 'button';
  button.dataset.mutation = 'true';
  button.addEventListener('click', handler);
  return button;
}
function renderReviews(reviews) {
  const container = $('reviews');
  const focused = document.activeElement;
  const focusedReview = focused?.closest('[data-review-id]')?.dataset.reviewId;
  const focusedControl = focused?.dataset.reviewControl;
  const selection = focusedControl === 'reason' ? [focused.selectionStart, focused.selectionEnd] : null;
  const pending = new Set(reviews.map((review) => review.reviewItemId));
  for (const id of reviewCards.keys()) {
    if (!pending.has(id)) {
      reviewCards.get(id).element.remove();
      reviewCards.delete(id);
      reviewDrafts.delete(id);
    }
  }
  $('review-count').textContent = `${reviews.length} pending`;
  $('review-count').classList.toggle('has-pending', reviews.length > 0);
  if (!reviews.length) {
    const empty = node('div', 'empty-state');
    empty.append(node('strong', '', 'No changes waiting for review.'), node('p', '', 'Use the demo control below, or ask a connected assistant to propose a new email.'));
    container.replaceChildren(empty);
    if (focusedReview) $('reviews-title').focus({ preventScroll: true });
    return;
  }
  if (!container.querySelector('[data-review-id]')) container.replaceChildren();
  reviews.forEach((review, index) => {
    const signature = JSON.stringify(review);
    const existing = reviewCards.get(review.reviewItemId);
    let card;
    if (existing?.signature === signature) {
      card = existing.element;
    } else {
      card = buildReviewCard(review);
      if (existing) existing.element.replaceWith(card);
      reviewCards.set(review.reviewItemId, { signature, element: card });
    }
    const position = container.children[index];
    if (position !== card) container.insertBefore(card, position ?? null);
  });
  if (focusedReview && focusedControl && document.activeElement !== focused) {
    const card = reviewCards.get(focusedReview)?.element;
    const control = card && [...card.querySelectorAll('[data-review-control]')]
      .find((entry) => entry.dataset.reviewControl === focusedControl);
    if (control && !control.disabled) {
      control.focus({ preventScroll: true });
      if (selection) control.setSelectionRange(...selection);
    } else {
      const fallback = card?.querySelector('[data-review-control="close-stale"]') ?? $('reviews-title');
      fallback.focus({ preventScroll: true });
    }
  }
}
function buildReviewCard(review) {
    const card = node('article', 'review');
    card.dataset.reviewId = review.reviewItemId;
    const top = node('div', 'review-top');
    top.append(node('h3', '', `${review.label} update`), node('span', 'review-origin', `Assistant ${review.assistantId.toUpperCase()} proposal`));
    const comparison = node('div', 'comparison');
    for (const [index, label, value] of [[0, 'Value when proposed', review.currentValue], [1, 'Suggested', review.suggestedValue]]) {
      if (index) comparison.append(node('span', 'comparison-arrow', '→'));
      const part = node('div');
      part.append(node('span', 'comparison-label', label), node('p', `comparison-value${index ? ' proposed' : ''}`, display(value)));
      comparison.append(part);
    }
    const rationale = node('div', 'rationale');
    rationale.append(node('span', 'comparison-label', 'Assistant’s reason · not independently verified'), node('p', '', review.rationale));
    const footer = node('div', 'review-footer');
    const actions = node('div', 'review-actions');
    const approveButton = actionButton('Approve update', 'button', () => mutate('/api/approve', {
      assistantId: review.assistantId, reviewItemId: review.reviewItemId,
      expectedVersion: review.expectedVersion, expectedValue: review.suggestedValue, confirmed: true,
    }, 'Update approved. Share the new version with an assistant when you are ready.', 'reviews-title'));
    approveButton.dataset.stale = String(review.stale === true);
    approveButton.dataset.reviewControl = 'approve';
    approveButton.disabled = review.stale === true;
    actions.append(approveButton);
    if (review.stale) {
      const closeButton = actionButton('Close outdated proposal', 'button secondary', () => mutate('/api/close-stale', {
        assistantId: review.assistantId, reviewItemId: review.reviewItemId,
        expectedVersion: review.expectedVersion, confirmed: true,
      }, 'Outdated proposal closed. Confirmed facts and sharing are unchanged.', 'reviews-title'));
      closeButton.dataset.reviewControl = 'close-stale';
      actions.append(closeButton);
    }
    footer.append(node('p', review.stale ? 'stale-notice' : '', review.stale
      ? 'This proposal no longer matches the current fact. Closing it leaves facts and sharing unchanged.'
      : 'Approving updates the fact. Sharing is a separate choice.'), actions);
    card.append(top, comparison, rationale, footer);
    if (!review.stale) card.append(buildRejectionForm(review));
    return card;
}
function buildRejectionForm(review) {
  const draft = reviewDrafts.get(review.reviewItemId) ?? { reason: '', open: false };
  reviewDrafts.set(review.reviewItemId, draft);
  const details = node('details', 'rejection');
  details.open = draft.open;
  const summary = node('summary', '', 'Reject this proposal');
  summary.dataset.reviewControl = 'reject-toggle';
  const form = node('form', 'rejection-form');
  const reasonId = `reject-reason-${review.reviewItemId}`;
  const label = node('label', '', 'Reason for rejection');
  label.htmlFor = reasonId;
  const reason = node('textarea');
  reason.id = reasonId;
  reason.name = 'reason';
  reason.rows = 2;
  reason.maxLength = 1000;
  reason.required = true;
  reason.value = draft.reason;
  reason.dataset.reviewControl = 'reason';
  reason.dataset.reviewInput = 'true';
  reason.setAttribute('aria-describedby', `${reasonId}-hint`);
  const hint = node('p', 'field-hint', 'Required. Saved with the decision; confirmed facts and sharing stay unchanged.');
  hint.id = `${reasonId}-hint`;
  const actions = node('div', 'rejection-actions');
  const confirm = node('button', 'button reject', 'Confirm rejection');
  confirm.type = 'submit';
  confirm.dataset.mutation = 'true';
  confirm.dataset.reviewControl = 'reject-confirm';
  const cancel = node('button', 'text-button', 'Cancel');
  cancel.type = 'button';
  cancel.dataset.reviewControl = 'reject-cancel';
  cancel.addEventListener('click', () => { details.open = false; summary.focus(); });
  actions.append(confirm, cancel);
  form.append(label, reason, hint, actions);
  details.append(summary, form);
  details.addEventListener('toggle', () => { draft.open = details.open; });
  reason.addEventListener('input', () => { draft.reason = reason.value; reason.setCustomValidity(''); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    reason.setCustomValidity(reason.value.trim() ? '' : 'Enter a reason for rejecting this proposal.');
    if (!form.reportValidity()) return;
    mutate('/api/reject', {
      assistantId: review.assistantId, reviewItemId: review.reviewItemId,
      expectedVersion: review.expectedVersion, reason: reason.value.trim(), confirmed: true,
    }, 'Proposal rejected. Confirmed facts and sharing are unchanged.', 'reviews-title');
  });
  return details;
}
function renderDecisions(decisions) {
  $('decision-count').textContent = `${decisions.length} recent`;
  if (!decisions.length) {
    $('decisions').replaceChildren(node('p', 'decision-empty', 'Approved, rejected and outdated proposals will be recorded here.'));
    return;
  }
  const labels = { accepted: 'Approved', dismissed: 'Rejected', superseded: 'Closed as outdated' };
  const list = node('ol', 'decision-list');
  for (const decision of decisions) {
    const row = node('li', 'decision');
    const top = node('div', 'decision-top');
    const label = labels[decision.decision] ?? 'Decision recorded';
    top.append(node('strong', '', `${decision.label} · ${label}`));
    const time = node('time', '', formatTime(decision.resolvedAt, true));
    if (Number.isFinite(Date.parse(decision.resolvedAt))) time.dateTime = new Date(decision.resolvedAt).toISOString();
    top.append(time);
    row.append(top, node('p', 'decision-value', `Assistant ${decision.assistantId.toUpperCase()} proposed: ${display(decision.suggestedValue)}`));
    if (decision.note) row.append(node('p', 'decision-note', `${decision.decision === 'dismissed' ? 'Rejection reason' : 'Decision note'}: ${decision.note}`));
    row.append(node('p', 'decision-effect', decision.decision === 'accepted'
      ? 'Approval recorded. Sharing is a separate decision.' : 'No confirmed fact or sharing permission changed.'));
    list.append(row);
  }
  $('decisions').replaceChildren(list);
}
function renderAssistants(assistants) {
  const cards = assistants.map((assistant) => {
    const section = node('section', 'assistant');
    const header = node('div', 'assistant-header');
    header.append(node('span', 'assistant-initial', assistant.id.toUpperCase()), node('h3', '', assistant.label));
    header.append(node('span', `assistant-status ${assistant.status}`, assistant.status === 'active' ? 'Grant active' : `Grant ${assistant.status}`));
    section.append(header);
    const list = node('ul', 'access-list');
    for (const field of assistant.fields) {
      const row = node('li', 'access-item');
      row.append(node('span', 'access-item-label', field.label));
      if (field.state === 'shared') {
        row.append(node('span', 'access-item-value', display(field.value)), node('span', 'access-state', 'Current version shared'));
      } else {
        row.append(node('span', 'access-item-value', 'Unavailable to this assistant'));
        row.append(node('span', `access-state ${field.state}`, field.state === 'unshared' ? 'New version awaiting your sharing decision' : 'No value can be read with this grant'));
      }
      const claim = state.claims.find((entry) => entry.field === field.field);
      if (field.state === 'unshared' && assistant.status === 'active' && claim) {
        const share = node('div', 'share-action');
        share.append(actionButton(`Share latest ${field.label.toLowerCase()}`, 'button secondary', () => mutate('/api/share', {
          assistantId: assistant.id, field: field.field, claimId: claim.claimId, confirmed: true,
        }, `Latest ${field.label.toLowerCase()} shared with ${assistant.label}.`, 'access-title')));
        row.append(share);
      }
      list.append(row);
    }
    section.append(list);
    const footer = node('div', 'assistant-footer');
    footer.append(node('p', '', assistant.expiresAt ? `Grant expires ${formatTime(assistant.expiresAt, true)}` : 'No grant expiry recorded'));
    if (assistant.status === 'active') {
      footer.append(actionButton(`Revoke ${assistant.id.toUpperCase()}`, 'text-button danger', () => mutate('/api/revoke', {
        assistantId: assistant.id, confirmed: true,
      }, `${assistant.label} access revoked. Future tool reads will be denied.`, 'access-title')));
    }
    section.append(footer);
    return section;
  });
  $('assistants').replaceChildren(...cards);
}
function renderAudit(events) {
  if (!events.length) {
    $('audit').replaceChildren(node('li', 'audit-empty', 'Activity will appear here as you use the demo.'));
    return;
  }
  $('audit').replaceChildren(...events.map((event) => {
    const row = node('li');
    const time = node('time', '', formatTime(event.time));
    if (Number.isFinite(new Date(event.time).getTime())) time.dateTime = new Date(event.time).toISOString();
    row.append(time, node('span', 'audit-actor', event.actor), node('p', '', event.summary));
    return row;
  }));
}
function render(next) {
  state = next;
  if (connectionNotice) {
    $('message').hidden = true;
    connectionNotice = false;
  }
  $('person-name').textContent = next.person.name;
  renderIfChanged('claims', next.claims, renderClaims);
  renderIfChanged('reviews', next.reviews, renderReviews);
  renderIfChanged('decisions', next.decisions ?? [], renderDecisions);
  // A new claim version changes sharing buttons even when grant metadata does not.
  renderIfChanged('access', { assistants: next.assistants, claims: next.claims }, ({ assistants }) => renderAssistants(assistants));
  renderIfChanged('audit', next.audit, renderAudit);
  $('workspace').hidden = false;
  $('activity-section').hidden = false;
  $('loading').hidden = true;
  $('updated-at').textContent = `Last checked ${formatTime(new Date())}`;
  connection(true, 'Local connection');
}
function refresh(force = false) {
  if (refreshPromise) return refreshPromise;
  if (busy && !force) return Promise.resolve();
  refreshPromise = request('/api/state').then((next) => {
    if (!busy || force) render(next);
  }).catch((error) => {
    connection(false, 'Connection lost');
    showMessage(`${error.message} Reopen the launch URL from your terminal if this page was reloaded.`, true);
    connectionNotice = true;
    $('loading').hidden = true;
    throw error;
  }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}
async function mutate(path, body, successMessage, focusId) {
  if (busy || !connected) return;
  busy = true;
  updateControls();
  let succeeded = false;
  try {
    // Let any older poll finish before mutation, then read the committed state.
    if (refreshPromise) await refreshPromise;
    await request(path, { method: 'POST', body: JSON.stringify(body) });
    succeeded = true;
    await refresh(true);
    showMessage(successMessage);
    if (focusId) $(focusId).focus();
  } catch (error) {
    showMessage(succeeded ? `Action completed, but the latest state could not be loaded: ${error.message}` : error.message, true);
    // Re-read after a stale review/version rejection; never silently retry a write.
    if (!succeeded) await refresh(true).catch(() => {});
  } finally {
    busy = false;
    updateControls();
  }
}
$('proposal-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!$('proposal-form').reportValidity()) return;
  mutate('/api/propose', {
    assistantId: 'a', field: EMAIL, value: $('new-email').value.trim(), rationale: $('rationale').value.trim(),
  }, 'Proposal submitted. The confirmed email stays unchanged until you approve it.', 'reviews-title');
});
$('refresh-button').addEventListener('click', () => refresh().catch(() => {}));
if (!token) {
  $('loading').hidden = true;
  connection(false, 'Launch link needed');
  showMessage('Open the complete launch URL printed by the local demo server. Its access token is held only while this page stays open; reloading requires that link again.', true);
} else {
  refresh().catch(() => {});
  window.setInterval(() => {
    if (!document.hidden && !busy) refresh().catch(() => {});
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !busy) refresh().catch(() => {});
  });
}
