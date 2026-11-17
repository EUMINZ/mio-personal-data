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
// Unsaved form inputs remain in this document only; generated snapshots are
// persisted by the server. Polling never replaces the displayed snapshot or
// changes information the operator is still typing.
const scenarioCards = new Map();
const scenarioDrafts = new Map();
let selectedScenario = null;

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
    button.disabled = busy || !connected || button.dataset.stale === 'true' || button.dataset.blocked === 'true';
  }
  for (const input of document.querySelectorAll('[data-review-input]')) {
    input.disabled = busy || !connected;
  }
  for (const input of document.querySelectorAll('[data-scene-input]')) {
    input.disabled = busy || !connected;
  }
  for (const fieldset of document.querySelectorAll('[data-collection-fields]')) {
    fieldset.disabled = busy || !connected || fieldset.dataset.blocked === 'true';
  }
  $('refresh-button').disabled = busy;
  $('workspace').setAttribute('aria-busy', String(busy));
  $('scenario-section').setAttribute('aria-busy', String(busy));
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
    value.append(node('span', 'source', sourceLabel(claim.source)));
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
function sourceLabel(source) {
  if (typeof source === 'string') return source;
  if (!source || typeof source !== 'object') return 'Confirmed profile record';
  const kind = source.kind === 'document-extracted' ? 'Document extraction reported' : source.kind === 'user-stated' ? 'User statement reported' : 'Source recorded';
  return `${kind}${source.reference ? `: ${source.reference}` : ''}${source.locator ? ` · ${source.locator}` : ''}`;
}
function selectScenario(id, focus = false) {
  selectedScenario = id;
  for (const [key, card] of scenarioCards) {
    const active = key === id;
    card.element.hidden = !active;
    card.tab.setAttribute('aria-selected', String(active));
    card.tab.tabIndex = active ? 0 : -1;
    if (active && focus) card.tab.focus();
  }
}
function sceneInput(labelText, id, value = '', { type = 'text', maxLength = 2048, required = true } = {}) {
  const wrapper = node('div', 'scene-input');
  const label = node('label', '', labelText);
  label.htmlFor = id;
  const input = node('input');
  input.id = id;
  input.type = type;
  input.value = value;
  input.maxLength = maxLength;
  input.required = required;
  input.autocomplete = 'off';
  input.dataset.sceneInput = 'true';
  wrapper.append(label, input);
  return { wrapper, input };
}
function buildCollection(scene, field) {
  const details = node('details', 'collection-form');
  const summary = node('summary', '', `Collect ${field.label.toLowerCase()}`);
  const form = node('form');
  const fieldset = node('fieldset');
  fieldset.dataset.collectionFields = 'true';
  const fieldId = `collect-${scene.id}-${field.inputKey}`;
  const examples = { 'person.employment.employer': 'Example Studio', 'person.employment.job_title': 'Operations coordinator' };
  const value = sceneInput('New personal information', `${fieldId}-value`, examples[field.claimTypeKey] ?? '', {});
  const sourceTypeLabel = node('label', '', 'How was it collected?');
  sourceTypeLabel.htmlFor = `${fieldId}-source-kind`;
  const sourceType = node('select');
  sourceType.id = `${fieldId}-source-kind`;
  sourceType.dataset.sceneInput = 'true';
  for (const [key, text] of [['user-stated', 'Stated by the person'], ['document-extracted', 'Extracted from a document']]) {
    const option = node('option', '', text); option.value = key; sourceType.append(option);
  }
  const reference = sceneInput('Source reference', `${fieldId}-reference`, 'Fictional statement from Alex for this trial', { maxLength: 300 });
  const locator = sceneInput('Page or location (optional)', `${fieldId}-locator`, '', { maxLength: 300, required: false });
  const rationale = sceneInput('Why keep this information?', `${fieldId}-rationale`, 'Reusable employment information for future applications.', { maxLength: 1000 });
  const hint = node('p', 'field-hint', 'Use fictional information. The source is a reported reference, not independent verification. Review and sharing are still required.');
  const button = node('button', 'button secondary', 'Send for review');
  button.type = 'submit'; button.dataset.mutation = 'true';
  const notice = node('p', 'collection-notice');
  fieldset.append(value.wrapper, sourceTypeLabel, sourceType, reference.wrapper, locator.wrapper, rationale.wrapper, hint, button);
  form.append(fieldset, notice); details.append(summary, form);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const input of [value.input, reference.input, rationale.input]) {
      input.setCustomValidity(input.value.trim() ? '' : 'Enter a value before sending this proposal.');
    }
    if (!form.reportValidity()) return;
    const source = { kind: sourceType.value, reference: reference.input.value.trim() };
    if (locator.input.value.trim()) source.locator = locator.input.value.trim();
    mutate('/api/collect', { assistantId: scene.assistantId, field: field.claimTypeKey,
      value: value.input.value.trim(), rationale: rationale.input.value.trim(), source,
    }, 'New information is waiting for review. It will not appear in either draft until approved and shared.', 'reviews-title');
  });
  for (const input of [value.input, reference.input, rationale.input]) input.addEventListener('input', () => input.setCustomValidity(''));
  return { element: details, fieldset, button, notice };
}
function buildScenario(scene) {
  const tab = node('button', 'scenario-tab', scene.label);
  tab.type = 'button'; tab.id = `tab-${scene.id}`; tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', `scenario-${scene.id}`);
  tab.addEventListener('click', () => selectScenario(scene.id));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const keys = [...scenarioCards.keys()]; const current = keys.indexOf(scene.id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    selectScenario(keys[next], true);
  });
  const element = node('div', 'scenario-panel');
  element.id = `scenario-${scene.id}`; element.setAttribute('role', 'tabpanel'); element.setAttribute('aria-labelledby', tab.id);
  const heading = node('div', 'scenario-heading');
  heading.append(node('h3', '', scene.label), node('p', '', `${scene.recipient} · Assistant ${scene.assistantId.toUpperCase()}`));
  const description = node('p', 'scene-description', scene.description);
  const grid = node('div', 'scenario-grid');
  const editor = node('div', 'scenario-editor');
  editor.append(node('h4', 'subheading', 'From your identity profile'));
  const identity = node('div', 'scenario-identity');
  const fieldRows = new Map();
  for (const field of scene.fields) {
    const row = node('div', 'scene-fact');
    const label = node('div', 'scene-fact-label', field.label);
    const body = node('div', 'scene-fact-body');
    const value = node('p', 'scene-fact-value');
    const status = node('p', 'scene-fact-status');
    const sharing = node('div', 'scene-share');
    body.append(value, status, sharing); row.append(label, body);
    const collection = buildCollection(scene, field);
    row.append(collection.element); identity.append(row);
    fieldRows.set(field.inputKey, { row, value, status, sharing, collection, signature: null });
  }
  editor.append(identity);
  const taskForm = node('form', 'task-form');
  taskForm.append(node('h4', 'subheading', 'For this application only'), node('p', 'field-hint', 'These answers stay with the draft and do not become personal identity facts.'));
  const taskInputs = new Map();
  for (const field of scene.taskFields) {
    const input = sceneInput(field.label, `task-${scene.id}-${field.key}`, field.value ?? '', { type: field.type ?? 'text', maxLength: Math.min(field.maxLength ?? 300, 300), required: field.required !== false });
    input.input.placeholder = field.placeholder ?? '';
    taskInputs.set(field.key, input.input); taskForm.append(input.wrapper);
  }
  const generate = node('button', 'button', 'Generate draft');
  generate.type = 'submit'; generate.dataset.mutation = 'true';
  const draftNotice = node('p', 'field-hint', 'Uses the current versions shared with this assistant. Missing identity fields remain blank.');
  taskForm.append(generate, draftNotice);
  const draft = node('section', 'draft-sheet');
  draft.id = `draft-${scene.id}`; draft.tabIndex = -1; draft.setAttribute('aria-label', `${scene.label} generated draft`);
  taskForm.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const input of taskInputs.values()) input.setCustomValidity(input.required && !input.value.trim() ? 'Enter the task-specific answer.' : '');
    if (!taskForm.reportValidity()) return;
    const taskValues = Object.fromEntries([...taskInputs].map(([key, input]) => [key, input.value.trim()]));
    mutate('/api/draft', { assistantId: scene.assistantId, scenarioId: scene.id, taskValues },
      'Draft generated from the current authorized facts. Nothing was submitted.', draft.id, (result) => {
        scenarioDrafts.set(scene.id, result); renderDraft(scene.id);
      });
  });
  for (const input of taskInputs.values()) input.addEventListener('input', () => { input.setCustomValidity(''); updateDraftNotice(scene.id); });
  editor.append(taskForm); grid.append(editor, draft); element.append(heading, description, grid);
  return { tab, element, fieldRows, taskInputs, generate, draftNotice, draft };
}
function renderScenarios(scenarios) {
  $('scenario-section').hidden = false;
  $('legacy-scene-notice').hidden = scenarios.length !== 0;
  $('scenario-tabs').hidden = scenarios.length === 0;
  for (const scene of scenarios) {
    let card = scenarioCards.get(scene.id);
    if (!card) {
      const saved = (state.drafts ?? []).find((draft) => draft.scenarioId === scene.id);
      if (saved && !scenarioDrafts.has(scene.id)) scenarioDrafts.set(scene.id, saved);
      card = buildScenario(scene); scenarioCards.set(scene.id, card);
      if (saved) {
        for (const field of saved.fields ?? []) {
          const input = field.origin === 'task' ? card.taskInputs.get(field.inputKey) : null;
          if (input) input.value = String(field.value ?? '');
        }
      }
      $('scenario-tabs').append(card.tab); $('scenarios').append(card.element); renderDraft(scene.id);
    }
    const active = scene.active === true;
    card.generate.dataset.blocked = String(!active);
    card.draftNotice.textContent = active
      ? 'Uses the current versions shared with this assistant. Missing identity fields remain blank.'
      : 'This assistant’s grant is inactive. A new draft cannot be generated.';
    for (const field of scene.fields) {
      const row = card.fieldRows.get(field.inputKey);
      if (!row) continue;
      const pending = state.reviews.some((review) => review.assistantId === scene.assistantId && review.field === field.claimTypeKey && review.proposalKind === 'new-fact' && !review.stale);
      const access = state.assistants.find((assistant) => assistant.id === scene.assistantId)?.fields.find((entry) => entry.field === field.claimTypeKey);
      const claim = state.claims.find((entry) => entry.field === field.claimTypeKey);
      row.value.textContent = field.state === 'shared' ? display(field.value) : 'Not available to this assistant';
      row.status.textContent = field.state === 'shared' ? `Current version shared · ${sourceLabel(field.source)}`
        : pending ? 'Awaiting your review. Proposed information is not used in drafts.'
        : access?.state === 'unshared' ? 'Confirmed in your profile. Choose whether to share this version.'
        : 'Missing or unavailable under the current grant.';
      const shareSignature = JSON.stringify([active, access?.state, claim?.claimId]);
      if (row.signature !== shareSignature) {
        const hadShareFocus = row.sharing.contains(document.activeElement);
        row.sharing.replaceChildren();
        if (active && access?.state === 'unshared' && claim) {
          row.sharing.append(actionButton(`Share ${field.label.toLowerCase()} with ${scene.label.toLowerCase()}`, 'button secondary', () => mutate('/api/share', {
            assistantId: scene.assistantId, field: field.claimTypeKey, claimId: claim.claimId, confirmed: true,
          }, `Confirmed ${field.label.toLowerCase()} shared with ${scene.label.toLowerCase()}. Generate a new draft to use it.`, 'scenarios-title')));
        }
        row.signature = shareSignature;
        if (hadShareFocus) $('scenarios-title').focus({ preventScroll: true });
      }
      row.collection.element.hidden = !field.collectible && !pending;
      row.collection.fieldset.dataset.blocked = String(!active || !field.collectible || pending);
      row.collection.button.dataset.blocked = row.collection.fieldset.dataset.blocked;
      row.collection.notice.textContent = pending ? 'Proposal saved. Review it in the queue below.' : '';
    }
    updateDraftNotice(scene.id);
  }
  if (!selectedScenario || !scenarioCards.has(selectedScenario)) selectedScenario = scenarios[0]?.id ?? null;
  selectScenario(selectedScenario);
}
function renderDraft(sceneId) {
  const card = scenarioCards.get(sceneId);
  if (!card) return;
  const draft = scenarioDrafts.get(sceneId);
  if (!draft) {
    card.draft.replaceChildren(node('p', 'eyebrow', 'Your draft will appear here'), node('h3', '', 'A preview, with its sources.'),
      node('p', 'draft-empty', 'Generate a draft to see which confirmed facts this assistant can use. Add missing information through review, then generate again.'));
    return;
  }
  const heading = node('div', 'draft-heading');
  heading.append(node('span', 'eyebrow', 'Draft · not submitted'), node('span', 'draft-time', formatTime(draft.createdAt, true)));
  const list = node('dl', 'draft-fields');
  for (const field of draft.fields ?? []) {
    const row = node('div', 'draft-field');
    const value = node('dd', '', display(field.value));
    value.append(node('span', 'draft-origin', field.origin === 'identity' ? `From approved profile · ${sourceLabel(field.source)}` : 'For this application only'));
    if (field.origin === 'identity') {
      const provenance = node('details', 'draft-provenance');
      provenance.append(node('summary', '', 'Source and version'));
      const version = field.claimId ?? field.source?.claimId;
      if (version) provenance.append(node('p', '', `Fact version: ${version}`));
      provenance.append(node('p', '', sourceLabel(field.source)));
      if (field.source?.confirmedAt) provenance.append(node('p', '', `Confirmed: ${formatTime(field.source.confirmedAt, true)}`));
      provenance.append(node('p', '', 'The reported source has not been independently verified.'));
      value.append(provenance);
    }
    row.append(node('dt', '', field.label), value); list.append(row);
  }
  const missing = node('div', 'draft-missing');
  if (draft.missing?.length) {
    missing.append(node('strong', '', `${draft.missing.length} ${draft.missing.length === 1 ? 'field needs' : 'fields need'} information or sharing`));
    const values = node('ul');
    for (const field of draft.missing) values.append(node('li', '', field.label));
    missing.append(values);
  } else missing.append(node('p', '', 'All fields in this demonstration draft are filled.'));
  const notice = node('p', 'draft-snapshot-notice'); notice.dataset.draftNotice = 'true';
  card.draft.replaceChildren(heading, node('h3', '', draft.label), node('p', 'draft-recipient', `Intended recipient: ${draft.recipient}`), list, missing, notice,
    node('p', 'draft-boundary', 'Fictional demonstration form. No website was filled, no document uploaded, and no application submitted.'));
  updateDraftNotice(sceneId);
}
function updateDraftNotice(sceneId) {
  const card = scenarioCards.get(sceneId); const draft = scenarioDrafts.get(sceneId);
  if (!card || !draft) return;
  const notice = card.draft.querySelector('[data-draft-notice]');
  if (!notice) return;
  const scene = state?.scenarios?.find((entry) => entry.id === sceneId);
  const changed = (draft.fields ?? []).some((field) => {
    if (field.origin === 'task') return card.taskInputs.get(field.inputKey)?.value.trim() !== String(field.value ?? '');
    const latest = scene?.fields.find((entry) => entry.inputKey === field.inputKey);
    return !latest || latest.state !== 'shared' || latest.value !== field.value || (latest.source?.claimId && field.claimId && latest.source.claimId !== field.claimId);
  }) || (draft.missing ?? []).some((field) => scene?.fields.some((entry) => entry.inputKey === field.inputKey && entry.state === 'shared'));
  notice.textContent = changed ? 'Facts, access, or task answers have changed. This saved preview stays unchanged; generate again to check the latest state.'
    : 'Snapshot from the time you generated it. Later profile changes do not rewrite this preview.';
  notice.classList.toggle('changed', changed);
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
    empty.append(node('strong', '', 'No changes waiting for review.'), node('p', '', 'Collect missing information in either application above, or try an existing-fact correction below.'));
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
    const newFact = review.proposalKind === 'new-fact';
    const card = node('article', 'review');
    card.dataset.reviewId = review.reviewItemId;
    const top = node('div', 'review-top');
    top.append(node('h3', '', newFact ? `New ${review.label.toLowerCase()}` : `${review.label} update`), node('span', 'review-origin', `Assistant ${review.assistantId.toUpperCase()} proposal`));
    const comparison = node('div', 'comparison');
    for (const [index, label, value] of [[0, newFact ? 'Identity profile' : 'Value when proposed', newFact ? 'No confirmed fact yet' : review.currentValue], [1, 'Suggested', review.suggestedValue]]) {
      if (index) comparison.append(node('span', 'comparison-arrow', '→'));
      const part = node('div');
      part.append(node('span', 'comparison-label', label), node('p', `comparison-value${index ? ' proposed' : ''}`, display(value)));
      comparison.append(part);
    }
    const rationale = node('div', 'rationale');
    rationale.append(node('span', 'comparison-label', 'Assistant’s reason · not independently verified'), node('p', '', review.rationale));
    if (review.source) rationale.append(node('p', 'proposal-source', `${sourceLabel(review.source)}. Approving confirms your choice, not the authenticity of the source.`));
    const footer = node('div', 'review-footer');
    const actions = node('div', 'review-actions');
    const approveButton = actionButton(newFact ? 'Approve new fact' : 'Approve update', 'button', () => mutate('/api/approve', {
      assistantId: review.assistantId, reviewItemId: review.reviewItemId,
      expectedVersion: review.expectedVersion, expectedValue: review.suggestedValue, confirmed: true,
    }, newFact ? 'New fact added to your profile. Share it with each application before generating a draft.' : 'Update approved. Share the new version with an assistant when you are ready.', 'reviews-title'));
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
      ? 'This proposal no longer matches the current profile. Closing it leaves facts and sharing unchanged.'
      : newFact ? 'Approving adds this fact and its reported source. Sharing is a separate choice.' : 'Approving updates the fact. Sharing is a separate choice.'), actions);
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
  const hadAccessFocus = $('assistants').contains(document.activeElement);
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
  if (hadAccessFocus) $('access-title').focus({ preventScroll: true });
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
  renderScenarios(next.scenarios ?? []);
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
async function mutate(path, body, successMessage, focusId, onResult) {
  if (busy || !connected) return;
  busy = true;
  updateControls();
  let succeeded = false;
  try {
    // Let any older poll finish before mutation, then read the committed state.
    if (refreshPromise) await refreshPromise;
    const result = await request(path, { method: 'POST', body: JSON.stringify(body) });
    succeeded = true;
    if (onResult) onResult(result);
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
