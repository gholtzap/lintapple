import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';
test('B034: font-size', () => auditCases('audit2-b034', 'font-size', [
  {name:'placeholder exception',html:html('input::placeholder{font-size:17px}', '<input id="subject" aria-label="Name" placeholder="Project name">'),policy:{exceptions:[{selector:'#subject::placeholder',rules:['font-size'],reason:'Separate placeholder size.'}]},expected:[]},
  {name:'host remains checked',html:html('input{font-size:17px}input::placeholder{font-size:17px}', '<input id="subject" aria-label="Name" placeholder="Project name">'),policy:{exceptions:[{selector:'#subject::placeholder',rules:['font-size'],reason:'Separate placeholder size.'}]},expected:['failed']},
  {name:'no exception',html:html('input::placeholder{font-size:17px}', '<input aria-label="Name" placeholder="Project name">'),expected:['failed']}
]));
