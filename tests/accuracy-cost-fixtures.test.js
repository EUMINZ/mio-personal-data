import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessDenied, createScopedHost } from '../adapters/mcp/host.js';
import { buildFixture, CASE_IDS, FIXTURE_NOW, FIXTURE_SEED } from '../experiments/accuracy-cost/fixtures.mjs';
import { parseArguments } from '../experiments/accuracy-cost/server.mjs';

for (const caseId of CASE_IDS) {
  for (const variant of [0, 1]) {
    test(`synthetic fixture ${caseId}:${variant} matches the independent per-field answer key`, () => {
      const fixture = buildFixture(caseId, variant);
      try {
        const host = createScopedHost(fixture.repository, fixture.binding, { clock: fixture.clock });
        assert.equal(fixture.clock(), FIXTURE_NOW);
        assert.equal(fixture.task.id, `${caseId}:${variant}`);
        assert.deepEqual(Object.keys(fixture.task.expected), fixture.task.requestedFields);
        assert.equal(new Set(fixture.task.requestedFields).size, fixture.task.requestedFields.length);
        for (const field of fixture.task.requestedFields) {
          assert.ok(fixture.task.prompt.includes(field));
          const expected = fixture.task.expected[field];
          if (expected === null) assert.throws(() => host.read([field]), AccessDenied, field);
          else assert.deepEqual(host.read([field]), { fields: { [field]: expected } });
        }
        assert.doesNotMatch(fixture.task.prompt, /mio_context|mio_read|mio_list_fields|compact|legacy/);
        assert.match(fixture.task.prompt, /Do not use files, shell commands, web access/);
      } finally { fixture.close(); }
    });
  }
}

test('fixtures use deterministic seeded records and do not depend on the chosen tool arm', () => {
  assert.equal(CASE_IDS.length, 10);
  assert.equal(new Set(CASE_IDS).size, 10);
  assert.equal(typeof FIXTURE_SEED, 'string');
  for (const caseId of CASE_IDS) {
    const first = buildFixture(caseId, 0);
    const repeated = buildFixture(caseId, 0);
    const other = buildFixture(caseId, 1);
    try {
      assert.deepEqual(first.task, repeated.task);
      assert.deepEqual(first.binding, repeated.binding);
      assert.notDeepEqual(first.binding, other.binding);
      for (const table of ['persons', 'requesters', 'claims', 'grants', 'grant_claims', 'review_bundles', 'review_items']) {
        assert.deepEqual(first.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
          repeated.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(), `${caseId}:${table}`);
      }
    } finally { first.close(); repeated.close(); other.close(); }
  }
});

test('fixture server arguments reject unknown cases, variants, arms, and duplicate options', () => {
  assert.deepEqual(parseArguments(['--case', 'simple-one', '--variant', '1', '--arm', 'compact']),
    { caseId: 'simple-one', variant: 1, arm: 'compact' });
  assert.deepEqual(parseArguments(['--arm', 'legacy', '--variant', '0', '--case', 'missing']),
    { caseId: 'missing', variant: 0, arm: 'legacy' });
  for (const args of [[], ['--case', 'simple-one', '--variant', '2', '--arm', 'compact'],
    ['--case', 'missing', '--variant', '0', '--arm', 'unknown'],
    ['--case', 'no-such-case', '--variant', '0', '--arm', 'legacy'],
    ['--case', 'simple-one', '--case', 'missing', '--arm', 'legacy']]) {
    assert.throws(() => parseArguments(args));
  }
  assert.throws(() => buildFixture('missing', '0'));
  assert.throws(() => buildFixture('missing', -1));
  assert.throws(() => buildFixture('no-such-case', 0));
});
