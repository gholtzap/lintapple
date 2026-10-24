import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';
test('B035: nested-radius', () => auditCases('audit2-b035', 'nested-radius', [
  ...[false,true].map(bevel=>({name:bevel?'bevel':'round',html:html(`#outer{width:150px;height:100px;padding:8px;border-radius:20px;${bevel?'corner-shape:bevel':''}}#inner{height:100%;border-radius:12px}`, '<div id="outer" data-ui-radius><div id="inner" data-ui-radius-inner></div></div>'),expected:bevel?['failed' as const]:[]}))
]));
