#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod/v4';
import { approveReview, listReviews, shareClaim, revoke, rejectReview, closeStaleReview, isReviewStale } from '../../adapters/mcp/admin.js';
import { createScopedHost, AccessDenied, selectLatestConfirmedClaim } from '../../adapters/mcp/host.js';
import { initializeSharedProfile, openSharedProfile, SHARED_PROFILE_FIELDS as F } from './fixture.js';
import { formatClientCommands } from './client-commands.js';
import { scenarioSnapshot, listFormDrafts, prepareFormDraft, claimSource } from './scenarios.js';

const uiDirectory = fileURLToPath(new URL('./ui/', import.meta.url));
const LABELS = { [F.firstName]: 'First name', [F.email]: 'Email', [F.address]: 'Home address',
  [F.employer]: 'Employer', [F.jobTitle]: 'Job title' };
const assistantId = z.enum(['a', 'b']);
const confirmed = z.literal(true);
const id = z.string().min(1).max(200);
const ACTIONS = {
  '/api/propose': z.strictObject({ assistantId, field: id, value: z.string().min(1).max(2048), rationale: z.string().min(1).max(1000) }),
  '/api/collect': z.strictObject({ assistantId, field: id, value: z.string().trim().min(1).max(2048),
    rationale: z.string().trim().min(1).max(1000), source: z.strictObject({ kind: z.enum(['user-stated', 'document-extracted']),
      reference: z.string().trim().min(1).max(300), locator: z.string().trim().min(1).max(300).optional() }) }),
  '/api/draft': z.strictObject({ assistantId, scenarioId: z.enum(['travel', 'onboarding']),
    taskValues: z.record(z.string().max(100), z.string().max(300)) }),
  '/api/approve': z.strictObject({ assistantId, reviewItemId: id, expectedVersion: id, expectedValue: z.string().min(1).max(2048), confirmed }),
  '/api/reject': z.strictObject({ assistantId, reviewItemId: id, expectedVersion: id, reason: z.string().trim().min(1).max(1000), confirmed }),
  '/api/close-stale': z.strictObject({ assistantId, reviewItemId: id, expectedVersion: id, confirmed }),
  '/api/share': z.strictObject({ assistantId, field: id, claimId: id, confirmed }),
  '/api/revoke': z.strictObject({ assistantId, confirmed }),
};
const ASSETS = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
const AUDIT_LABELS = {
  'demo.shared-profile.initialized': 'Created the fictional shared profile',
  'mcp.update.proposed': 'Suggested a change for review',
  'mcp.fact.proposed': 'Collected a new identity fact for review',
  'demo.form.drafted': 'Prepared a local form draft; nothing was submitted',
  'mcp.operator.approved': 'Approved a new version; sharing stays separate',
  'mcp.operator.rejected': 'Rejected a proposal; facts and sharing stay unchanged',
  'mcp.operator.closed-stale': 'Closed an outdated proposal; facts and sharing stay unchanged',
  'mcp.operator.shared': 'Shared a confirmed version',
  'mcp.operator.revoked': 'Revoked future access',
  'mcp.context.read': 'Checked scoped context',
  'mcp.fields.read': 'Read authorized fields',
  'mcp.fields.listed': 'Discovered readable fields',
};
const validTime = (value, now) => value === null || (Number.isFinite(Date.parse(value)) && Date.parse(value) > now);

