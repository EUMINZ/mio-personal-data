# Shared-profile trial

## Question and success criteria

Can one person collect a missing identity fact during a travel application,
review its source, and reuse the same confirmed fact in employee onboarding
without copying pending, unshared, or task-specific answers into the profile?

The trial uses two **fictional demonstration templates**, not forms from a
particular government or employer. It prepares drafts locally. It does not
submit applications, upload documents, authenticate real-world identity, or
verify a source document's authenticity.

The primary workflow must show:

1. Travel application A and Employee onboarding B use one persistent profile
   with distinct requester/grant bindings.
2. A can propose a missing employer under a collection grant, with a source and
   rationale. The proposal does not create a confirmed identity value.
3. Operator approval creates the fact and its source record atomically, while
   both assistants still lack access to that newly confirmed version.
4. Sharing the fact with A makes it available in the travel draft. B still
   cannot use it until the operator separately shares it with B.
5. The onboarding draft then reuses the **same claim ID and source**. It does not
   create a second employer fact or ask the user to re-enter it.
6. Travel and onboarding task answers stay outside the identity profile.
7. Rejected proposals never become confirmed facts; a competing proposal can
   be closed as outdated after another proposal establishes that fact.
8. Existing email correction, independent revocation, and restart behavior
   continue to work. Restarting does not extend a grant or expand its scope.

**Recruitment remains on hold. No invitations have been sent and no external
trial results are claimed.** Use [validation](VALIDATION.md) for revision-specific
checks. The [November 16, 2026 maintainer record](trials/shared-profile-live-validation-2026-11-16.json)
covers the earlier email approval/sharing/revocation workflow; it is not evidence
for new-fact collection or cross-task drafts. Claude Code B did not authenticate
in that record and made no tool calls; its permission checks used the official
SDK instead. A complete two-model trial and independent external trial remain
unverified.

## Prepare a local demo

Use **Node.js 24**, npm, and Git. These commands target macOS/Linux POSIX
shells; equivalent Windows launch commands have not been validated. Start from
a directory where a new `mio-personal-data-trial` checkout can be created:

```sh
git clone --branch codex/shared-profile-trial --single-branch https://github.com/EUMINZ/mio-personal-data.git mio-personal-data-trial
cd mio-personal-data-trial
git rev-parse HEAD
node --version
npm ci --ignore-scripts
mio_trial_dir="$(mktemp -d)/profile"
npm run demo:shared -- "$mio_trial_dir"
```

This downloads the **unreleased trial branch**. Record the exact commit printed
by `git rev-parse HEAD` because the branch can change. The older `v0.3.0-alpha`
tag and its package do not contain the shared-profile example. If you already
have this trial checkout, start at `git rev-parse HEAD`; do not switch to the
old release to run this guide. A maintainer can reproduce the recorded source
with `git checkout --detach FULL_RECORDED_COMMIT` in a separate checkout.

`mktemp` creates a fresh parent outside the repository, and the launcher creates
its `profile` child. Keep this terminal running. Open the printed loopback URL
and retain it locally. Its token authorizes the operator page; never include it
in screenshots, chat prompts, issue reports, or feedback. The generated data is
fictional. The page does not send telemetry or make model calls.

The launcher prints the actual paths for these two configurations and complete
client commands that use them:

| Binding | File in the printed profile directory | Permitted fields |
| --- | --- | --- |
| A · Travel application | `assistant-a.json` | Starts with first name/email; may collect employer/job title, correct readable facts, and prepare the travel draft |
| B · Employee onboarding | `assistant-b.json` | Starts with first name/home address; may collect employer/job title and prepare the onboarding draft; no correction permission |

Both configurations refer to the same database. **Do not use `--demo` or give
both clients the same configuration**: those would test independent in-memory
profiles or a shared permission, rather than the intended scenario. Grants
expire 24 hours after initialization. Resuming a directory does not renew them;
use a new directory for a fresh trial after expiry or revocation. Also use a
**fresh directory for this identity-layer walkthrough**: a directory created by
an earlier revision does not gain new collection scopes or scenario fields by
being reopened.

To check the code without making model calls, run `npm run check` from another
terminal in the checkout. Record its result separately from any real-client
trial result.

## Choose a trial mode

### Local walkthrough

Open the review page and use its collection, review, sharing, and draft controls.
They exercise local host operations without a client login or model account.
Label it `simulation` in feedback: the panels and generated drafts do not prove
that a real AI client connected or received those values. Rejection, outdated
closure, email updates, and revocation remain available for separate checks.

### Real clients without saved registrations

