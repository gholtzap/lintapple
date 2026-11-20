import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { checkInteractions } from '../src/index.js';
import { html } from './audit-cases.js';
test('B036: keyboard checks include owned menu items',async()=>{
 const browser=await chromium.launch();try{const page=await browser.newPage();
 for(const broken of [false,true]){await page.setContent(html('#menu{width:240px;height:80px}',`<div id="menu" role="menu" tabindex="0" aria-label="Projects" aria-owns="one two" aria-activedescendant="one"></div><div id="one" role="menuitem">Project details</div><div id="two" role="menuitem">Review notes</div><script>menu.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();${broken?'':`menu.setAttribute('aria-activedescendant','two')`}}}</script>`));const report=await checkInteractions(page,{timeout:200,menus:[{selector:'#menu',steps:[{key:'ArrowDown',focus:'#two'}]}]});assert.equal(report.findings.some(f=>f.rule==='keyboard-operation'||f.rule==='control-state'),broken);}
 }finally{await browser.close();}
});
