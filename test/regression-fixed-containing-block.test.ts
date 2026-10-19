import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkUrl } from '../src/index.js';
import type { RuleId } from '../src/types.js';
const shell = (body: string) => `<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px/24px system-ui}body{margin:24px}p{margin:0}input,textarea{font:16px system-ui;color:#111;background:white}input::placeholder,textarea::placeholder{color:#aaa;opacity:1}</style><body>${body}</body></html>`;
test('URL checks use the actual containing block of fixed elements', async () => {
  const cases: [string, string, RuleId[]][] = [
    ...['transform:translateX(0)', 'filter:blur(0)', 'perspective:1000px', 'contain:paint'].map((effect): [string, string, RuleId[]] => [effect, `<style>#container{width:100px;height:48px;${effect};overflow:hidden}#subject{position:fixed;left:0;top:0;width:240px;white-space:nowrap}</style><div id="container"><p id="subject">Project review is complete</p></div>`, ['content-clipping']]),
    ['viewport-fixed', '<style>#container{width:100px;height:48px;overflow:hidden}#subject{position:fixed;left:24px;top:24px;width:240px;white-space:nowrap}</style><div id="container"><p id="subject">Project review is complete</p></div>', []],
    ['clipped-edge', '<style>#container{width:100px;height:48px;transform:translateX(0);overflow:hidden}#subject{position:fixed;left:-80px;top:0;width:180px;height:48px;background:blue}</style><div id="container"><div id="subject"></div></div>', []],
    ['real-overflow', '<style>#subject{position:fixed;left:-80px;top:24px;width:180px;height:48px;background:blue}</style><div id="subject"></div>', ['viewport-bounds']],
  ];
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/fixed-containing-block-'));
  for (const [name, body, rules] of cases) {
    const path = join(directory, `${name}.html`);
    await writeFile(path, shell(body));
    const report = await checkUrl(pathToFileURL(path).href, { colorSchemes: ['light', 'dark'] });
    await writeFile(join(directory, `${name}.json`), JSON.stringify(report, null, 2));
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), [...rules].sort(), name);
  }
});
