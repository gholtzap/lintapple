import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const rows = '<p>Project details</p><p>Review notes</p>';
const wrapped = '<div style="display:contents"><div style="display:contents"><p>Project details</p></div></div><div style="display:contents"><p>Review notes</p></div>';
test('B016: stack spacing uses the children of boxless wrappers', () => auditCases('b016', 'layout-gap', [
  { name: 'boxless rows without spacing', html: html('', `<div data-ui-stack>${wrapped}</div>`), expected: ['failed'] },
  { name: 'direct rows without spacing', html: html('', `<div data-ui-stack>${rows}</div>`), expected: ['failed'] },
  { name: 'boxless rows with spacing', html: html('[data-ui-stack]{display:flex;flex-direction:column;gap:8px}', `<div data-ui-stack>${wrapped}</div>`), expected: [] },
  { name: 'hidden wrapper', html: html('', `<div data-ui-stack><div style="display:none">${rows}</div><p>Visible row</p></div>`), expected: [] },
]));
