import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const css = '#subject{width:12px;height:12px}';
const button = (role: string) => `<div id="subject" role="${role}" tabindex="0" aria-label="Save changes">+</div>`;
test('B030: button discovery uses the first supported role', () => auditCases('b030', 'control-size', [
  { name: 'button first', html: html(css, button('button checkbox')), expected: ['failed'] },
  { name: 'unknown role first', html: html(css, button('unknown-role button')), expected: ['failed'] },
  { name: 'abstract role first', html: html(css, button('widget button')), expected: ['failed'] },
  { name: 'checkbox first', html: html(css, button('checkbox button')), expected: [] },
  { name: 'single button role', html: html(css, button('button')), expected: ['failed'] },
]));
