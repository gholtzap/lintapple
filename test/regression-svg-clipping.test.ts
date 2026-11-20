import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const text = '<text x="0" y="20" fill="#111">Project review is complete</text>';
test('B017: SVG viewport clips apply to painted SVG text', () => auditCases('b017', 'content-clipping', [
  { name: 'clipped SVG', html: html('', `<svg width="100" height="32">${text}</svg>`), expected: ['failed'] },
  { name: 'visible overflow', html: html('svg{overflow:visible}', `<svg width="100" height="32">${text}</svg>`), expected: [] },
  { name: 'wide viewport', html: html('', `<svg width="300" height="32">${text}</svg>`), expected: [] },
  { name: 'scaled SVG fits', html: html('svg{transform:scale(2);transform-origin:top left}', '<svg width="100" height="32"><text x="0" y="20" fill="#111">Project</text></svg>'), expected: [] },
  { name: 'HTML control', html: html('', '<div style="width:100px;overflow:hidden;white-space:nowrap">Project review is complete</div>'), expected: ['failed'] },
]));
