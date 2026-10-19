import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';

const button = '<div id="panel" data-ui-container><button>Save changes</button></div>';
const css = '#panel{width:200px;padding:8px}button{font:16px/24px system-ui;padding:0;width:100%;height:40px;border:0}';
test('B020: client bounds follow horizontal and vertical flips', () => auditCases('b020', 'control-inset', [
  { name: 'horizontal flip', html: html(`${css}#panel{border-left:20px solid #ddd;transform:scaleX(-1)}button{transform:scaleX(-1)}`, button), expected: [] },
  { name: 'vertical flip', html: html(`${css}#panel{border-top:20px solid #ddd;transform:scaleY(-1)}button{transform:scaleY(-1)}`, button), expected: [] },
  { name: 'ancestor flip', html: html(`${css}main{transform:scaleX(-1)}#panel{border-left:20px solid #ddd}button{transform:scaleX(-1)}`, `<main>${button}</main>`), expected: [] },
  { name: 'scale property', html: html(`${css}#panel{border-left:20px solid #ddd;scale:-1 1}button{scale:-1 1}`, button), expected: [] },
  { name: 'no flip', html: html(`${css}#panel{border-right:20px solid #ddd}`, button), expected: [] },
  { name: 'missing padding', html: html(`${css}#panel{padding:0;border-left:20px solid #ddd;transform:scaleX(-1)}`, button), expected: ['failed', 'failed', 'failed', 'failed'] },
]));
