# One person, two mock assistants

From the repository root, run `npm run demo` with Node.js 24 or newer. No packages,
API keys, accounts, network requests, or real personal information are needed.
The demo uses an in-memory SQLite database and discards it on exit.

The fictional Alex Rowan has one set of confirmed facts. A mock document assistant
receives only first and last name. A mock contact assistant receives only first
name and email. Both refer to the same first-name claim. Neither receives source
documents, private notes, full identity context, or the review queue.

The contact assistant proposes a fictional email change. The old value remains
canonical while the proposal is pending. The example then **simulates explicit
user confirmation** and creates a confirmed claim, a linked review decision, and
an audit event in one transaction. A separate scripted sharing confirmation
issues a new grant attached to that exact claim. The previous grant does not gain
access to the new value. Finally, revocation prevents subsequent contact reads.
Each read checks the current clock. Reauthorization revokes the old grant and
creates the new grant, claim attachments, and audit event in one transaction;
the assistant's active grant handle changes only after that transaction commits.

These are local deterministic stand-ins for assistants, **not two connected AI
services**. The scripted confirmations do not claim that a real user authenticated
or clicked an approval button.

## What this example adds

`scoped-reader.js` is a teaching adapter, not a core production endpoint. It checks
the person/requester binding, active grant status, revocation, grant start and
expiration, read action, allowed fields, attached claim IDs, `read` access mode,
confirmed status, and claim expiration. It returns only requested field values;
it rejects unauthorized requests and never falls back to a full core context.
An update needs a newly attached claim. The check is deliberately stricter than
the general repository, which is a persistence API without access enforcement.

`fictional-host.js` uses existing repository and importer APIs. The review importer
creates proposals; accepting a review through other current interfaces does not
automatically create a canonical claim. This example implements that explicit
promotion only inside its simulated user action. Historical claims remain stored;
the reader selects the latest confirmed value. This is not a new portable policy
or authentication protocol.

## Boundaries

Only the trusted local host may hold repository access and choose person,
requester, and grant identifiers. Passing user-supplied IDs to this reader would
not authenticate anyone. Assistants receive the narrow capability objects, not
the database or host handles exposed for the demo and tests.

The example does not provide remote authentication, a consent UI, encrypted
storage, a hostile-code sandbox, a tamper-evident audit log, or production
concurrency guarantees. It checks revocation on future reads; it cannot retract
values already disclosed. The tests validate this adapter's behavior, not the
security of every existing core export or of a deployed multi-agent system.

Run `node --test mio-core/tests/personal-data-demo.test.js` for the focused tests.
