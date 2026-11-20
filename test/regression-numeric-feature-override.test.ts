import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const number = '<p data-ui-number>1188</p>';
test('B014: low-level font features override numeric variants', () => auditCases('b014', 'tabular-numbers', [
  ...['0', 'off'].map(value => ({ name: `disabled ${value}`, html: html(`p{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" ${value}}`, number), expected: ['failed' as const] })),
  ...['1', 'on', ''].map(value => ({ name: `enabled ${value}`, html: html(`p{font-feature-settings:"tnum" ${value}}`, number), expected: [] })),
  { name: 'variant only', html: html('p{font-variant-numeric:tabular-nums}', number), expected: [] },
  { name: 'proportional', html: html('', number), expected: ['failed'] },
]));
