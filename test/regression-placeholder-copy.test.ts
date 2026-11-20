import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const css = 'input::placeholder,textarea::placeholder{color:#111;opacity:1}';
test('B021: prohibited copy includes visible authored placeholders', () => auditCases('b021', 'copy', [
  { name: 'input placeholder', html: html(css, '<input aria-label="Name" placeholder="Unlock your potential">'), expected: ['failed'] },
  { name: 'textarea placeholder', html: html(css, '<textarea aria-label="Name" placeholder="Unlock your potential"></textarea>'), expected: ['failed'] },
  { name: 'hidden placeholder', html: html(`${css}input::placeholder{visibility:hidden}`, '<input aria-label="Name" placeholder="Unlock your potential">'), expected: [] },
  { name: 'placeholder replaced by a value', html: html(css, '<input aria-label="Name" value="Project details" placeholder="Unlock your potential">'), expected: [] },
  { name: 'DOM control', html: html('', '<p>Unlock your potential</p>'), expected: ['failed'] },
]));
