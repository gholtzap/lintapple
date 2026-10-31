import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';
test('B045: text-contrast', () => auditCases('audit2-b045', 'text-contrast', [
  {name:'scaled down',html:html('', '<svg width="240" height="32" viewBox="0 0 480 64"><text x="0" y="40" style="font:32px system-ui" fill="#888">Project details</text></svg>'),expected:['failed']},
  {name:'plain small',html:html('', '<svg width="240" height="32"><text x="0" y="20" style="font:16px system-ui" fill="#888">Project details</text></svg>'),expected:['failed']},
  {name:'scaled up',html:html('', '<svg width="240" height="64" viewBox="0 0 120 32"><text x="0" y="20" style="font:12px system-ui" fill="#888">Project</text></svg>'),expected:[]},
  {name:'plain large',html:html('', '<svg width="240" height="64"><text x="0" y="40" style="font:24px system-ui" fill="#888">Project</text></svg>'),expected:[]}
]));
