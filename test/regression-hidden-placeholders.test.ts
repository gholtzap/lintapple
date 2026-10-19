import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkUrl } from '../src/index.js';
import type { RuleId } from '../src/types.js';
const shell = (body: string) => `<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px/24px system-ui}body{margin:24px}p{margin:0}input,textarea{font:16px system-ui;color:#111;background:white}input::placeholder,textarea::placeholder{color:#aaa;opacity:1}</style><body>${body}</body></html>`;
test('URL checks ignore empty and hidden placeholders but still check visible text', async () => {
  const cases: [string, string, RuleId[]][] = [
    ['hidden', '<style>input::placeholder{visibility:hidden}</style><input aria-label="Name" placeholder="Example">', []],
    ['transparent', '<style>input::placeholder{opacity:0}</style><input aria-label="Name" placeholder="Example">', []],
    ['empty', '<input aria-label="Name" placeholder="">', []],
    ['spaces', '<input aria-label="Name" placeholder="   ">', []],
    ['textarea', '<style>textarea::placeholder{visibility:hidden}</style><textarea aria-label="Name" placeholder="Example"></textarea>', []],
    ['visible', '<input aria-label="Name" placeholder="Example">', ['text-contrast']],
    ['faint', '<style>input::placeholder{opacity:.2;color:black}</style><input aria-label="Name" placeholder="Example">', ['text-contrast']],
    ['value', '<input aria-label="Name" value="Example" placeholder="Example">', []],
  ];
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/hidden-placeholders-'));
  for (const [name, body, rules] of cases) {
    const path = join(directory, `${name}.html`);
    await writeFile(path, shell(body));
    const report = await checkUrl(pathToFileURL(path).href, { colorSchemes: ['light', 'dark'] });
    await writeFile(join(directory, `${name}.json`), JSON.stringify(report, null, 2));
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), [...rules].sort(), name);
  }
});