// A read-only operator view of grants and attachments, not a simulated MCP read.
// Polling the page must not create assistant audit events or mask real tool calls.
export function operatorSnapshot(demo) {
  const { repository, db } = demo.states.a;
  db.exec('BEGIN');
  try {
    const now = Date.now();
    const person = repository.getPerson(demo.manifest.personId);
    const current = Object.fromEntries(Object.keys(LABELS).map((field) => {
      try { return [field, selectLatestConfirmedClaim(repository, person.id, field, now)]; }
      catch (error) { if (error instanceof AccessDenied) return [field, null]; throw error; }
    }));
    const grants = repository.listGrantsForPerson(person.id);
    const assistants = Object.entries(demo.manifest.assistants).map(([id, definition]) => {
      const config = demo.states[id].config;
      const grant = grants.find((item) => item.id === config.grantId);
      const active = grant?.status === 'active' && grant.revokedAt === null && validTime(grant.expiresAt, now)
        && Number.isFinite(Date.parse(grant.grantedAt)) && Date.parse(grant.grantedAt) <= now
        && grant.requesterId === config.requesterId && grant.actions.includes('read-granted-fields');
      const attached = grant ? repository.listGrantClaims(grant.id) : [];
      return { id, label: definition.label, status: active ? 'active' : grant?.revokedAt || grant?.status === 'revoked' ? 'revoked' : 'expired',
        expiresAt: grant?.expiresAt ?? null,
        fields: definition.fields.map((field) => {
          const claim = current[field];
          const eligible = active && grant.scope.allowedFields.includes(field) && claim
            && Number.isFinite(Date.parse(claim.updatedAt)) && Date.parse(claim.updatedAt) <= now && validTime(claim.expiresAt, now);
          const shared = eligible && attached.some((link) => link.claimId === claim.id && link.claimTypeKey === field && link.accessMode === 'read');
          return { field, label: LABELS[field], state: shared ? 'shared' : eligible ? 'unshared' : 'unavailable',
            ...(shared ? { value: claim.value } : {}) };
        }) };
    });
    const reviews = Object.keys(demo.states).flatMap((id) => listReviews({ ...demo.states[id], repository })
      .map((review) => {
        const item = repository.getReviewItem(review.reviewItemId);
        const stale = isReviewStale({ ...demo.states[id], repository }, item, now);
        return { ...review, assistantId: id, label: LABELS[review.field] ?? review.field, stale };
      }));
    const decisions = repository.listReviewDecisionsForPerson(person.id).flatMap((decision) => {
      const item = repository.getReviewItem(decision.reviewItemId);
      if (!item || item.personId !== person.id || item.metadata?.adapter !== 'mio-mcp-v1'
        || !Object.hasOwn(LABELS, item.metadata.claimTypeKey) || !['applied', 'dismissed', 'superseded'].includes(item.status)) return [];
      const binding = Object.entries(demo.states).find(([, state]) => state.config.requesterId === item.metadata.requesterId
        && state.config.grantId === item.metadata.grantId);
      if (!binding) return [];
      return [{ reviewItemId: item.id, assistantId: binding[0], field: item.metadata.claimTypeKey,
        label: LABELS[item.metadata.claimTypeKey], status: item.status, decision: decision.decision,
        note: decision.note, resolvedAt: item.resolvedAt, suggestedValue: item.suggestedValue,
        proposalKind: item.metadata.proposalKind ?? 'update' }];
    }).slice(0, 20);
    const requesterLabels = Object.fromEntries(Object.entries(demo.states).map(([id, state]) => [state.config.requesterId, demo.manifest.assistants[id].label]));
    const audit = repository.listAuditEventsForPerson(person.id).slice(0, 30).map((event) => ({
      time: event.createdAt, actor: requesterLabels[event.actorId] ?? 'Local operator', type: event.eventType,
      summary: AUDIT_LABELS[event.eventType] ?? 'Recorded an operation',
    }));
    const result = { person: { name: person.displayName, fictional: true },
      claims: Object.entries(current).filter(([, claim]) => claim).map(([field, claim]) => ({
        field, label: LABELS[field], value: claim.value, claimId: claim.id, updatedAt: claim.updatedAt,
        source: claim.issuer === 'local-operator' ? 'Approved by the local operator' : 'Fictional profile fixture',
        provenance: claimSource(repository, claim),
      })), assistants, reviews, decisions, audit,
      scenarios: scenarioSnapshot(demo, now), drafts: listFormDrafts(demo) };
    db.exec('COMMIT');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function headers(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
}
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
function authorized(request, token) {
  const supplied = request.headers['x-mio-token'];
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied); const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Expected valid JSON'), { status: 400 }); }
}

export async function startReviewServer({ directory, port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const demo = openSharedProfile(directory);
  const token = randomBytes(32).toString('hex');
  let origin;
  const server = http.createServer(async (request, response) => {
    headers(response);
    const expectedHost = origin?.slice('http://'.length);
    if (request.headers.host !== expectedHost || (request.headers.origin && request.headers.origin !== origin)
      || request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Local origin required' });
    const route = request.url;
    if (Object.hasOwn(ASSETS, route) && request.method === 'GET') {
      const [file, type] = ASSETS[route];
      try {
        const asset = fs.readFileSync(path.join(uiDirectory, file));
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); response.end(asset);
      } catch { json(response, 500, { error: 'Review page assets are unavailable' }); }
      return;
    }
    if (!route?.startsWith('/api/')) return json(response, 404, { error: 'Not found' });
    if (!authorized(request, token)) return json(response, 401, { error: 'Open the full review URL printed in your terminal to start a session.' });
    try {
      if (route === '/api/state' && request.method === 'GET') return json(response, 200, operatorSnapshot(demo));
      if (!Object.hasOwn(ACTIONS, route)) return json(response, 404, { error: 'Not found' });
      if (request.method !== 'POST') return json(response, 405, { error: 'Use POST for operator actions' });
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') return json(response, 415, { error: 'JSON content type required' });
      const parsed = ACTIONS[route].safeParse(await body(request));
      if (!parsed.success) return json(response, 400, { error: 'Invalid action. Review the current value and explicitly confirm the operation.' });
      const { assistantId: id, ...input } = parsed.data;
      const state = demo.states[id];
      let result;
      if (route === '/api/propose') result = createScopedHost(state.repository, state.config).propose(input);
      else if (route === '/api/collect') result = createScopedHost(state.repository, state.config).proposeFact(input);
      else if (route === '/api/draft') result = prepareFormDraft(demo, { assistantId: id, ...input });
      else if (route === '/api/approve') result = approveReview(state, input);
      else if (route === '/api/reject') result = rejectReview(state, input);
      else if (route === '/api/close-stale') result = closeStaleReview(state, input);
      else if (route === '/api/share') result = shareClaim(state, input);
      else result = revoke(state, true);
      json(response, 200, result);
    } catch (error) {
      if (error.status) return json(response, error.status, { error: error.message });
      if (error instanceof AccessDenied) return json(response, 403, { error: 'The assistant cannot perform this action under its current grant.' });
      const conflict = /does not match|Confirmed data changed|Current claim and active allowed grant required|Configured grant not found|not (?:stale|outdated)/i.test(error.message);
      json(response, conflict ? 409 : 500, { error: conflict ? 'The review, confirmed value, or grant changed. Refresh and review it again.' : 'Operation failed. No success was recorded; refresh before retrying.' });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch (error) { demo.close(); throw error; }
  origin = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  return { server, origin, token, url: `${origin}/#token=${token}`, clientCommands: formatClientCommands(demo.manifest), close: async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    demo.close();
  } };
}

async function main(args) {
  if (args.length !== 1 || args[0] === '--help') {
    console.log('Usage: npm run demo:shared -- /absolute/demo-directory\nCreates a new fictional profile, or resumes an existing shared-profile demo.\nPrints a private loopback review URL. Grants expire after 24 hours; resume does not renew them.');
    if (args[0] !== '--help') process.exitCode = 2;
    return;
  }
  process.umask(0o077);
  const directory = args[0];
  if (!path.isAbsolute(directory)) throw new Error('Use an absolute demo directory');
  if (!fs.existsSync(directory)) initializeSharedProfile(directory);
  const running = await startReviewServer({ directory });
  console.log(`Mio identity trial — fictional travel and onboarding drafts\nReview: ${running.url}\nKeep this URL local; it authorizes operator actions for this session.\nAssistant A config: ${path.join(directory, 'assistant-a.json')}\nAssistant B config: ${path.join(directory, 'assistant-b.json')}\nStop with Ctrl+C. Data remains in ${directory}.`);
  console.log(`\nOptional real-client sessions (macOS/Linux POSIX shell):\nThese commands use your existing client login and may consume model usage.\nThey apply to this invocation and do not save MCP registrations.\n\nAssistant A — run in another terminal:\n${running.clientCommands.a}\n\nAssistant B — run in a third terminal:\n${running.clientCommands.b}\n\nThe page is an operator view, not proof that either client connected.\n`);
  const stop = () => { running.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1] && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
