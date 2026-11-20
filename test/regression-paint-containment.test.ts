import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const text = '<div id="panel"><p>Project review is complete</p></div>';
const css = '#panel{width:100px;height:24px;white-space:nowrap}';
test('B029: paint containment clips text at its overflow clip edge', () => auditCases('b029', 'content-clipping', [
  ...['paint', 'strict', 'content', 'layout paint'].map(contain => ({ name: contain, html: html(`${css}#panel{contain:${contain}}`, text), expected: ['failed' as const] })),
  { name: 'layout alone does not clip', html: html(`${css}#panel{contain:layout}`, text), expected: [] },
  { name: 'expanded containment clip', html: html(`${css}#panel{contain:paint;overflow-clip-margin:120px}`, text), expected: [] },
  { name: 'local scrolling', html: html(`${css}#panel{contain:paint;overflow:auto}`, text), expected: [] },
  { name: 'overflow control', html: html(`${css}#panel{overflow:hidden}`, text), expected: ['failed'] },
]));
