import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkUrl } from '../src/index.js';
import type { RuleId } from '../src/types.js';
const shell = (body: string) => `<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px/24px system-ui}body{margin:24px}p{margin:0}input,textarea{font:16px system-ui;color:#111;background:white}input::placeholder,textarea::placeholder{color:#aaa;opacity:1}</style><body><div>Project ready</div>${body}</body></html>`;
test('URL checks include generated text in copy rules and keep text boundaries', async () => {
  const cases: [string, string, RuleId[]][] = [
    ['before', '<style>p::before{content:"Unlock your potential"}</style><p></p>', ['copy']],
    ['after', '<style>p::after{content:"Unlock your potential"}</style><p></p>', ['copy']],
    ['split', '<style>p::before{content:"Unlock "}p::after{content:" potential"}</style><p>your</p>', ['copy']],
    ['attribute', '<style>p::before{content:attr(data-label)}</style><p data-label="Unlock your potential"></p>', ['copy']],
    ['counter-prefix', '<style>p::before{content:counter(item) " Unlock your potential"}</style><p></p>', ['copy']],
    ['counter-boundary', '<style>p::before{content:"Unlock " counter(item) "your potential"}</style><p></p>', []],
    ['alternative', '<style>p::before{content:"Project details" / "Unlock your potential"}</style><p></p>', []],
    ['hidden', '<style>p::before{content:"Unlock your potential";display:none}</style><p></p>', []],
    ['approved', '<style>p::before{content:"Project details"}</style><p></p>', []],
    ['code', '<style>code::before{content:"Unlock your potential"}</style><code></code>', []],
    ['code-boundary', '<style>p::before{content:"Unlock "}</style><p><code>your</code> potential</p>', []],
  ];
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/generated-copy-'));
  for (const [name, body, rules] of cases) {
    const path = join(directory, `${name}.html`);
    await writeFile(path, shell(body));
    const report = await checkUrl(pathToFileURL(path).href, { colorSchemes: ['light', 'dark'] });
    await writeFile(join(directory, `${name}.json`), JSON.stringify(report, null, 2));
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), [...rules].sort(), name);
  }
});
