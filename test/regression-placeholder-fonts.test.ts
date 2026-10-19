import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkUrl } from '../src/index.js';
import type { Policy, RuleId } from '../src/types.js';

const shell = (body: string) => `<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px system-ui}body{margin:24px}input,textarea,button{font:16px system-ui;color:#111;background:white}label{display:block}</style><body><p>Project ready</p>${body}</body></html>`;

test('URL checks use the visible placeholder font and its text role', async () => {
  const cases: Record<string, { body: string; rules: RuleId[]; policy?: Partial<Policy> }> = {
    invalid: { body: '<style>input::placeholder{color:#111;opacity:1;font:37px Georgia}</style><label for="name">Name</label><input id="name" placeholder="Name">', rules: ['font-family', 'font-size'] },
    textarea: { body: '<style>textarea::placeholder{color:#111;opacity:1;font:37px Georgia}</style><label for="name">Name</label><textarea id="name" placeholder="Name"></textarea>', rules: ['font-family', 'font-size'] },
    corrected: { body: '<style>input::placeholder{color:#111;opacity:1;font:16px system-ui}</style><label for="name">Name</label><input id="name" placeholder="Name">', rules: [] },
    filled: { body: '<style>input::placeholder{font:37px Georgia}</style><label for="name">Name</label><input id="name" value="Project" placeholder="Name">', rules: [] },
    empty: { body: '<style>input::placeholder{font:37px Georgia}</style><label for="name">Name</label><input id="name" placeholder="">', rules: [] },
    role: { body: '<style>input{font-size:14px}input::placeholder{color:#111;opacity:1;font:20px system-ui}</style><label for="name">Name</label><input id="name" placeholder="Name">', rules: ['font-size'], policy: { typeRules: [{ selector: 'input', sizes: [14] }] } },
  };
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/CLI-placeholder-fonts-'));
  for (const [name, entry] of Object.entries(cases)) {
    const path = join(directory, `${name}.html`);
    await writeFile(path, shell(entry.body));
    const policy: Partial<Policy> = { colorSchemes: ['light', 'dark'], ...entry.policy };
    const report = await checkUrl(pathToFileURL(path).href, policy);
    await writeFile(join(directory, `${name}.json`), JSON.stringify(report, null, 2));
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) {
      assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), [...entry.rules].sort(), name);
      if (['invalid', 'textarea', 'role'].includes(name)) assert.ok(run.states[0].findings.every(f => f.selector.endsWith('::placeholder')));
    }
  }
});
