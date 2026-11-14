import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, hostFactories, scenarios, measureResponse, runPayloadGrid,
  runArchitectureBenchmark } from '../benchmarks/architecture.mjs';

for (const [implementation, factory] of Object.entries(hostFactories)) {
  for (const scenario of scenarios) {
    test(`architecture benchmark: ${implementation} / ${scenario.id}`, () => {
      const host = factory(fixture, 24);
      try { scenario.run(host); } finally { host.close(); }
    });
  }
}

test('equal-policy JSON and Mio deliver byte-identical field payloads across fixture sizes and tasks', () => {
  const grid = runPayloadGrid();
  assert.equal(grid.length, 9);
  for (const row of grid) {
    assert.deepEqual(row.measurements.mio, row.measurements.scopedJson);
    assert.equal(row.measurements.mio.extraFields.length, 0);
    assert.equal(row.measurements.mio.missingFields.length, 0);
    assert.equal(row.measurements.fullProfileReference.extraFields.length,
      row.profileSize - row.requestedFields.length);
    assert.deepEqual(JSON.parse(row.measurements.fullProfileReference.serializedResponse).fields,
      Object.fromEntries(Object.entries(fixture.fields).slice(0, row.profileSize)));
  }
});

test('the byte metric uses actual UTF-8 encoding, not string length or model token estimates', () => {
  const payload = { fields: { label: '虚构姓名' } };
  const result = measureResponse(payload, { requestedFields: ['label'] });
  assert.equal(result.utf8Bytes, Buffer.byteLength(JSON.stringify(payload), 'utf8'));
  assert.ok(result.utf8Bytes > JSON.stringify(payload).length);
});

test('benchmark results are deterministic and explicitly preserve limitations', () => {
  const first = runArchitectureBenchmark();
  assert.deepEqual(runArchitectureBenchmark(), first);
  for (const name of Object.keys(hostFactories)) {
    assert.equal(first.lifecycleSummary[name].passed, scenarios.length);
    assert.equal(first.lifecycleSummary[name].expectedReadDenialsPassed, 8);
  }
  assert.equal(first.limits.realModelCalls, 0);
  assert.equal(first.limits.modelTokensMeasured, false);
  assert.equal(first.limits.answerAccuracyMeasured, false);
  assert.ok(first.limits.previouslyDisclosedContent.every((item) => item.previousResponseStillContainsValue));
});
