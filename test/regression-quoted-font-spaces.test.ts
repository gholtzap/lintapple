import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

test('quoted family names retain their spaces', () => auditCases('b033', 'font-family', [
  { name: 'quoted spaces', html: html('p{font-family:" Audit Sans ",system-ui}', '<p>Project details</p>'), policy: { fonts: ['system-ui', ' Audit Sans '] }, expected: [] },
  { name: 'quoted comma and spaces', html: html('p{font-family:" Audit, Sans ",system-ui}', '<p>Project details</p>'), policy: { fonts: ['system-ui', ' Audit, Sans '] }, expected: [] },
  { name: 'spaces distinguish an unapproved name', html: html('p{font-family:" Audit Sans ",system-ui}', '<p>Project details</p>'), policy: { fonts: ['system-ui', 'Audit Sans'] }, expected: ['failed'] },
  { name: 'unquoted spacing', html: html('p{font-family: system-ui ,serif}', '<p>Project details</p>'), expected: [] },
]));
