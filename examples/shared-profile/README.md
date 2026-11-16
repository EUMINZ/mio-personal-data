# Shared profile, separate permissions

This example gives two assistants separate grants to **one persistent fictional
profile**. A local operator page separates approving an update from sharing its
new version. It uses the same MCP adapter that real clients connect to.

## Start

Use Node.js 24 and run these commands from a checkout containing this example:

```sh
npm ci --ignore-scripts
npm run demo:shared -- /absolute/new-mio-shared-demo
```

Replace the absolute path with a new directory outside the checkout. Its parent
must already exist. Open the loopback URL printed by the command; keep the
terminal running. The URL contains a token for the local operator page. Do not
share that URL or paste it into an assistant chat.

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
| Operator approves | The new email is confirmed but unavailable to A until shared. The old version is not returned as a fallback. | Its view is unchanged. |
| Operator shares the latest email with A | The new email becomes readable. | Email remains outside its grant. |
| Operator revokes A | New tool reads fail because the grant is revoked. | Its reads continue to work. |

The page can simulate A's proposal for an entirely local walkthrough. Its
assistant panels are scoped views of the database, not evidence that a real AI
client has connected. The operator can see the broader profile and review queue.
For the cross-client trial, connect A and B using their separate configuration
files and follow the [trial guide](../../docs/SHARED_PROFILE_TRIAL.md).

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
