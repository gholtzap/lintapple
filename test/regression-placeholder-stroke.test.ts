import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const input = '<input aria-label="Name" placeholder="Project details">';
const css = 'input{width:250px;padding:0;border:0;height:24px;line-height:24px;-webkit-text-fill-color:white;-webkit-text-stroke:1px black}input::placeholder{color:white;opacity:1}';
test('B018: placeholder strokes require review instead of a false contrast ratio', () => auditCases('b018', 'text-contrast', [
  { name: 'outlined placeholder', html: html(css, input), expected: ['unresolved'] },
  { name: 'white fill without stroke', html: html(css.replace('-webkit-text-stroke:1px black', '-webkit-text-stroke:0'), input), expected: ['failed'] },
  { name: 'readable placeholder', html: html('input::placeholder{color:#111;opacity:1}', input), expected: [] },
]));
