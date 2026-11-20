import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const text = '<div id="panel"><p>Project review is complete</p></div>';
const css = '#panel{width:100px;overflow:clip;white-space:nowrap}';
test('B028: clip bounds include the overflow clip margin', () => auditCases('b028', 'content-clipping', [
  { name: 'expanded clip', html: html(`${css}#panel{overflow-clip-margin:120px}`, text), expected: [] },
  { name: 'insufficient margin', html: html(`${css}#panel{overflow-clip-margin:20px}`, text), expected: ['failed'] },
  { name: 'no margin', html: html(css, text), expected: ['failed'] },
  { name: 'hidden overflow ignores the margin', html: html(`${css}#panel{overflow:hidden;overflow-clip-margin:120px}`, text), expected: ['failed'] },
  { name: 'scaled clip', html: html(`${css}#panel{overflow-clip-margin:120px;transform:scale(.5);transform-origin:top left}`, text), expected: [] },
  { name: 'scaled zero-width box', html: html(`${css}#panel{width:0;overflow-clip-margin:120px;transform:scale(2);transform-origin:top left}`, '<div id="panel"><p>Project</p></div>'), expected: [] },
  { name: 'content box', html: html(`${css}#panel{padding:16px;border:8px solid #ddd;overflow-clip-margin:content-box 120px}`, text), expected: [] },
  { name: 'border box', html: html(`${css}#panel{padding:16px;border:8px solid #ddd;overflow-clip-margin:border-box 120px}`, text), expected: [] },
]));
