import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const argument = process.argv[2];
const match = argument?.match(/^--shard=(\d+)\/(\d+)$/);
if (process.argv.length > 3 || (argument && !match)) throw new Error('Use --shard=index/count.');
const index = match ? Number(match[1]) : 1;
const count = match ? Number(match[2]) : 1;
const files = readdirSync('dist/test').filter(name => name.endsWith('.test.js')).sort();
if (!Number.isInteger(index) || index < 1 || count < 1 || index > count || count > files.length) throw new Error('Shard index and count must select a nonempty test group.');
const timing: { durationsMs: Record<string, number> } = JSON.parse(readFileSync('scripts/test-timings.json', 'utf8'));
const fallback = Math.max(1, ...Object.values(timing.durationsMs));
const duration = (file: string): number => {
  const value = timing.durationsMs[file];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
};
const shards = Array.from({ length: count }, () => ({ files: [] as string[], durationMs: 0 }));
for (const file of files.sort((a, b) => duration(b) - duration(a) || a.localeCompare(b))) {
  const shard = shards.reduce((best, candidate) => candidate.durationMs < best.durationMs ? candidate : best);
  shard.files.push(file);
  shard.durationMs += duration(file);
}
const selected = shards[index - 1];
if (!selected?.files.length) throw new Error('No test files were selected.');
mkdirSync('test-results', { recursive: true });
writeFileSync(`test-results/ci-tests-${index}.json`, JSON.stringify({ index, count, ...selected }, null, 2) + '\n');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...selected.files.map(file => `dist/test/${file}`)], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
