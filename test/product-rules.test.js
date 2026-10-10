import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
const good = `<!doctype html><html lang="en"><style>
html { background: white; color: #202020; font: 16px/24px system-ui; }
body { margin: 24px; } p { margin: 0; }
.panel { width: 224px; padding: 8px; }
.heading { margin-inline: 8px; }
.actions { display: flex; gap: 8px; padding: 8px; }
button, input { font: 14px system-ui; min-height: 40px; padding: 8px; color: #202020; background: white; }
.name { width: 180px; overflow-wrap: anywhere; }
label, input { display: block; margin-top: 8px; }
</style><body>
<section class="panel" data-ui-align="start">
  <p class="heading" data-ui-align-item>Edit project</p>
  <div class="actions" data-ui-actions data-ui-container>
    <button data-ui-align-item aria-describedby="help">Cancel</button><button>Save</button>
  </div>
</section>
<p id="help">Cancel the changes.</p>
<p class="name">Customer research archive with interviews, notes, and recordings</p>
<label for="project">Project name</label><input id="project" value="Research">
</body></html>`;
const cases = {
  'layout-alignment': good.replace('margin-inline: 8px', 'margin-inline: 0'),
  'content-clipping': good.replace('overflow-wrap: anywhere', 'overflow: hidden; white-space: nowrap; text-overflow: ellipsis'),
  'content-overflow': good.replace('<p class="name">', '<p class="name" data-ui-content style="white-space: nowrap; width: 80px;">').replace('Customer research archive with interviews, notes, and recordings', 'Customer research archive'),
  'accessible-name': good.replace('<button>Save</button>', '<button><span aria-hidden="true">Save</span></button>'),
  'form-label': good.replace('for="project"', 'for="missing"'),
  'aria-reference': good.replace('aria-describedby="help"', 'aria-describedby="missing"'),
  'label-consistency': good.replace('<button>Save</button>', '<button aria-label="Delete project">Save</button>'),
};

test('packaged product checks alignment, clipping, names, labels, references, and matching names', async () => {
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/product-rules-'));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(cases[request.url.slice(1)] || good);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const packed = JSON.parse((await run('npm', ['pack', '--json', '--pack-destination', directory])).stdout)[0];
    await run('tar', ['-xzf', join(directory, packed.filename), '-C', directory]);
    const product = await import(pathToFileURL(join(directory, 'package/src/index.js')));
    for (const rule of Object.keys(cases)) assert.ok(product.ruleIds.includes(rule), `Missing product rule: ${rule}`);
    const cli = async path => {
      try {
        return { code: 0, ...(await run(process.execPath, [join(directory, 'package/bin/lintapple.js'), `${origin}/${path}`, '--json'])) };
      } catch (error) {
        if (typeof error.code !== 'number') throw error;
        return { code: error.code, stdout: error.stdout, stderr: error.stderr };
      }
    };
    const passed = await cli('');
    assert.equal(passed.code, 0, passed.stderr || passed.stdout);
    assert.deepEqual(JSON.parse(passed.stdout).findings, []);
    const reports = [];
    for (const rule of Object.keys(cases)) {
      const failed = await cli(rule);
      assert.equal(failed.code, 1, `${rule}: ${failed.stderr || failed.stdout}`);
      const report = JSON.parse(failed.stdout);
      const expected = rule === 'aria-reference' ? ['aria-reference', 'control-state'] : [rule];
      assert.deepEqual([...new Set(report.findings.map(finding => finding.rule))].sort(), expected);
      for (const viewport of product.defaultPolicy.viewports) {
        assert.ok(report.findings.some(finding => finding.rule === rule && finding.viewport.width === viewport.width), `${rule}: missing ${viewport.width}px check`);
      }
      assert.ok(report.findings.every(finding => finding.selector && finding.actual && finding.expected && finding.fix));
      reports.push({ rule, code: failed.code, report });
    }
    const corrected = await product.checkUrl(`${origin}/`);
    assert.deepEqual(corrected.findings, []);
    await writeFile('test-results/product-rules-receipt.json', JSON.stringify({ package: packed.filename, integrity: packed.integrity, reports, corrected }, null, 2));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
