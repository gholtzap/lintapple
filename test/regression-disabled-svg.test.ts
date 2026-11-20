import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkUrl } from '../src/index.js';
import type { Policy, RuleId } from '../src/types.js';

const shell = (body: string) => `<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px system-ui}body{margin:24px}input,textarea,button{font:16px system-ui;color:#111;background:white}label{display:block}</style><body><p>Project ready</p>${body}</body></html>`;
const svg = '<svg width="260" height="60"><rect width="260" height="60" fill="white"/><text x="10" y="40" fill="#aaa">Save</text></svg>';
const button = (attrs: string) => `<button aria-label="Save" style="width:280px;height:90px;padding:8px" ${attrs}>${svg}</button>`;

test('URL checks exclude disabled SVG control text and still check enabled text', async () => {
  const cases: Record<string, { body: string; rules: RuleId[]; policy?: Partial<Policy> }> = {
    disabled: { body: button('disabled'), rules: [] },
    ariaDisabled: { body: button('aria-disabled="true"'), rules: [] },
    fieldset: { body: `<fieldset disabled style="padding:0;border:0">${button('')}</fieldset>`, rules: [] },
    enabled: { body: button(''), rules: ['text-contrast'] },
    legend: { body: `<fieldset disabled style="padding:0;border:0"><legend style="padding:0">${button('')}</legend></fieldset>`, rules: ['text-contrast'] },
  };
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/CLI-disabled-svg-'));
  for (const [name, entry] of Object.entries(cases)) {
    const path = join(directory, `${name}.html`);
    await writeFile(path, shell(entry.body));
    const policy: Partial<Policy> = { colorSchemes: ['light', 'dark'], ...entry.policy };
    const report = await checkUrl(pathToFileURL(path).href, policy);
    await writeFile(join(directory, `${name}.json`), JSON.stringify(report, null, 2));
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) {
      assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), [...entry.rules].sort(), name);
      if (entry.rules.length) assert.ok(run.states[0].findings.every(f => f.status === 'failed'));
    }
  }
});
