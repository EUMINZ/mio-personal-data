# Use Mio from Codex, Claude Code, and other MCP clients

Mio provides a local **stdio MCP server**. GitHub distributes the code; the
process runs on your machine. The demo contains fictional data, makes no model
API calls, and needs no API key. The AI client you connect can still send tool
results to its model provider under that client's settings.

中文要点：先安装 Node.js 24，再从 GitHub 安装或克隆 Mio，注册为 MCP 工具。
资料留在本地数据库；助手取得的字段会进入助手的上下文。当前提供可运行的
虚构资料演示与显式配置接口，不会自动读取你的个人文件、聊天或账户。

## Requirements and verification status

- Node.js 24 or later, npm, and Git for a GitHub install.
- A client that can start a local stdio MCP process.
- Network access for the initial GitHub/npm installation. Mio's server itself
  does not download software or call a model when a tool is invoked.

| Route | What was checked for this release | Limit |
| --- | --- | --- |
| MCP server | Automated official-SDK stdio handshake and tool calls | Protocol checks do not measure model answer quality |
| Claude Code plugin | Manifest/marketplace validation and local marketplace install; `claude mcp list` reported Connected on Claude Code 2.0.76 | Local copy had dependencies installed; a clean GitHub marketplace install was not checked |
| Codex MCP session | Codex CLI 0.160.1 with `gpt-6-astra` / low: 5 real MCP calls verified permitted reads, a denied field, and an update remaining pending | One fictional smoke session, not a comparative model benchmark; [trace summary](../experiments/results/codex-mcp-smoke.json) |
| Other stdio MCP clients | Generic JSON configuration provided | Client-specific compatibility not checked |
| Browser-only/cloud assistants | No hosted endpoint provided | A GitHub URL cannot reach a database on your laptop by itself |

## Recommended: inspect a pinned checkout

These are macOS/Linux shell commands. On Windows, use equivalent absolute paths
and a Node.js 24 installation available to the client process.

```sh
git clone https://github.com/EUMINZ/mio-personal-data.git
cd mio-personal-data
git checkout --detach v0.2.0-alpha
npm ci --ignore-scripts
npm run check
MIO_REPO="$(pwd -P)"
```

For a stricter pin, replace the tag with a full commit SHA you have reviewed.
Do not update that checkout while a client is using it. A tag is a convenient
release name; a commit SHA identifies the precise source tree.

### Codex

```sh
codex mcp add mio -- node "$MIO_REPO/adapters/mcp/server.js" --demo
codex mcp list
```

Start a new Codex chat, inspect `/mcp`, then ask:

> Use Mio to list the fields available to this session, then read my first name
> and email. State that these are fictional demo values.

