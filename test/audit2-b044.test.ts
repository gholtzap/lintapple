import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { checkInteractions } from '../src/index.js';
import { html } from './audit-cases.js';
test('B044: active descendants can have painted text without a box',async()=>{
 const browser=await chromium.launch();try{const page=await browser.newPage();for(const hidden of [false,true]){
 await page.setContent(html(`#one,#two{display:contents}${hidden?'#two{visibility:hidden}':''}`,`<div id="menu" role="menu" tabindex="0" aria-label="Projects" aria-activedescendant="one"><div id="one" role="menuitem">Project details</div><div id="two" role="menuitem">Review notes</div></div><script>menu.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();menu.setAttribute('aria-activedescendant','two')}}</script>`));const report=await checkInteractions(page,{timeout:200,menus:[{selector:'#menu',steps:[{key:'ArrowDown',focus:'#two'}]}]});assert.equal(report.findings.some(f=>f.rule==='keyboard-operation'),hidden);
 }}finally{await browser.close();}
});
