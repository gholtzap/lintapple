import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finding, summarizeFindings, formatSummary, formatFrameCoverage } from '../src/report.js';
test('B041: human reports escape page control bytes',()=>{
 const text='value'+String.fromCharCode(27)+'[31m'+String.fromCharCode(0x85);
 const item=finding('control-state','#subject',text,'valid state','Correct the state.');
 const summary=summarizeFindings([item]);const result=formatSummary(summary);
 assert.ok(!result.includes(String.fromCharCode(27)));assert.ok(!result.includes(String.fromCharCode(0x85)));assert.ok(result.includes('\\u001b'));assert.equal(summary.groups[0].finding.actual,text);
 const coverage=formatFrameCoverage([{checked:{url:text,path:'main',name:''},omitted:[]}]);assert.ok(!coverage.includes(String.fromCharCode(27)));
});
