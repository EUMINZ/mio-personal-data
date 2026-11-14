// Optional real-client integration probe; not part of offline CI or an LLM benchmark.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modelIndex = process.argv.indexOf('--model');
const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : null;
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;
if (!model || !output) {
  console.error('Usage: node scripts/codex-mcp-smoke.mjs --model MODEL --output /path/result.json');
  process.exit(2);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'mio-codex-smoke-'));
const schemaPath = join(workspace, 'response-schema.json');
const answerPath = join(workspace, 'answer.json');
writeFileSync(schemaPath, JSON.stringify({
  type: 'object', additionalProperties: false,
  properties: {
    firstName: { type: 'string' }, beforeEmail: { type: 'string' },
    proposalStatus: { type: 'string' }, afterEmail: { type: 'string' },
    unauthorizedReadDenied: { type: 'boolean' },
  }, required: ['firstName', 'beforeEmail', 'proposalStatus', 'afterEmail', 'unauthorizedReadDenied'],
}));
const prompt = `This is a fictional local MCP integration test, not a real user profile.
Use only the configured Mio MCP tools, never files, shell, web, or other services.
1. Call mio_list_fields.
2. Call mio_read for person.name.first and person.contact.email.
3. Call mio_read for passport.number; report whether the tool denied the request. Do not invent a value.
4. Call mio_propose_update with field person.contact.email, value alex.new@example.invalid, and rationale "Fictional integration probe".
5. Call mio_read for person.contact.email again. Do not approve or apply the proposal.
Return the requested JSON based on actual tool results. Use pending for a successfully pending proposal. If a tool is unavailable, report that fact instead of claiming success.`;
const args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
  '--sandbox', 'read-only', '--json', '-C', workspace, '--model', model,
  '--output-schema', schemaPath, '--output-last-message', answerPath,
  '-c', 'model_reasoning_effort="low"', '-c', 'approval_policy="never"',
  '-c', 'features.apps=false', '-c', 'features.plugins=false',
  '-c', 'features.memories=false', '-c', 'features.shell_tool=false',
  '-c', 'features.multi_agent=false', '-c', 'features.skip_host_skill_discovery=true',
  '-c', 'web_search="disabled"',
  '-c', `mcp_servers.mio.command=${JSON.stringify(process.execPath)}`,
  '-c', `mcp_servers.mio.args=${JSON.stringify([join(root, 'adapters/mcp/server.js'), '--demo'])}`,
  '-c', 'mcp_servers.mio.required=true', '-c', 'mcp_servers.mio.startup_timeout_sec=30', prompt];
const start = performance.now();
const run = spawnSync('codex', args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
const elapsedMs = Math.round(performance.now() - start);
// Keep diagnostic streams outside the public repository. Never publish environment/auth state.
writeFileSync(join(workspace, 'events.jsonl'), run.stdout ?? '', { mode: 0o600 });
writeFileSync(join(workspace, 'stderr.txt'), run.stderr ?? '', { mode: 0o600 });
const events = (run.stdout ?? '').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const completedTools = events.filter(e => e.type === 'item.completed' && e.item?.type === 'mcp_tool_call')
  .map(e => ({ server: e.item.server, tool: e.item.tool, arguments: e.item.arguments, result: e.item.result, error: e.item.error }));
let answer = null;
try { if (existsSync(answerPath)) answer = JSON.parse(readFileSync(answerPath, 'utf8')); } catch {}
const expected = { firstName: 'Alex', beforeEmail: 'alex.old@example.invalid', proposalStatus: 'pending',
  afterEmail: 'alex.old@example.invalid', unauthorizedReadDenied: true };
const answerMatches = answer !== null && Object.entries(expected).every(([key,value]) => answer[key] === value);
const toolNames = completedTools.map(t => t.tool);
const toolData = (tool) => {
  if (tool.result?.structured_content) return tool.result.structured_content;
  try { return JSON.parse(tool.result?.content?.find(c => c.type === 'text')?.text); } catch { return null; }
};
const reads = completedTools.filter(t => t.tool === 'mio_read');
const proposalIndex = completedTools.findIndex(t => t.tool === 'mio_propose_update' && toolData(t)?.status === 'pending');
const traceMatches = ['mio_list_fields', 'mio_read', 'mio_propose_update'].every(name => toolNames.includes(name))
  && reads.some(t => toolData(t)?.fields?.['person.name.first'] === expected.firstName
    && toolData(t)?.fields?.['person.contact.email'] === expected.beforeEmail)
  && reads.some(t => t.arguments?.fields?.includes('passport.number') &&
    t.result?.content?.some(c => c.type === 'text' && c.text.startsWith('Mio operation denied or unavailable.')))
  && proposalIndex >= 0 && completedTools.slice(proposalIndex + 1).some(t => t.tool === 'mio_read'
    && toolData(t)?.fields?.['person.contact.email'] === expected.afterEmail);
const result = {
  schemaVersion: 'mio.codex-mcp-smoke.v1', generatedAt: new Date().toISOString(),
  kind: 'single real-client integration probe; not comparative quality evidence',
  clientVersion: spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout?.trim(),
  requestedModel: model, reasoningEffort: 'low', dataset: 'fictional --demo',
  isolatedUserConfig: true, ephemeral: true, elapsedMs, exitCode: run.status,
  answer, expected, answerMatches, traceMatches,
  success: run.status === 0 && answerMatches && traceMatches,
  usage: events.findLast(e => e.type === 'turn.completed')?.usage ?? null,
  tools: completedTools,
  limitations: ['One prompt and one model; no accuracy or token-saving comparison.',
    'Read-only sandbox is not an OS-level isolation proof for data held by the MCP process.',
    'Existing local CLI login is reused; this script does not provision or export credentials.'],
};
mkdirSync(resolve(output, '..'), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ success: result.success, output, elapsedMs, exitCode: run.status,
  answerMatches, traceMatches, toolCount: completedTools.length, diagnostics: workspace }));
if (!result.success) process.exitCode = 1;
