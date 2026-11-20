import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

test('B026: inline content contracts use their painted boxes', () => auditCases('b026', 'content-overflow', [
  { name: 'inline text', html: html('', '<span data-ui-content>Project details</span>'), expected: [] },
  { name: 'inline-block control', html: html('', '<span data-ui-content style="display:inline-block">Project details</span>'), expected: [] },
  { name: 'inline border and padding', html: html('', '<span data-ui-content style="border:2px solid #ddd;padding:8px">Project details</span>'), expected: [] },
  { name: 'real text overflow', html: html('', '<span data-ui-content style="display:inline-block;width:60px;white-space:nowrap">Project details</span>'), expected: ['failed'] },
]));
