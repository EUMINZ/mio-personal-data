import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createJsonHost, JsonAccessDenied } from './json-host.mjs';
import { createMioHost } from './mio-host.mjs';
import { DemoAccessDenied } from '../examples/scoped-reader.js';

export const fixture = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));
export const hostFactories = { scopedJson: createJsonHost, mio: createMioHost };
const email = 'person.contact.email';
const contact = fixture.tasks.find((entry) => entry.id === 'contact-card');
const document = fixture.tasks.find((entry) => entry.id === 'document-name');
const now = Date.parse(fixture.now);
const expectDenied = (operation) => assert.throws(operation, (error) =>
  error instanceof JsonAccessDenied || error instanceof DemoAccessDenied);
const expectFault = (operation) => assert.throws(operation, /Injected audit failure/);
const prepareUpdate = (host) => { host.propose(); host.confirm(); };

// All mutations represent explicitly scripted trusted-user decisions. These
// cases do not establish authentication, multi-process correctness or security
// against direct access to the underlying store.
export const scenarios = [
  {
    id: 'authorized-subset', expected: 'requested authorized fields only',
    run(host) { assert.deepEqual(host.read(contact), { fields: {
      'person.name.first': 'Alex', [email]: fixture.fields[email] } }); },
  },
  {
    id: 'field-outside-grant', expected: 'deny', readDenial: true,
    run(host) { expectDenied(() => host.read(contact, { requestedFields: ['person.name.last'] })); },
  },
  {
    id: 'requester-mismatch', expected: 'deny', readDenial: true,
    run(host) { expectDenied(() => host.read(contact, { requesterId: 'unbound-requester' })); },
  },
  {
    id: 'person-mismatch', expected: 'deny', readDenial: true,
    run(host) { expectDenied(() => host.read(contact, { personId: 'unbound-person' })); },
  },
  {
    id: 'unknown-grant', expected: 'deny', readDenial: true,
    run(host) { expectDenied(() => host.read(contact, { grantId: 'missing-grant' })); },
  },
  {
    id: 'grant-expiry-boundary', expected: 'deny at exact expiry', readDenial: true,
    run(host) { host.setNow(now + 3_600_000); expectDenied(() => host.read(contact)); },
  },
  {
    id: 'revoked-grant', expected: 'deny', readDenial: true,
    run(host) { host.revoke(); expectDenied(() => host.read(contact)); },
  },
  {
    id: 'tentative-update', expected: 'pending proposal leaves confirmed value unchanged',
    run(host) {
      assert.equal(host.propose(), 'pending');
      assert.equal(host.read(contact).fields[email], fixture.fields[email]);
    },
  },
  {
    id: 'confirmed-update-with-old-grant', expected: 'deny; do not return outdated or unshared value', readDenial: true,
    run(host) { prepareUpdate(host); expectDenied(() => host.read(contact)); },
  },
  {
    id: 'confirmed-update-with-fresh-consent', expected: 'return new confirmed value',
    run(host) { prepareUpdate(host); host.authorize(); assert.equal(host.read(contact).fields[email], fixture.newEmail); },
  },
  {
    id: 'approval-failure-atomicity', expected: 'failed audit rolls back claim, review and decision; old value usable',
    run(host) {
      host.propose(); const before = host.state();
      expectFault(() => host.confirm({ failAudit: true }));
      assert.deepEqual(host.state(), before);
      assert.equal(host.read(contact).fields[email], fixture.fields[email]);
    },
  },
  {
    id: 'sharing-failure-atomicity', expected: 'failed audit rolls back grant, links, audit and handle; new value still withheld', readDenial: true,
    run(host) {
      prepareUpdate(host); const before = host.state();
      expectFault(() => host.authorize({ failAudit: true }));
      assert.deepEqual(host.state(), before);
      expectDenied(() => host.read(contact));
    },
  },
  {
    id: 'other-assistant-after-update', expected: 'unaffected name grant remains usable',
    run(host) {
      prepareUpdate(host); host.authorize();
      assert.deepEqual(host.read(document), { fields: { 'person.name.first': 'Alex', 'person.name.last': 'Rowan' } });
    },
  },
];

