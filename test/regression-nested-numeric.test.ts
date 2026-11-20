import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const table = (content: string) => `<table><tbody><tr><td>${content}</td></tr></tbody></table>`;
const css = 'td{text-align:right;font-variant-numeric:tabular-nums}';
test('B031: numeric checks use the styles that paint the digits', () => auditCases('b031', 'tabular-numbers', [
  { name: 'proportional child', html: html(`${css}span{font-variant-numeric:normal}`, table('<span>1188</span>')), expected: ['failed'] },
  { name: 'nested proportional child', html: html(`${css}strong{font-variant-numeric:normal}`, table('<span><strong>1188</strong></span>')), expected: ['failed'] },
  { name: 'generated digits', html: html('[data-ui-number]{font-variant-numeric:tabular-nums}span::before{content:"1188";font-variant-numeric:normal}', '<p data-ui-number><span></span></p>'), expected: ['failed'] },
  { name: 'inherited digits', html: html(css, table('<span>1188</span>')), expected: [] },
  { name: 'hidden proportional child', html: html(`${css}span{font-variant-numeric:normal}`, table('1188<span hidden>123</span>')), expected: [] },
  { name: 'marked value', html: html('[data-ui-number]{font-variant-numeric:tabular-nums}span{font-feature-settings:"tnum" off}', '<p data-ui-number><span>1188</span></p>'), expected: ['failed'] },
]));
