#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSharedProfile } from './fixture.js';

const serverPath = fileURLToPath(new URL('../../adapters/mcp/server.js', import.meta.url));
// POSIX shell quoting is separate from JSON/TOML encoding. A path can contain
// spaces, quotes, dollar signs or backticks without becoming executable code.
const quote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;

export function formatClientCommands(manifest) {
  const aArgs = [serverPath, '--config', manifest.assistants.a.configPath];
  const bArgs = [serverPath, '--config', manifest.assistants.b.configPath];
  return {
    a: `codex --sandbox read-only -c ${quote(`mcp_servers.mio_trial_a.command=${JSON.stringify(process.execPath)}`)} -c ${quote(`mcp_servers.mio_trial_a.args=${JSON.stringify(aArgs)}`)} -c ${quote('mcp_servers.mio_trial_a.startup_timeout_sec=30')}`,
    b: `claude --strict-mcp-config --mcp-config ${quote(JSON.stringify({ mcpServers: { mio_trial_b: { command: process.execPath, args: bArgs } } }))}`,
  };
}

export function readClientCommands(directory) {
  const demo = openSharedProfile(directory);
  try { return formatClientCommands(demo.manifest); }
  finally { demo.close(); }
}

function main(args) {
  if (args.length !== 1 || args[0] === '--help') {
    console.log('Usage: npm run demo:shared:commands -- /absolute/existing-demo-directory\nPrints session-only Codex A and Claude Code B commands for macOS/Linux POSIX shells.\nDoes not start clients, renew grants or save MCP registrations.');
    if (args[0] !== '--help') process.exitCode = 2;
    return;
  }
  const commands = readClientCommands(args[0]);
  console.log(`Use your existing client login; real model sessions may consume usage.\nKeep these local paths out of public feedback.\n\nAssistant A:\n${commands.a}\n\nAssistant B:\n${commands.b}\n\nThese commands do not renew expired/revoked grants or prove client connectivity.`);
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