export function measureResponse(response, task) {
  const serialized = JSON.stringify(response);
  const fields = Object.keys(response.fields);
  return {
    utf8Bytes: Buffer.byteLength(serialized, 'utf8'),
    deliveredFields: fields.length,
    extraFields: fields.filter((key) => !task.requestedFields.includes(key)),
    missingFields: task.requestedFields.filter((key) => !fields.includes(key)),
    serializedResponse: serialized,
  };
}

export function runPayloadGrid() {
  return fixture.profileSizes.flatMap((profileSize) => fixture.tasks.map((task) => {
    const fullProfile = { fields: Object.fromEntries(Object.entries(fixture.fields).slice(0, profileSize)) };
    const measurements = { fullProfileReference: measureResponse(fullProfile, task) };
    for (const [name, factory] of Object.entries(hostFactories)) {
      const host = factory(fixture, profileSize);
      try { measurements[name] = measureResponse(host.read(task), task); } finally { host.close(); }
    }
    return { profileSize, taskId: task.id, requestedFields: task.requestedFields, measurements };
  }));
}

export function runLifecycleCases() {
  return Object.entries(hostFactories).flatMap(([implementation, factory]) => scenarios.map((scenario) => {
    const host = factory(fixture, 24);
    try {
      scenario.run(host);
      return { implementation, scenarioId: scenario.id, expected: scenario.expected,
        expectsReadDenial: scenario.readDenial === true, passed: true };
    } finally { host.close(); }
  }));
}

export function checkPreviouslyDisclosedContent() {
  return Object.entries(hostFactories).map(([implementation, factory]) => {
    const host = factory(fixture, 24);
    try {
      const prior = host.read(contact);
      host.revoke();
      expectDenied(() => host.read(contact));
      assert.equal(prior.fields[email], fixture.fields[email]);
      return { implementation, laterReadDenied: true, previousResponseStillContainsValue: true };
    } finally { host.close(); }
  });
}

export function runArchitectureBenchmark() {
  const payloadGrid = runPayloadGrid();
  const lifecycleCases = runLifecycleCases();
  const totals = Object.fromEntries(['fullProfileReference', ...Object.keys(hostFactories)].map((name) => {
    const metrics = payloadGrid.map((row) => row.measurements[name]);
    return [name, {
      responses: metrics.length,
      utf8Bytes: metrics.reduce((sum, item) => sum + item.utf8Bytes, 0),
      extraFields: metrics.reduce((sum, item) => sum + item.extraFields.length, 0),
      missingFields: metrics.reduce((sum, item) => sum + item.missingFields.length, 0),
    }];
  }));
  return {
    schemaVersion: 'mio.architecture.benchmark.v1',
    fixtureSha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
    payloadGrid,
    totals,
    scopedPayloadReductionAgainstFullReferencePercent:
      Number((100 * (1 - totals.mio.utf8Bytes / totals.fullProfileReference.utf8Bytes)).toFixed(2)),
    lifecycleCases,
    lifecycleSummary: Object.fromEntries(Object.keys(hostFactories).map((name) => [name, {
      passed: lifecycleCases.filter((item) => item.implementation === name && item.passed).length,
      total: scenarios.length,
      expectedReadDenialsPassed: lifecycleCases.filter((item) => item.implementation === name &&
        item.expectsReadDenial && item.passed).length,
    }])),
    limits: {
      previouslyDisclosedContent: checkPreviouslyDisclosedContent(),
      fullProfileReferencePolicyChecks: 'Not applicable: intentionally unscoped delivery reference, not an equal-policy competitor.',
      scopeEffect: 'Payload reduction and fewer extra fields are effects of field selection. The scoped JSON baseline achieves the same result.',
      syntheticOnly: true,
      realModelCalls: 0,
      modelTokensMeasured: false,
      answerAccuracyMeasured: false,
      userTimeSavedMeasured: false,
      latencyMeasured: false,
      transportEnvelopesIncluded: false,
      persistentCrashRecoveryTested: false,
      concurrentProcessesTested: false,
      authenticationTested: false,
    },
  };
}
