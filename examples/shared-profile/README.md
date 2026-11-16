# Shared profile, separate permissions

This example gives two assistants separate grants to **one persistent fictional
profile**. A local operator page separates approving an update from sharing its
new version. It uses the same MCP adapter that real clients connect to.

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

For a local walkthrough, use the simulated proposal control on the page; no
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
existing shared demo. To initialize without starting the page:

```sh
node examples/shared-profile/init.js /absolute/new-mio-shared-demo
```

The initializer refuses to overwrite an existing directory. A demo contains
`mio.sqlite`, `manifest.json`, `assistant-a.json`, and `assistant-b.json`. Both
configurations point to the same database and person, with distinct requester
and grant IDs. Initial grants last **24 hours**; restarting, approving, or
sharing does not extend them. Use a different new directory to start over.

## Walk through the behavior

| Step | Assistant A | Assistant B |
| --- | --- | --- |
| Initial read | First name and email are shared. | First name and home address are shared. |
| A proposes a new email | The old confirmed email remains readable. | Its view is unchanged. |
| Operator rejects the proposal with a reason | The old confirmed email remains readable; the proposal is recorded as rejected. | Its view is unchanged. |
| Operator approves | The new email is confirmed but unavailable to A until shared. The old version is not returned as a fallback. | Its view is unchanged. |
| Operator closes another, now outdated proposal | The confirmed value and sharing remain unchanged; the old proposal is recorded as superseded. | Its view is unchanged. |
| Operator shares the latest email with A | The new email becomes readable. | Email remains outside its grant. |
| Operator revokes A | New tool reads fail because the grant is revoked. | Its reads continue to work. |

The page can simulate A's proposal for an entirely local walkthrough. Its
assistant panels are scoped views of the database, not evidence that a real AI
client has connected. The operator can see the broader profile and review queue.
For the cross-client trial, connect A and B using their separate configuration
files and follow the [trial guide](../../docs/SHARED_PROFILE_TRIAL.md).

Rejection and approval are alternative decisions. To test outdated closure,
create two proposals based on the same old value, approve one, then close the
other. The page shows recent handled decisions and rejection reasons; closing
or rejecting a proposal does not erase its record or change facts or grants.
The [separate review branches](../../docs/SHARED_PROFILE_TRIAL.md#check-rejection-and-outdated-proposals)
give the exact steps without mixing them into the main sharing walkthrough.

## Checks

```sh
node --test tests/shared-profile.test.js
npm run check
```

The focused regression test uses official-SDK stdio clients against the shared
database. It exercises permission separation, pending updates, approval,
sharing, revocation, and persistence. These checks need no model account or API
calls. They do not measure how Codex or Claude interprets a task; record an actual
client session separately using the [trial protocol](../../docs/SHARED_PROFILE_TRIAL.md).

## Boundaries

- Use the generated fictional profile only. This example is not an importer for
  real personal information.
- The browser page is a local operator interface. The token prevents unrelated
  browser requests from accessing it; it is not human authentication or an OS
  sandbox. A process with the same account's file access can bypass MCP or invoke
  operator commands.
- SQLite and exports remain plaintext. Proposal rationale is supplied by an
  assistant and is not verified evidence.
- Revocation stops future reads through the adapter; it cannot erase values
  already present in a client's conversation.
- The page collects no remote analytics and sends no invitations. Trials and
  feedback are recorded manually.

Stop the local page with Ctrl+C and close the client sessions when finished.
Your demo directory remains available for inspection or a later resume. See
[SECURITY.md](../../SECURITY.md) for the underlying trust boundary.
