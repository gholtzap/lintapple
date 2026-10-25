import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { checkInteractions } from '../src/index.js';
import { html } from './audit-cases.js';
test('B050: an empty text-clipped background does not cover focus',async()=>{
 const browser=await chromium.launch();try{const page=await browser.newPage();for(const clip of ['text','border-box']){await page.setContent(html(`button{position:fixed;left:40px;top:40px;width:140px;height:48px}button:focus-visible{outline:3px solid blue}#cover{position:fixed;left:30px;top:30px;width:160px;height:68px;pointer-events:none;background:white;background-clip:${clip};z-index:10}`, '<button id="target">Save changes</button><div id="cover"></div>'));const report=await checkInteractions(page,{timeout:200,focus:[{selector:'#target'}]});assert.equal(report.findings.some(f=>f.rule==='focus-obscured'),clip==='border-box');}}
 finally{await browser.close();}
});
