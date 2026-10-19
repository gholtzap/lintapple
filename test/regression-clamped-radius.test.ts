import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const surfaces = '<div id="outer" data-ui-radius><div id="inner" data-ui-radius-inner></div></div>';
const css = '#outer{box-sizing:border-box;width:50px;height:50px;padding:8px;background:#ddd}#inner{width:100%;height:100%;background:#111}';
test('B027: radius contracts use radii after CSS size reduction', () => auditCases('b027', 'nested-radius', [
  { name: 'clamped circles', html: html(`${css}#outer,#inner{border-radius:100px}`, surfaces), expected: [] },
  { name: 'explicit circles', html: html(`${css}#outer{border-radius:25px}#inner{border-radius:17px}`, surfaces), expected: [] },
  { name: 'wrong inner radius', html: html(`${css}#outer{border-radius:100px}#inner{border-radius:4px}`, surfaces), expected: ['failed'] },
  { name: 'scaled circles', html: html(`${css}#outer,#inner{border-radius:100px}#outer{transform:scale(.5);transform-origin:top left}`, surfaces), expected: [] },
]));
