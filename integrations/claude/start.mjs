#!/usr/bin/env node
// Claude-specific wrapper: no install hooks or network calls. Missing dependencies
// are installed explicitly by the user (or by a capable plugin installer).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pluginRoot = fileURLToPath(new URL('../../', import.meta.url));
const serverPath = fileURLToPath(new URL('../../adapters/mcp/server.js', import.meta.url));

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Mio requires Node.js 24 or later on the Claude Code process PATH.');
  process.exit(1);
}

try {
  import.meta.resolve('@modelcontextprotocol/server');
  import.meta.resolve('zod/v4');
} catch {
  console.error('Mio dependencies are missing. Run this once in your terminal, then restart Claude Code:');
  console.error(`npm ci --ignore-scripts --prefix ${JSON.stringify(pluginRoot)}`);
  process.exit(1);
}

const args = process.env.MIO_CONFIG
  ? [serverPath, '--config', process.env.MIO_CONFIG]
  : [serverPath, '--demo'];
const child = spawn(process.execPath, args, { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', () => {
  console.error('Mio could not start the local MCP server. Check the installation and configuration.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
