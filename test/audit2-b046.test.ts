import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';
test('B046: text-contrast', () => auditCases('audit2-b046', 'text-contrast', [
  {name:'glyph background',html:html('', '<svg width="240" height="80"><text x="0" y="64" style="font:64px system-ui" fill="#111" aria-hidden="true">████</text><text x="8" y="40" style="font:16px system-ui" fill="white">Review</text></svg>'),expected:[]},
  {name:'rectangle background',html:html('', '<svg width="240" height="80"><rect width="240" height="80" fill="#111"/><text x="8" y="40" style="font:16px system-ui" fill="white">Review</text></svg>'),expected:[]},
  {name:'separate chart labels',html:html('', '<svg width="240" height="80"><text x="8" y="20" style="font:16px system-ui" fill="#111">Project</text><text x="8" y="60" style="font:16px system-ui" fill="#111">Review</text></svg>'),expected:[]},
  {name:'low contrast',html:html('', '<svg width="240" height="80"><rect width="240" height="80" fill="white"/><text x="8" y="40" style="font:16px system-ui" fill="white">Review</text></svg>'),expected:['failed']}
]));
