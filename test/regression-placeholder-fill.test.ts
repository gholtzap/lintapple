import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkUrl } from '../src/index.js';
import type { Policy, RuleId } from '../src/types.js';

const shell = (body: string) => `<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px system-ui}body{margin:24px}input,textarea,button{font:16px system-ui;color:#111;background:white}label{display:block}</style><body><p>Project ready</p>${body}</body></html>`;

test('URL checks calculate placeholder contrast from its painted text fill', async () => {
  const cases: Record<string, { body: string; rules: RuleId[]; policy?: Partial<Policy> }> = {
    readable: { body: '<style>input{-webkit-text-fill-color:#111}input::placeholder{color:#aaa;opacity:1}</style><label for="name">Name</label><input id="name" placeholder="Project name">', rules: [] },
    paleFill: { body: '<style>input{-webkit-text-fill-color:#aaa}input::placeholder{color:#111;opacity:1}</style><label for="name">Name</label><input id="name" placeholder="Project name">', rules: ['text-contrast'] },
    paleColor: { body: '<style>input::placeholder{color:#aaa;opacity:1}</style><label for="name">Name</label><input id="name" placeholder="Project name">', rules: ['text-contrast'] },
    filled: { body: '<style>input{-webkit-text-fill-color:#111}input::placeholder{color:#aaa;opacity:1}</style><label for="name">Name</label><input id="name" value="Project" placeholder="Project name">', rules: [] },
  };
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/CLI-placeholder-fill-'));
  for (const [name, entry] of Object.entries(cases)) {
    const path = join(directory, `${name}.html`);
    await writeFile(path, shell(entry.body));
    const policy: Partial<Policy> = { colorSchemes: ['light', 'dark'], ...entry.policy };
    const report = await checkUrl(pathToFileURL(path).href, policy);
    await writeFile(join(directory, `${name}.json`), JSON.stringify(report, null, 2));
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) {
      assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), [...entry.rules].sort(), name);
      if (entry.rules.length) { assert.equal(run.states[0].findings.length, 1); assert.equal(run.states[0].findings[0].status, 'failed'); assert.equal(run.states[0].findings[0].contrastRatio, 2.32); }
    }
  }
});
