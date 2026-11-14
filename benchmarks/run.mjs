import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runArchitectureBenchmark } from './architecture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2] ?? 'benchmarks/results/architecture-results.json';
function filesUnder(relative) {
  return readdirSync(join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const file = `${relative}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}
const sourceFiles = [
  ...filesUnder('mio-core/src'), ...filesUnder('mio-core/migrations'),
  'examples/fictional-host.js', 'examples/scoped-reader.js',
  ...filesUnder('benchmarks').filter((file) => !file.startsWith('benchmarks/results/') &&
    (file.endsWith('.mjs') || file.endsWith('fixture.json'))),
].sort();
const sourceFileHashes = Object.fromEntries(sourceFiles.map((file) => [file,
  createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]));
const result = {
  reportDate: '2026-11-14',
  executedAtUtc: new Date().toISOString(),
  command: 'node benchmarks/run.mjs',
  environment: { node: process.version, sqlite: process.versions.sqlite,
    platform: process.platform, architecture: process.arch },
  sourceFileHashes,
  ...runArchitectureBenchmark(),
};
mkdirSync(dirname(join(root, output)), { recursive: true });
writeFileSync(join(root, output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, totals: result.totals, lifecycle: result.lifecycleSummary,
  payloadReductionPercent: result.scopedPayloadReductionAgainstFullReferencePercent }, null, 2));
