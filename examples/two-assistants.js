import assert from 'node:assert/strict';
import { createFictionalDemo, FIELDS } from './fictional-host.js';
import { DemoAccessDenied } from './scoped-reader.js';

const demo = createFictionalDemo();
try {
  console.log('Mio: one fictional person, two MOCK assistants. No AI API or network calls.');
  console.log('User decisions below are explicitly scripted simulations, not real authentication.\n');
  console.log('1. Mock document assistant receives:', demo.assistants.document.read());
  console.log(demo.assistants.document.draft());
  console.log('2. Mock contact assistant receives:', demo.assistants.contact.read());

  const proposal = demo.assistants.contact.proposeEmail();
  console.log('3. Mock contact assistant proposes a new email. Review status:', proposal.status);
  const before = demo.assistants.contact.read().fields[FIELDS.email];
  assert.equal(before, 'alex.old@example.invalid');
  console.log('Before user confirmation, the canonical email is still:', before);

  console.log('4. SIMULATED USER: confirm alex.new@example.invalid as the new email.');
  const updated = demo.approveEmailChange({ actorId: demo.ownerActorId,
    reviewItemId: proposal.reviewItemId, confirmedValue: 'alex.new@example.invalid', confirmed: true });
  assert.throws(() => demo.assistants.contact.read(), DemoAccessDenied);
  console.log('The old grant cannot disclose the new claim.');

  console.log('5. SIMULATED USER: separately authorize the contact assistant to read the new claim.');
  demo.authorizeNewEmail({ actorId: demo.ownerActorId, claimId: updated.id, confirmed: true });
  console.log('Mock contact assistant now receives:', demo.assistants.contact.read());
  console.log('Mock document assistant still receives:', demo.assistants.document.read());

  demo.repository.revokeGrant(demo.grants.contact.id);
  assert.throws(() => demo.assistants.contact.read(), DemoAccessDenied);
  console.log('6. Revoked the contact grant: subsequent reads are denied.');
  const auditTypes = [...new Set(demo.repository.listAuditEventsForPerson(demo.person.id).map((event) => event.eventType))];
  console.log('Host-only audit event types:', auditTypes.join(', '));
  console.log('\nDemo complete. The in-memory database is discarded. See examples/README.md for limits.');
} finally {
  demo.close();
}