`codex mcp add` saves a user-level connection. If you prefer manual configuration,
merge [the TOML example](../integrations/codex.example.toml) into the appropriate
Codex configuration after replacing the absolute path. Do not overwrite an
existing configuration. OpenAI documents local stdio commands and shared
configuration for supported local clients in its [MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Claude Code

```sh
claude mcp add --scope user --transport stdio mio -- node "$MIO_REPO/adapters/mcp/server.js" --demo
claude mcp list
```

Start a new Claude Code session and inspect `/mcp`. Use the same prompt above.
This command registers the connection for your user account; use `--scope local`
instead if you want it only for the current project. See the official
[Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

### Other clients

Copy the `mcpServers.mio` object from
[stdio.example.json](../integrations/stdio.example.json), replace the absolute
path, and merge it into your client's MCP configuration. Some clients use a
different top-level key. The server implements stdio MCP; it does not currently
offer an HTTP/SSE endpoint, OAuth service, or cloud database synchronization.

## GitHub package route

After the `v0.2.0-alpha` tag is available, npm can fetch the pinned GitHub package
without a separate clone. The first launch downloads the package and its
dependencies into npm's cache; later launches normally reuse that cache.
`--ignore-scripts` disables npm lifecycle scripts. Node.js and npm still need to
be installed on the machine that runs the client.

```sh
codex mcp add mio -- npm exec --yes --ignore-scripts --package=github:EUMINZ/mio-personal-data#v0.2.0-alpha -- mio-mcp --demo
```

```sh
claude mcp add --scope user --transport stdio mio -- npm exec --yes --ignore-scripts --package=github:EUMINZ/mio-personal-data#v0.2.0-alpha -- mio-mcp --demo
```

Choose this **or** the checkout route for a server named `mio`. To use an exact
revision, replace `v0.2.0-alpha` after `#` with the full reviewed commit SHA.
This pins the source; npm may still resolve transitive dependencies at install
time. Use the checkout plus `npm ci` route for the project's full lockfile.
The commands register a launcher; successful registration alone does not prove
the server connected. Verify `/mcp` and a read call after the first download.
The local package/bin path is tested separately from downloading the published
GitHub tag; consult [validation](VALIDATION.md) for the completed checks.
The [integration test record](../integrations/VALIDATION.md) separates local
packaging, client health checks, and actual model-session evidence.

## Native Claude Code plugin

The repository also includes `.claude-plugin/plugin.json` with an inline MCP
definition, a small marketplace, and a plugin-specific launcher. You can try it from the prepared checkout:

```sh
claude plugin validate "$MIO_REPO/.claude-plugin/plugin.json"
claude --plugin-dir "$MIO_REPO"
```

Or add the GitHub marketplace and install it:

```sh
claude plugin marketplace add EUMINZ/mio-personal-data
claude plugin install mio-personal-data@mio-plugins
```

The marketplace route follows its configured source, so use the pinned checkout
route if you need exact revision control. It is a community repository, not an
Anthropic directory listing. Do not enable both this plugin and the standalone
`mio` MCP connection in the same session.

The plugin starts the fictional in-memory demo unless the launching environment
sets `MIO_CONFIG` to an absolute configuration-file path. The current Claude Code
documentation describes automatic dependency installation for copied plugins
with a supported lockfile. Older clients may leave dependencies missing. In that
case the Mio launcher exits with an explicit `npm ci --ignore-scripts --prefix
...` command to run once, then restart Claude Code. It never runs npm itself.
This means marketplace installation is not a promise of setup-free operation.
See [Claude's dependency-loading rules](https://code.claude.com/docs/en/plugins/loading#nodejs-package-dependencies).

The package layout follows the official [plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)
and [marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces).
For Codex, this release documents and supports the MCP registration route; it
does not claim a native marketplace installation or official directory listing.

## Persistent fictional data and operator review

`--demo` creates a new in-memory dataset for each server process. Two clients
started with `--demo` do **not** share state. Use one persistent database to
exercise shared updates:

```sh
node "$MIO_REPO/adapters/mcp/admin.js" init-demo /absolute/new-mio-demo
```

The directory must not exist; its parent must exist. This command creates a
fictional SQLite database plus `config.json`, and refuses to overwrite an
existing directory. The example grants expire after one hour. Approval and
sharing do not renew them. A new demo directory is the simplest way to start a
fresh session after expiry.

Replace `--demo` in the MCP registration with:

```text
--config /absolute/new-mio-demo/config.json
```

For the Claude plugin, launch it with:

```sh
MIO_CONFIG=/absolute/new-mio-demo/config.json claude --plugin-dir "$MIO_REPO"
```

The configuration binds one person, requester, and grant at process startup.
Connecting two clients using the same config grants both the same capability.
It does not create distinct client identities. Different trust scopes require
separate requester/grant bindings provisioned by a trusted host.

The MCP tools are intentionally small:

| Tool | Input | Effect |
| --- | --- | --- |
| `mio_list_fields` | `{}` | Lists currently readable field keys |
| `mio_read` | `{"fields":["person.name.first","person.contact.email"]}` | Returns only requested, currently granted fields |
| `mio_propose_update` | `{"field":"person.contact.email","value":"alex.new@example.invalid","rationale":"The user proposed a new contact address."}` | Creates a pending review; does not replace the confirmed value |

The demo permits first name and email. A stored passport number is deliberately
outside its grant. A request for `passport.number` must not return it.

For a pending update, the operator uses a separate terminal:

```sh
node "$MIO_REPO/adapters/mcp/admin.js" reviews /absolute/new-mio-demo/config.json
node "$MIO_REPO/adapters/mcp/admin.js" --help
```

Inspect the proposed value and its version, then use the documented `approve`
command with those exact values. Approval records a confirmed claim but does not
share it. A separate `share` command attaches that precise claim version to the
grant. `revoke` ends the configured grant. None of these administrator operations
is exposed as an MCP tool.

## Explicitly import a small profile

The optional `init-profile` command accepts a local JSON file supplied by the
operator. Start from [profile.example.json](../integrations/profile.example.json)
and save your edited copy **outside the Git checkout**. Choose only the claims
needed for your trial; `allowedFields` must be a subset of the supplied claims.
The example stores a family name but shares only first name and email. With
`allowProposals: false`, attempts to propose updates are denied.

```sh
node "$MIO_REPO/adapters/mcp/admin.js" init-profile /absolute/new-mio-profile /absolute/private-profile.json --confirm
```

This creates a new database and bound config; it does not merge with or overwrite
an existing one. Register the resulting absolute `config.json` using `--config`.
This initial release accepts the core's predefined identity/contact/employment
field keys and string values. It is not an automatic importer for arbitrary
preferences, memories, or relationships. The source JSON and database both
contain plaintext. Remove or secure the source copy according to your own data
handling needs; the command does not delete it for you.

## Trust boundary

Mio's filtering runs in the local server, not in a prompt. The current boundary
is a trusted process and its OS file permissions. Configuration IDs are not
authentication, SQLite is plaintext, and the audit log is mutable by someone
with database write access. An assistant with unrestricted shell or database
access under the same OS account can bypass the MCP boundary, including running
the administrator CLI. Separating admin commands does not prove a human clicked
approval. Use a genuinely separated host/account/service before treating this
as protection against such an assistant.

The adapter does not automatically import your profile, scrape files, install
background services, or merge itself into a client's memory. Start with the
fictional dataset. A real deployment still needs a trusted provisioning and
review interface, lifecycle management, and a threat model appropriate to its
clients. See [SECURITY.md](../SECURITY.md).

## Disconnect and update

Remove the connection you added:

```sh
codex mcp remove mio
claude mcp remove --scope user mio
```

For the native plugin:

```sh
claude plugin uninstall mio-personal-data@mio-plugins
claude plugin marketplace remove mio-plugins
```

These remove connections/packages, not a persistent data directory you created
outside the plugin cache. Stop client sessions before updating. Review the next
commit, install its locked dependencies, run the checks, then reconnect. Native
plugin updates also need a new plugin version and a client restart/reload.
