import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { openCoreDatabase, closeCoreDatabase } from '../src/db.js';
import { createCoreRepository } from '../src/repository.js';
import { buildGemmaCoreContext } from '../src/gemma-context.js';
import { buildPendingReviewQueue } from '../src/review-queue.js';
import { validateGemmaCoreContextContract, validateReviewQueueContract } from '../src/contracts.js';

const schemaDirectory = new URL('../../contracts/', import.meta.url);
function compile(name) {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(new URL(name, schemaDirectory), 'utf8')));
}

test('every distributed JSON Schema compiles with the draft 2020-12 validator', () => {
  for (const name of fs.readdirSync(schemaDirectory).filter(name => name.endsWith('.schema.json'))) {
    assert.equal(typeof compile(name), 'function', name);
  }
});

test('full context and review queue exports validate with populated wiki and related memory', () => {
  const db = openCoreDatabase();
  const repository = createCoreRepository(db);
  repository.registerDefaultClaimTypes();
  try {
    const person = repository.createPerson({ displayName: 'Fictional Schema Example' });
    repository.createClaim({ personId: person.id, claimTypeKey: 'person.contact.email',
      value: 'old@example.invalid', status: 'confirmed' });
    repository.createWikiEntry({ personId: person.id, title: 'Fictional contact note',
      category: 'contact', fieldKey: 'email', summaryText: 'Confirm before updating.',
      status: 'candidate', trustLevel: 'user_asserted' });
    repository.createMemoryItem({ personId: person.id, kind: 'review_rationale', fieldKey: 'email',
      title: 'Fictional evidence note', snippetText: 'The owner has not approved a new address.' });
    const bundle = repository.createReviewBundle({ personId: person.id,
      sourceSystem: 'fictional-adapter', requestedFields: ['email'] });
    repository.createReviewItem({ personId: person.id, bundleId: bundle.id,
      itemType: 'proposal', fieldKey: 'email', target: 'identity_claim',
      suggestedValue: 'new@example.invalid', currentValue: 'old@example.invalid' });

    const context = buildGemmaCoreContext(repository, person.id);
    const queue = buildPendingReviewQueue(repository, person.id);
    assert.equal(context.memory.length, 1);
    assert.equal(context.wikiEntries.length, 1);
    assert.equal(context.proposals[0].relatedMemory.length, 1);
    assert.equal(context.pendingReview[0].relatedMemory.length, 1);
    assert.equal(queue.bundles[0].items[0].relatedMemory.length, 1);
    for (const [name, payload, runtime] of [
      ['gemma-core-context.schema.json', context, validateGemmaCoreContextContract],
      ['review-queue.schema.json', queue, validateReviewQueueContract],
    ]) {
      const validate = compile(name);
      assert.equal(validate(payload), true, JSON.stringify(validate.errors));
      assert.equal(runtime(payload).ok, true);
      const extraField = structuredClone(payload);
      extraField.unexpectedPrivateData = 'must not be silently accepted';
      assert.equal(validate(extraField), false);
      assert.equal(runtime(extraField).ok, false);
    }
    const invalidMemory = structuredClone(context);
    invalidMemory.memory[0].title = 123;
    assert.equal(compile('gemma-core-context.schema.json')(invalidMemory), false);
    assert.equal(validateGemmaCoreContextContract(invalidMemory).ok, false);
  } finally {
    closeCoreDatabase(db);
  }
});
