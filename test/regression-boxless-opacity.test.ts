import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const input = '<input aria-label="Name" placeholder="Project details">';
const css = 'input::placeholder{color:#aaa;opacity:1}';
test('B022: boxless ancestor opacity does not hide painted controls', () => auditCases('b022', 'text-contrast', [
  { name: 'boxless zero opacity', html: html(css, `<div style="display:contents;opacity:0">${input}</div>`), expected: ['unresolved'] },
  { name: 'boxless control', html: html(css, `<div style="display:contents">${input}</div>`), expected: ['failed'] },
  { name: 'box opacity applies', html: html(css, `<div style="opacity:0">${input}</div><p>Visible content</p>`), expected: [] },
  { name: 'field opacity applies', html: html(css, `${input.replace('<input', '<input style="opacity:0"')}<p>Visible content</p>`), expected: [] },
]));
