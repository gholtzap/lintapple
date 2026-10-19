import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

test('B013: quoted font families can contain commas and escaped quotes', () => auditCases('b013', 'font-family', [
  { name: 'approved comma', html: html('p{font-family:"Audit, Sans",system-ui}', '<p>Project details</p>'), policy: { fonts: ['system-ui', 'Audit, Sans'] }, expected: [] },
  { name: 'unapproved comma', html: html('p{font-family:"Other, Sans",system-ui}', '<p>Project details</p>'), expected: ['failed'] },
  { name: 'escaped quote', html: html('p{font-family:"Audit\\" Sans",system-ui}', '<p>Project details</p>'), policy: { fonts: ['system-ui', 'Audit" Sans'] }, expected: [] },
  { name: 'unquoted family', html: html('', '<p>Project details</p>'), expected: [] },
]));