Copy the **Codex A** command printed by the launcher into a new terminal. Copy
the **Claude Code B** command into another terminal. They contain the checkout
and profile paths for this run, so no path substitutions are needed. The
commands use session options and do not change user-level MCP registrations.
The commands do not log you in: existing client login and model access are
prerequisites, and real model sessions may consume account usage.

To print the commands again, run this from the checkout with the profile
directory printed by the launcher:

```sh
npm run demo:shared:commands -- /absolute/existing-demo-directory
```

This validates the existing demo and prints commands; it does not initialize
or reset a profile, renew a grant, or start either AI client.

In Codex, inspect `/mcp` and confirm `mio_trial_a` is connected. The session
adds that server; other configured servers may still be present. Use only
`mio_trial_a` for this trial. Its read-only shell setting is not proof that the
MCP process or database is isolated. See the
[Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

In Claude Code, inspect `/mcp` and confirm `mio_trial_b` is connected. Its strict
MCP option limits this session to the supplied MCP definition; it does not
disable built-in file/shell tools. See the
[Claude Code MCP guide](https://code.claude.com/docs/en/mcp). Other clients can
use the same stdio entrypoint with B's configuration path, subject to their own
configuration format. Connection status alone does not establish tool use.

The session options were originally checked against CLI help for Codex
`0.169.0-alpha.11.1` and Claude Code `2.0.76`. Check your installed client's
`--help` if its options differ and record the versions actually used. That
syntax check does not constitute a completed two-client model trial.

## Primary scenario: collect once, reuse across tasks

Use a fresh demo profile. Keep the operator page open and start in **Travel
application**. Use only fictional information. Employer and job title begin
missing. Fill the required travel-only fields first: destination `Example City`
and purpose `Fictional conference`. For onboarding, use start date `2027-01-15`
and department `Example Operations`. These are example task answers, not
identity facts.
The page's collection control and a connected client's `mio_propose_fact` call
are alternative ways to create the same kind of pending review; do not perform
both for one step.

| Step | Action | Expected observation |
| --- | --- | --- |
| 1 | Generate the travel draft before collecting an employer. | The employer is unavailable; the draft identifies missing identity fields instead of guessing. |
| 2 | Collect employer `Example Research Ltd`, with rationale `Reuse the fictional employer in travel and onboarding` and a user-stated source reference `Fictional travel intake, employer question`. | A new-fact proposal enters review. The profile and agent-readable fields remain unchanged. |
| 3 | Inspect the proposed value and source, then approve the new fact. | The identity profile contains a confirmed employer with its source. Neither A nor B can read the new version yet. |
| 4 | Share the latest employer with A only, then generate a new travel draft. | Its employer field uses the confirmed value and identifies the fact/source. No pending proposal is used. |
| 5 | Switch to Employee onboarding and generate its draft before sharing with B. | Employer remains unavailable to B, even though the operator and A can see it. |
| 6 | Share the latest employer with B, then generate a new onboarding draft. | Both drafts reference the same employer claim ID and source. No second employer fact is created. |
| 7 | Enter different task details for travel and onboarding and regenerate the drafts. | Task answers appear only in their draft. They do not create identity claims, evidence, or review proposals. |

Collect job title, for example `Research coordinator`, through the same
collection/review/sharing process if you want complete drafts. A partially filled draft is still a draft: inspect its missing
fields before treating it as complete. Generating another draft checks an active `prepare-form-draft` permission
and the scenario bound to that grant, then rechecks each identity field. Drafts
are stored locally in SQLite; the page shows the latest 10 while older drafts
remain in the database. An earlier draft is
a historical snapshot and is not silently rewritten when a fact changes or a
grant is revoked. Its recipient is a fictional template setting, not proof of
delivery to that organization.

The equivalent new-fact MCP input for step 2 is:

```json
{
  "field": "person.employment.employer",
  "value": "Example Research Ltd",
  "rationale": "Reuse the fictional employer in travel and onboarding",
  "source": {
    "kind": "user-stated",
    "reference": "Fictional travel intake, employer question"
  }
}
```

Call `mio_propose_fact` with this object. For a document-derived fictional
example, use `kind: "document-extracted"` and an optional `locator` such as
`Page 1, employer field`. This is a source description supplied by the requester;
it does not upload or independently verify a document. Approval means the local
operator accepted the personal fact, not that a government or employer verified it.

For real-client evidence, make fresh `mio_context` calls for
`person.employment.employer` at steps 1, 2, 3, 4, 5, and 6. Record those outputs
separately from the local draft results. Current MCP tools expose scoped identity
reads and proposals; the page's template-draft operation is not itself a tool
that submits forms to a website.

## Secondary scenario: correct, share, and revoke

Use another fresh profile for this email lifecycle. For a real-client trial,
have A submit the proposal;
do not also click the page's simulated proposal control. Duplicate proposals
would make the walkthrough harder to interpret.

Start both conversations with this instruction:

> This is a fictional Mio trial. Use only this session's Mio MCP tools. Do not
> read files, run shell commands, or use values remembered from earlier turns
> instead of making a fresh tool call. Do not approve, share, revoke, or bypass
> permissions yourself. For unavailable fields, say unavailable without guessing.

Then perform one row at a time. Ask for a new tool call at every reading step;
an answer repeated from conversation history is not fresh-read evidence.

| Step | Action | Expected observation |
| --- | --- | --- |
| 1 | Ask A to call `mio_context` for `person.name.first`, `person.contact.email`, and `person.contact.home_address`. | Name/email have values; home address is in `unavailable`. |
| 2 | Ask B to call `mio_context` for the same three fields. | Name/home address have values; email is in `unavailable`. |
| 3 | Ask A to propose `person.contact.email = alex.new@example.invalid`, with rationale `Fictional shared-profile trial`, then call `mio_context` for email again. | Proposal status is `pending`; email is still `alex.old@example.invalid`. |
| 4 | In the operator page, compare the old and suggested values and click **Approve update**. Ask A to read name/email again. | Name remains readable. Email is unavailable; neither old nor new email is returned. |
| 5 | Separately share the latest email with A in the operator page. Ask A and B to repeat their reads from steps 1–2. | A receives the new email. B still receives its name/address and cannot read email. |
| 6 | Revoke A in the operator page. Ask both assistants to make another read call. | A's call fails without field values. B's allowed reads continue. |
| 7 | Close and restart the client sessions with the same configuration paths. Repeat step 6. | Revocation and B's permissions persist. No setup action silently resets the grant. |

The operator's page displays broader information than either assistant receives.
Its scoped panels can help explain the rules, but record actual tool outputs
when evaluating real clients. Proposal rationale is unverified input, not proof
that the suggested value is correct. Do not insert real identity documents.

## Check rejection and outdated proposals

Use **a separate fresh demo directory** for these branches, before revoking A.
They deliberately create rejected or competing proposals and should not be
mixed into the single-proposal scenario above. Use either actual A tool calls
or the page's simulated proposal control, and record which evidence mode you
used.

### Reject a proposal

1. Propose `alex.rejected@example.invalid` as A's email update.
2. In its review card, open **Reject this proposal**, enter a reason such as
   `Incorrect fictional email`, and click **Confirm rejection**.
3. The item leaves pending review and appears in the handled-decision history
   as **Rejected**, including the reason. A fresh A read still returns
   `alex.old@example.invalid`; B still reads its name/address and no email.

A rejection is a review decision, not a deletion of the proposal or a change to
facts or sharing. A reason is required. To correct a rejected suggestion,
submit a new proposal rather than editing its historical decision.

### Close an outdated proposal

1. While the same old email is still current, submit two proposals from A:
   `alex.first@example.invalid` and `alex.second@example.invalid`.
2. Approve the proposal for `alex.first@example.invalid`. Do not share it yet.
3. The other proposal becomes outdated because it was based on the old claim.
   Its approval control is disabled. Choose **Close outdated proposal**.
4. It leaves pending review and appears in the handled-decision history as
   **Closed as outdated**. The confirmed email remains
   `alex.first@example.invalid`; A still cannot read that version until it is
   separately shared. B's access remains unchanged.

Closing an outdated proposal records a `superseded` decision. The server checks
that it is actually outdated when the action is submitted; an ordinary pending
proposal cannot be closed through that action. A changed or already handled
review requires refreshing the page, rather than reapplying an old decision.

For new-fact proposals, submit two different fictional employers while no
employer is confirmed, approve one, then close the other as outdated. Rejecting
a new-fact proposal leaves the employer missing. Approving the same review again
must fail instead of creating a duplicate claim.

The recent handled-decision list is an operator view, not an AI tool response.
It retains the outcome and reason without claiming that a model has read them.

## Evidence and measurements

Choose the evidence mode that describes the run:

- `simulation`: local page controls and views, with no connected model.
- `sdk`: automated stdio clients verifying the protocol and state transitions.
- `real-client`: actual model-client calls, with client versions and redacted
  tool observations retained.

Never report an SDK run as a Codex/Claude model session. The historical single
Codex smoke test in this repository is also separate from this shared-profile
trial. Current results belong in the appropriate validation record, not in the
instructions as an implied success.

Copy [the feedback template](trials/shared-profile-feedback.example.json) to a
private file outside the checkout. Start the onboarding timer before installing
dependencies. Record the time to the first correct read, blockers, maintainer
help, and whether the participant stopped. Measure:

- **Readable-field omissions:** a currently permitted field omitted despite a
  successful tool read or left unread by the client.
- **Stale-value use:** an old value used after the scenario makes it invalid for
  the requested current read, distinguishing tool output from a model answer.
- **Unauthorized tool returns:** any field value returned outside the current
  grant. A model repeating a previously disclosed value is a separate retained-
  context observation, not a new server disclosure.
- **Cross-task reuse:** the same confirmed employer claim ID and source appear
  in both authorized drafts; no task-only answers enter the identity profile.
- **Collection boundary:** pending or rejected facts never fill identity fields,
  and approval alone never grants either assistant access.
- **Operator effort:** approval/share/revoke clicks, retries, corrections, and
  elapsed time. Separate client permission prompts from Mio operator actions.
- **Adoption:** usefulness, a concrete intended use, and willingness to reuse.

Record denominators and failure cases. With three participants, results are
exploratory observations, not a general performance or security claim. No trial
feedback is uploaded automatically; participants must choose what to share.

## Recruit the first three participants

Prepare the trial package before contacting anyone. Start with existing
contacts who already develop with Codex or Claude Code, or have configured an
MCP server. Prefer people who can describe a recurring personal-data task; they
do not need prior knowledge of Mio. For a complete two-model run, the participant
needs working access to both clients. If only one is available, label the run
accordingly rather than counting an SDK substitute as the second model.

Make a private shortlist of three people, with their relevant tool experience
and a suitable contact channel. Ask existing contacts for an introduction if
the shortlist is too small. A community's designated feedback or showcase
channel can be a later option, following its rules. Do not advertise the trial
in unrelated third-party issues, and do not ask participants for a GitHub star.
Send invitations only after the maintainer chooses the recipients and channel.

Offer a **15–20 minute accompanied session** using fictional data. Send the
checkout revision, prerequisites, and this guide beforehand. Explain that model
sessions can consume the participant's existing account usage, and that they
can instead choose a local-only walkthrough. Do not ask them to share login
details or troubleshoot credentials on a recorded screen.

During the session:

1. Let the participant attempt setup from the guide. Observe where they stop;
   record help offered instead of quietly completing the installation for them.
2. Before they click, ask what they expect **Approve update** and **Share** to
   do. Observe whether they understand why the newly confirmed email is still
   unavailable until shared.
3. Ask what revocation should prevent, then have them make a fresh read. Check
   whether they distinguish denied future access from information already
   retained in a conversation.
4. After the walkthrough, ask which real task they would use this for, what they
   use today, and what would prevent adoption. Record a concrete example rather
   than treating general encouragement as demand.

If setup consumes the session, record that outcome and offer a separate follow-up;
do not compress it into a reported successful trial. Classify authentication or
account-access failures separately from Mio startup, connection, behavior, and
comprehension failures. For example, an invalid client API key before any MCP
call is an authentication blocker, not evidence that Mio returned the wrong
field. Keep the trial incomplete and retain that failure in the record.

## Suggested invitation text

> I am testing Mio, an open-source local personal-data component for AI clients.
> Since you already work with Codex, Claude Code, or MCP, would you join a
> 15–20 minute accompanied trial using fictional data? I would like to observe
> where setup gets stuck, whether approving and sharing a change are clear, and
> what you expect after revoking an assistant's access. It needs Node.js 24; real
> client use needs your own working model access and may consume account usage.
> A local-only walkthrough is also available. The demo sends no analytics, and
> you should not share credentials or personal information. Afterwards, I would
> like to understand whether you have a concrete use for it. No GitHub star or
> public endorsement is expected.

This is a draft for a maintainer to send to selected recipients. No invitation
or recruitment action is performed by the example.

## Stop or restart

Exit both clients and stop the operator server with Ctrl+C. The database remains
on disk. Resume it with `npm run demo:shared -- /absolute/existing-demo`, or use
a new directory to repeat the original scenario. An expired/revoked grant is
not repaired by restarting. Do not reuse the operator URL from a previous server
run; open the fresh URL printed by the current process.

For underlying limits, read [SECURITY.md](../SECURITY.md) and
[the integration guide](INTEGRATIONS.md). Local tokens and configuration bindings
are not human authentication; code running under the same OS account can bypass
the tool interface. Revocation does not erase already disclosed values.
