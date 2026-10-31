import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { checkInteractions } from '../src/index.js';
import { html } from './audit-cases.js';
test('B043: menu entry can use its selected radio item',async()=>{
 const browser=await chromium.launch();try{const page=await browser.newPage();for(const target of ['two','one','three']){
 await page.setContent(html('button{padding:8px}[hidden]{display:none!important}',`<button id="open" aria-haspopup="menu" aria-controls="menu" aria-expanded="false">View</button><div id="menu" role="menu" aria-label="View" hidden><button id="one" role="menuitemradio" aria-checked="false" tabindex="-1">List</button><button id="two" role="menuitemradio" aria-checked="true" tabindex="-1">Grid</button><button id="three" role="menuitemradio" aria-checked="false" tabindex="-1">Cards</button></div><script>document.querySelector('#open').onclick=()=>{menu.hidden=false;document.querySelector('#open').setAttribute('aria-expanded','true');document.querySelector('#${target}').focus()};menu.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();three.focus()}}</script>`));
 const report=await checkInteractions(page,{timeout:200,menus:[{selector:'#menu',open:'#open',steps:[{key:'ArrowDown',focus:'#three'}]}]});assert.equal(report.findings.some(f=>f.phase==='menu-entry'),target==='three');
 }}finally{await browser.close();}
});
