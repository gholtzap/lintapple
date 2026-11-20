import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const css = 'p{font-size:0;width:240px;height:24px}span{font-size:16px}';
test('B015: font checks omit text that has zero font size', () => auditCases('b015', 'font-size', [
  { name: 'zero-size parent text', html: html(css, '<p>Invisible<span>Project details</span></p>'), expected: [] },
  { name: 'no parent text', html: html(css, '<p><span>Project details</span></p>'), expected: [] },
  { name: 'visible bad size', html: html('p{font-size:17px}', '<p>Project details</p>'), expected: ['failed'] },
]));
