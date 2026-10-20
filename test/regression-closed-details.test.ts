import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const body = '<p style="font-size:17px">Hidden content</p>';
test('B023: closed details paint only their first summary', () => auditCases('b023', 'font-size', [
  { name: 'closed body', html: html('', `<details><summary>Project details</summary>${body}</details>`), expected: [] },
  { name: 'open body', html: html('', `<details open><summary>Project details</summary>${body}</details>`), expected: ['failed'] },
  { name: 'visible summary', html: html('', '<details><summary><span style="font-size:17px">Project details</span></summary></details>'), expected: ['failed'] },
  { name: 'second summary is hidden', html: html('', '<details><summary>Project details</summary><summary style="font-size:17px">Hidden summary</summary></details>'), expected: [] },
  { name: 'nested details stay hidden', html: html('', `<details><summary>Project details</summary><details open><summary style="font-size:17px">Hidden summary</summary>${body}</details></details>`), expected: [] },
]));
