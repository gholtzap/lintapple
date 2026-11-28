import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

test('placeholder masks stay unresolved behind an opaque field', () => auditCases('placeholder-ancestor-mask', 'text-contrast', [
  ...['header', '.field', 'input'].map(selector => ({
    name: `${selector} applies a translucent mask`,
    html: html(`header{backdrop-filter:blur(16px);padding:20px}.field{background:#eeefec;padding:20px}input{background:white;border:0;padding:8px}input::placeholder{color:#646c61;opacity:1}${selector}{mask-image:linear-gradient(#0008,#0008)}`, '<header><div class="field"><input aria-label="Search" placeholder="Search workspace"></div></header>'),
    expected: ['unresolved' as const],
  })),
]));
