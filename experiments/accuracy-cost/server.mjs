#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createScopedHost } from '../../adapters/mcp/host.js';
import { createMioServer } from '../../adapters/mcp/server.js';
import { buildFixture, CASE_IDS } from './fixtures.mjs';

export function parseArguments(args) {
  if (args.length !== 6) throw new Error('Expected --case CASE_ID --variant 0|1 --arm legacy|compact');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--case', '--variant', '--arm'].includes(key) || Object.hasOwn(options, key)) {
      throw new Error('Unknown or duplicate fixture server option');
    }
    options[key] = args[i + 1];
  }
  if (!CASE_IDS.includes(options['--case']) || !['0', '1'].includes(options['--variant']) ||
      !['legacy', 'compact'].includes(options['--arm'])) throw new Error('Invalid fixture server option');
  return { caseId: options['--case'], variant: Number(options['--variant']), arm: options['--arm'] };
}

export function startFixtureServer(options) {
  const fixture = buildFixture(options.caseId, options.variant);
  const host = createScopedHost(fixture.repository, fixture.binding, { clock: fixture.clock });
  const handle = serveStdio(() => createMioServer(host, { toolset: options.arm }), {
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 64 * 1024 }),
    onerror: () => console.error('Accuracy-cost fixture MCP transport error'),
  });
  process.once('exit', fixture.close);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await handle.close(); fixture.close(); process.exit(0);
  });
  return { fixture, handle };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { startFixtureServer(parseArguments(process.argv.slice(2))); }
  catch { console.error('Fixture server startup failed. Use --case CASE_ID --variant 0|1 --arm legacy|compact.'); process.exitCode = 1; }
}
