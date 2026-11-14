# Integration validation record

Recorded on 2026-11-14. This records observed integration behavior, not model
quality or production security certification. All tested data was fictional.
Personal filesystem paths below are replaced with shell variables.

## Environment

- macOS / arm64; Node.js v24.12.0.
- Claude Code 2.0.76.
- Codex CLI 0.160.1; the separate model smoke result is recorded in
  [codex-mcp-smoke.json](../experiments/results/codex-mcp-smoke.json).
- Runtime dependencies: `@modelcontextprotocol/server` 2.4.0 and `zod` 4.6.7.
- Official SDK client 2.4.0 used to validate stdio calls.

## Claude plugin validation and local install

The following commands were run with `MIO_REPO` set to the prepared checkout and
`MIO_TEST_CONFIG` set to a new directory under the system temporary directory.
The installed CLI's configuration-path handling was checked before using the
isolated `CLAUDE_CONFIG_DIR`. No existing user configuration was modified.

```sh
CLAUDE_CONFIG_DIR="$MIO_TEST_CONFIG" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  claude plugin validate "$MIO_REPO/.claude-plugin/plugin.json"
CLAUDE_CONFIG_DIR="$MIO_TEST_CONFIG" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  claude plugin validate "$MIO_REPO/.claude-plugin/marketplace.json"
CLAUDE_CONFIG_DIR="$MIO_TEST_CONFIG" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  claude plugin marketplace add "$MIO_REPO"
CLAUDE_CONFIG_DIR="$MIO_TEST_CONFIG" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  claude plugin install mio-personal-data@mio-plugins
CLAUDE_CONFIG_DIR="$MIO_TEST_CONFIG" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  CHOKIDAR_USEPOLLING=1 claude mcp list
```

Observed results:

- Both manifest checks exited 0 with `Validation passed` and no warnings.
- Marketplace registration and local plugin installation both succeeded.
- The plugin MCP server's health check returned `Connected`.
- This local install copied a checkout whose npm dependencies were already
  installed. It does not establish a clean GitHub marketplace installation on
  this old Claude Code version, nor an actual Claude model tool-use session.
- The first health-check attempt hit the local `EMFILE` file-watcher limit.
  Repeating with `CHOKIDAR_USEPOLLING=1` completed successfully. This variable is
  an environment-specific test workaround, not a required Mio configuration.

The MCP definition is inline in the plugin manifest. There is intentionally no
root `.mcp.json`: opening this repository as an ordinary Claude project must not
introduce a project server with an undefined `CLAUDE_PLUGIN_ROOT` or shadow a
user-level connection.

## Missing-dependency behavior

The plugin launcher was copied into an otherwise empty temporary directory and
started with Node.js. It exited 1, emitted no stdout, and printed explicit
`npm ci --ignore-scripts --prefix ...` instructions to stderr. It did not attempt
to install dependencies. No automatic installation hook is included.

## Package/bin smoke method

The package is packed with `npm pack --ignore-scripts` into a temporary directory
and installed by `npm exec --ignore-scripts --package=<local tarball>`. The first
install uses a dedicated temporary npm cache and downloads public dependencies.
An official MCP SDK client then starts the same npm launcher with `--offline`
and `mio-mcp --demo`, initializes stdio, lists tools, and reads one allowed field.

The bin entrypoints resolve symlinks before deciding whether to execute their
main function, so the test exercises npm's actual `.bin` launcher path. It is
stronger than starting `node adapters/mcp/server.js` directly. The published
GitHub tag download is a separate release check and is not implied by this local
tarball method.

The final local tarball check used package version `0.2.0-alpha`. These commands
describe the executed pack and binary-help steps with temporary paths replaced:

```sh
npm pack --ignore-scripts --json --pack-destination "$MIO_TEST_PACK_DIR" --cache "$MIO_TEST_CACHE"
npm exec --yes --ignore-scripts --cache "$MIO_TEST_CACHE" --package="$MIO_TEST_TARBALL" -- mio-admin --help
```

The official SDK client then launched this command with a piped stdio transport:

```sh
npm exec --yes --offline --ignore-scripts --cache "$MIO_TEST_CACHE" --package="$MIO_TEST_TARBALL" -- mio-mcp --demo
```

Observed results: admin help exposed `init-profile`; stdio initialization and
`tools/list` succeeded; the tools were `mio_list_fields`, `mio_read`, and
`mio_propose_update`; reading `person.name.first` returned `Alex`; reading
`passport.number` returned `isError: true`. The client closed the server cleanly.
The package does not bundle npm dependencies. Source revision pinning through a
GitHub package spec does not promise frozen transitive npm dependencies; the
checkout route with `npm ci` is the lockfile-based installation path.

## Published GitHub installation

After publication, npm downloaded `github:EUMINZ/mio-personal-data#v0.2.0-alpha`
into a new temporary cache. `mio-admin --help` exited 0. An official SDK client
then started `mio-mcp --demo` through the same npm package spec and verified all
three tools, the fictional first name and email, refusal of `passport.number`,
a `pending` email proposal, and the unchanged confirmed email.

The tag route passed but a cached startup still waited for GitHub version
resolution. A separate archive-URL installation passed online, while repeating
that URL with `npm --offline` failed with `ENOTCACHED`. We do not recommend
depending on either download/cache behavior during MCP startup.

The recommended package route was then tested with a fresh dedicated install
directory:

```sh
npm install --ignore-scripts --no-audit --no-fund --prefix "$MIO_TEST_INSTALL" \
  github:EUMINZ/mio-personal-data#b908859434f153f5eef0b1f8f709e8dc0a82c4a1
```

The generated lockfile resolved to that exact source commit. The SDK client
started `node "$MIO_TEST_INSTALL/node_modules/mio-personal-data/adapters/mcp/server.js" --demo`
directly and repeated the same successful tool assertions. The observed
183 ms covers one local functional check; it is not a performance benchmark.
See the [sanitized results](../experiments/results/github-package-smoke.json).
Neither check installed a GitHub-native Claude marketplace plugin or modified
the operator's normal Codex/Claude configuration.

## Scope of evidence

These checks establish packaging, local process startup, protocol connectivity,
and selected fictional tool results. The shared-database, field-grant,
revocation, proposal, and approval checks live in the automated adapter tests.
No claim is made here about latency savings, token savings, Claude answer
quality, remote hosting, OAuth, directory acceptance, or protection against an
assistant with unrestricted shell/database access under the same OS identity.
