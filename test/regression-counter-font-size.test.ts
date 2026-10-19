import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkUrl } from '../src/index.js';
import type { RuleId } from '../src/types.js';
const shell = (body: string) => `<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px/24px system-ui}body{margin:24px}p{margin:0}input,textarea{font:16px system-ui;color:#111;background:white}input::placeholder,textarea::placeholder{color:#aaa;opacity:1}</style><body><div>Project ready</div>${body}</body></html>`;
test('URL checks apply font size rules to CSS counters', async () => {
  const cases: [string, string, RuleId[]][] = [
    ['counter', '<style>body{counter-reset:item 7}p::before{content:counter(item);font-size:37px}</style><p></p>', ['font-size']],
    ['inherited', '<style>body{counter-reset:item 7}p{font-size:37px}p::before{content:counter(item)}</style><p></p>', ['font-size']],
    ['counters', '<style>body{counter-reset:item 2}section{counter-reset:item 7}p::after{content:counters(item,".");font-size:37px}</style><section><p></p></section>', ['font-size']],
    ['correct', '<style>body{counter-reset:item 7}p::before{content:counter(item);font-size:16px}</style><p></p>', []],
    ['hidden', '<style>p::before{content:counter(item);font-size:37px;display:none}</style><p></p>', []],
    ['empty-style', '<style>p::before{content:counter(item,none);font-size:37px}</style><p></p>', []],
    ['code', '<style>code::before{content:counter(item);font-size:37px}</style><code></code>', []],
  ];
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/counter-font-size-'));
  for (const [name, body, rules] of cases) {
    const path = join(directory, `${name}.html`);
    await writeFile(path, shell(body));
    const report = await checkUrl(pathToFileURL(path).href, { colorSchemes: ['light', 'dark'] });
    await writeFile(join(directory, `${name}.json`), JSON.stringify(report, null, 2));
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), [...rules].sort(), name);
  }
});
