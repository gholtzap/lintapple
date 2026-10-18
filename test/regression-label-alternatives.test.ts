import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkUrl } from '../src/index.js';
import type { Policy, RuleId } from '../src/types.js';

const shell = (body: string) => `<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px system-ui}body{margin:24px}input,textarea,button{font:16px system-ui;color:#111;background:white}label{display:block}</style><body><p>Project ready</p>${body}</body></html>`;
const image = '<img alt="Name" width="64" height="24" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2224%22%3E%3Ctext y=%2218%22 font-size=%2216%22%3EName%3C/text%3E%3C/svg%3E">';

test('URL checks accept image labels and reject fields without a programmatic label', async () => {
  const cases: Record<string, { body: string; rules: RuleId[]; policy?: Partial<Policy> }> = {
    image: { body: `<label for="name">${image}</label><input id="name">`, rules: [] },
    referenced: { body: `<span id="label">${image}</span><input aria-labelledby="label">`, rules: [] },
    hiddenReference: { body: '<span hidden id="label">Name</span><input aria-labelledby="label">', rules: [] },
    text: { body: '<label for="name">Name</label><input id="name">', rules: [] },
    placeholder: { body: '<input placeholder="Name">', rules: ['form-label'] },
    emptyLabel: { body: '<label for="name"></label><input id="name" placeholder="Name">', rules: ['form-label'] },
    title: { body: '<input title="Name">', rules: ['form-label'] },
  };
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/CLI-label-alternatives-'));
  for (const [name, entry] of Object.entries(cases)) {
    const path = join(directory, `${name}.html`);
    await writeFile(path, shell(entry.body));
    const policy: Partial<Policy> = { colorSchemes: ['light', 'dark'], ...entry.policy };
    const report = await checkUrl(pathToFileURL(path).href, policy);
    await writeFile(join(directory, `${name}.json`), JSON.stringify(report, null, 2));
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) {
      assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), [...entry.rules].sort(), name);

    }
  }
});
