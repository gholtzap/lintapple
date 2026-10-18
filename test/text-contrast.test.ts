import type { Finding } from '../src/types.js';
import type { PageReport } from '../src/types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { checkPage, checkUrl } from '../src/index.js';

const fixture = (content: string) => `<!doctype html><html><style>html{background:white;font:16px/1.5 system-ui}body{margin:24px}button,input{font:inherit}</style><body>${content}</body></html>`;
const contrast = (result: Pick<PageReport, 'findings'>) => result.findings.filter(f => f.rule === 'text-contrast');

test('text contrast checks thresholds, compositing, states, and unknown backgrounds', async () => {
  const browser = await chromium.launch();
  const receipt: {width: number; name: string; expectedStatus: string | null; findings: Finding[]}[] = [];
  try {
    const page = await browser.newPage();
    const cases = [
      {name:'black text',html:fixture('<p>Readable text</p>'),status:null},
      {name:'normal text just above 4.5',html:fixture('<p style="color:#767676">Readable text</p>'),status:null},
      {name:'normal text below 4.5',html:fixture('<p style="color:#777">Pale text</p>'),status:'failed',required:4.5},
      {name:'single character',html:fixture('<p style="color:#aaa">7</p>'),status:'failed',required:4.5},
      {name:'pale text below initial screen',html:fixture('<div style="height:1200px"></div><p style="color:#aaa">Pale text</p>'),status:'failed',required:4.5},
      {name:'large text above 3',html:fixture('<p style="font-size:24px;color:#949494">Large text</p>'),status:null},
      {name:'large text below 3',html:fixture('<p style="font-size:24px;color:#959595">Pale large text</p>'),status:'failed',required:3},
      {name:'23 px is not large',html:fixture('<p style="font-size:23px;color:#949494">Normal text</p>'),status:'failed',required:4.5},
      {name:'bold large text',html:fixture('<p style="font-size:18.667px;font-weight:700;color:#949494">Bold text</p>'),status:null},
      {name:'medium weight is not bold',html:fixture('<p style="font-size:20px;font-weight:500;color:#949494">Medium text</p>'),status:'failed',required:4.5},
      {name:'inherited background',html:fixture('<section style="background:#222"><p style="color:#fff">Light text</p></section>'),status:null},
      {name:'transparent text',html:fixture('<p style="color:rgba(0,0,0,.2)">Pale text</p>'),status:'failed',required:4.5},
      {name:'ancestor opacity',html:fixture('<section style="opacity:.2"><p>Faint text</p></section>'),status:'failed',required:4.5},
      {name:'transparent background layer',html:fixture('<section style="background:#000"><div style="background:rgba(255,255,255,.9);color:#111">Readable text</div></section>'),status:null},
      {name:'disabled native control',html:fixture('<button disabled style="color:#ddd">Disabled</button>'),status:null},
      {name:'hidden text',html:fixture('<p hidden style="color:#ddd">Hidden</p><p>Visible</p>'),status:null},
      {name:'placeholder',html:fixture('<style>input::placeholder{color:#aaa;opacity:1}</style><input placeholder="Client name">'),status:'failed',required:4.5},
      {name:'readable placeholder',html:fixture('<style>input::placeholder{color:#222;opacity:1}</style><input placeholder="Client name">'),status:null},
      {name:'placeholder opacity',html:fixture('<style>input::placeholder{color:#000;opacity:.2}</style><input placeholder="Client name">'),status:'failed',required:4.5},
      {name:'placeholder inside opacity group',html:fixture('<div style="opacity:.5"><input placeholder="Client name"></div>'),status:'unresolved'},
      {name:'background image',html:fixture('<p style="background-image:url(\'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22%3E%3Crect width=%221%22 height=%221%22 fill=%22white%22/%3E%3C/svg%3E\')">Text over an image</p>'),status:'unresolved'},
    ];
    for (const width of [390,1440]) {
      await page.setViewportSize({width,height:900});
      for (const entry of cases) {
        await page.setContent(entry.html);
        const findings = contrast(await checkPage(page));
        if (entry.status) {
          assert.ok(findings.some(f=>f.status===entry.status), `${width}px ${entry.name}: ${JSON.stringify(findings)}`);
          if (entry.required) assert.ok(findings.some(f=>f.requiredContrastRatio===entry.required));
          assert.ok(findings.every(f=>f.selector && f.actual && f.expected && f.fix));
        } else assert.deepEqual(findings,[],`${width}px ${entry.name}`);
        receipt.push({width,name:entry.name,expectedStatus:entry.status,findings});
      }
    }
    await page.setContent(fixture('<p id="label" style="color:#aaa">Pale text</p>'));
    const excepted = await checkPage(page,{exceptions:[{selector:'#label',rules:['text-contrast'],reason:'This text is part of a logotype.'}]});
    assert.deepEqual(contrast(excepted),[]);
    assert.ok(excepted.suppressed.some(f=>f.rule==='text-contrast'));
    await page.setContent(fixture('<style>#label:hover{color:#aaa}</style><p id="label">Hover text</p>'));
    assert.deepEqual(contrast(await checkPage(page)),[]);
    await page.locator('#label').hover();
    assert.ok(contrast(await checkPage(page)).some(f=>f.status==='failed'));
    await page.evaluate(()=>{window.axe={sentinel:'App-owned engine'};});
    await checkPage(page);
    assert.equal(await page.evaluate(()=>window.axe.sentinel),'App-owned engine');
    await mkdir('test-results',{recursive:true});
    await writeFile('test-results/text-contrast.html',fixture('<p style="color:#aaa">Pale text</p>'));
    const url=new URL('../../test-results/text-contrast.html',import.meta.url).href;
    const report=await checkUrl(url);
    assert.equal(contrast(report).length,2);
    assert.deepEqual(await checkUrl(url),report);
    await writeFile('test-results/text-contrast-unresolved.html',cases.find(entry=>entry.name==='background image')!.html);
    const unknownUrl=new URL('../../test-results/text-contrast-unresolved.html',import.meta.url).href;
    const unresolvedCli=spawnSync(process.execPath,['dist/bin/lintapple.js',unknownUrl,'--json'],{encoding:'utf8'});
    assert.equal(unresolvedCli.status,1,unresolvedCli.stderr);
    assert.ok(contrast(JSON.parse(unresolvedCli.stdout)).some(f=>f.status==='unresolved'));
    await writeFile('test-results/text-contrast-report.json',JSON.stringify(report,null,2));
    await writeFile('test-results/text-contrast-receipt.json',JSON.stringify({command:'npm test',inputs:'test/text-contrast.test.js',node:process.version,cases:receipt},null,2));
  } finally {await browser.close();}
});
