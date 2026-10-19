import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkUrl } from '../src/index.js';
import type { Policy, RuleId } from '../src/types.js';

const shell = (body: string) => `<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px system-ui}body{margin:24px}input,textarea,button{font:16px system-ui;color:#111;background:white}label{display:block}</style><body><p>Project ready</p>${body}</body></html>`;
const image = (style: string) => `<input type="image" alt="Save" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='black'/%3E%3C/svg%3E" style="padding:0;border:0;${style}">`;

test('URL checks apply size, gap, and inset rules to image submit buttons', async () => {
  const cases: Record<string, { body: string; rules: RuleId[]; policy?: Partial<Policy> }> = {
    small: { body: image('width:14px;height:14px'), rules: ['control-size'] },
    fitting: { body: image('width:16px;height:16px'), rules: [] },
    gap: { body: `<div data-ui-actions style="display:flex;gap:0">${image('width:32px;height:32px')}${image('width:32px;height:32px')}</div>`, rules: ['control-gap'] },
    inset: { body: `<div data-ui-container style="width:40px;height:40px">${image('display:block;width:32px;height:32px')}</div>`, rules: ['control-inset'] },
    custom: { body: image('width:16px;height:16px'), rules: ['control-size'], policy: { controlSizeRules: [{ selector: 'input[type=image]', minSize: 24 }] } },
  };
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/CLI-image-controls-'));
  for (const [name, entry] of Object.entries(cases)) {
    const path = join(directory, `${name}.html`);
    await writeFile(path, shell(entry.body));
    const policy: Partial<Policy> = { colorSchemes: ['light', 'dark'], ...entry.policy };
    const report = await checkUrl(pathToFileURL(path).href, policy);
    await writeFile(join(directory, `${name}.json`), JSON.stringify(report, null, 2));
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) {
      assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), [...entry.rules].sort(), name);
      assert.equal(run.controls, name === 'gap' ? 2 : 1);
    }
  }
});
