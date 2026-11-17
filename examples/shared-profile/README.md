# One identity, two tasks

This example gives **Travel application A** and **Employee onboarding B**
separate grants to one persistent fictional identity profile. Collect missing
personal information, review its source, and share a confirmed fact separately
with each assistant. Two local form drafts then reuse that exact fact version.
The page uses the same collection/read boundaries as the MCP adapter.

These are fictional demonstration templates, not official government or employer
forms. The workflow prepares local drafts and does not submit applications.

## Start

Use Node.js 24, npm, and Git. From a macOS/Linux POSIX shell, create a new
checkout of the unreleased trial branch:

```sh
git clone --branch codex/shared-profile-trial --single-branch https://github.com/EUMINZ/mio-personal-data.git mio-personal-data-trial
cd mio-personal-data-trial
git rev-parse HEAD
npm ci --ignore-scripts
mio_trial_dir="$(mktemp -d)/profile"
npm run demo:shared -- "$mio_trial_dir"
```

Record the commit for feedback; the branch may change. The old `v0.3.0-alpha`
tag/package does not contain this example. `mktemp` creates a fresh parent
outside the checkout; the launcher creates its `profile` child. Open the
printed loopback URL and keep the terminal running. The URL contains a token
for the local operator page. Do not share it or paste it into an assistant chat.

For a local walkthrough, use the collection, review, sharing, and draft controls; no
model account or API key is required. For real clients, copy the launcher's
complete **Codex A** and **Claude Code B** session commands into separate
terminals. They use your actual paths and do not save user-level registrations.
Client login and model access are separate prerequisites; real model sessions
may consume account usage. Windows shell commands have not been validated.

To display the client commands again, use the existing profile directory
printed at startup:

```sh
npm run demo:shared:commands -- /absolute/existing-demo-directory
```

This prints commands without starting a client, changing registrations,
creating a new profile, or extending a grant.

The command initializes the directory when it is absent, or resumes a valid
existing shared demo. Use a **new directory** for the two-task workflow. Old
version-1 demos resume without new scopes or scenario privileges; they are not
silently upgraded. To initialize without starting the page:

```sh
node examples/shared-profile/init.js /absolute/new-mio-shared-demo
```

The initializer refuses to overwrite an existing directory. A demo contains
`mio.sqlite`, `manifest.json`, `assistant-a.json`, and `assistant-b.json`. Both
configurations point to the same database and person, with distinct requester
and grant IDs. Initial grants last **24 hours**; restarting, approving, or
sharing does not extend them. Use a different new directory to start over.

## Collect once, reuse across tasks

A starts with first name/email; B starts with first name/home address. Both may
propose missing employer and job title facts. Their read scopes permit these
fields, but no employer or job title is initially stored or shared. Each grant
permits draft preparation only for its own scenario. A can also propose
corrections to readable facts; B cannot.

| Step | Travel application A | Employee onboarding B |
| --- | --- | --- |
| Initial draft | Employer/job title are unavailable. | Employer/job title are unavailable. |
| Collect employer `Example Research Ltd` with a user-stated source | A pending proposal is recorded; it cannot fill the draft. | No confirmed employer is available. |
| Approve the new fact | The fact and source enter the identity profile; A still cannot read it. | Still unavailable. |
| Share the confirmed employer with A | A new travel draft uses that claim ID and source. | Still unavailable. |
| Share the same employer with B | Its previously generated draft stays unchanged. | A new onboarding draft reuses the same claim ID and source. |

Repeat for job title, for example `Research coordinator`, to fill that missing
identity field. Travel requires the task-only answers **destination** and
**purpose**; onboarding requires **start date** and **department**. These answers
are stored in their draft, not as identity claims. The fictional recipients are
Example Travel Desk and Example People Team; no information is sent to either.

Draft generation checks the bound scenario, the `prepare-form-draft` action,
and current field permissions. It never fills from pending proposals or guesses
missing identity values. Each draft is a stored snapshot with fact IDs and source
references; future fact changes do not rewrite it. The operator can inspect the
latest 10 drafts locally, including incomplete drafts. Older snapshots remain
in the database; the display limit does not delete them.

The page's permission panels and local draft results do not prove a model has
connected. For actual client evidence, use the two configuration files and make
fresh reads through each client. Follow the [trial guide](../../docs/SHARED_PROFILE_TRIAL.md)
for the precise local and real-client evidence steps.

## Corrections, rejection, and revocation

The earlier email workflow remains available. A proposes a correction, the
operator approves it, and A cannot read the replacement until that exact version
is explicitly shared. B remains unable to read email. Revoking A prevents new
A reads and draft preparation while B's grant remains unchanged.

Rejecting a proposal requires a reason and does not change confirmed facts or
grants. To test outdated closure, submit two different proposals for the same
missing employer, approve one, then close the other. The same lifecycle works
for two email corrections based on one old value. The page retains handled
decisions. See the [review branches](../../docs/SHARED_PROFILE_TRIAL.md#check-rejection-and-outdated-proposals).

## Checks

```sh
node --test tests/shared-profile.test.js
npm run check
```

The focused regression test uses official-SDK stdio clients against the shared
database. It exercises the original permission/update lifecycle. The full
check also covers new-fact collection and cross-task draft behavior; see
[validation](../../docs/VALIDATION.md) for revision-specific results. These checks need no model account or API
calls. They do not measure how Codex or Claude interprets a task; record an actual
client session separately using the [trial protocol](../../docs/SHARED_PROFILE_TRIAL.md).

## Boundaries

- Use the generated fictional profile only. This example is not an importer for
  real personal information.
- The browser page is a local operator interface. The token prevents unrelated
  browser requests from accessing it; it is not human authentication or an OS
  sandbox. A process with the same account's file access can bypass MCP or invoke
  operator commands.
- SQLite, source descriptions, and saved drafts remain plaintext. Proposal
  rationale and source descriptions are supplied by the requester. The operator
  confirms a value; source authenticity is not independently verified.
- Revocation stops future reads through the adapter; it cannot erase values
  already present in a client's conversation.
- The page collects no remote analytics and sends no invitations. Trials and
  feedback are recorded manually.

Stop the local page with Ctrl+C and close the client sessions when finished.
Your demo directory remains available for inspection or a later resume. See
[SECURITY.md](../../SECURITY.md) for the underlying trust boundary.
