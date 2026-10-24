import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';
test('B033: aria-reference', () => auditCases('audit2-b033', 'aria-reference', [
  {name:'inactive error',html:html('', '<input aria-label="Name" aria-invalid="false" aria-errormessage="error">'),expected:[]},
  {name:'default valid state',html:html('', '<input aria-label="Name" aria-errormessage="error">'),expected:[]},
  {name:'active missing error',html:html('', '<input aria-label="Name" aria-invalid="true" aria-errormessage="error">'),expected:['failed']},
  {name:'active error exists',html:html('', '<input aria-label="Name" aria-invalid="true" aria-errormessage="error"><p id="error">Enter a name.</p>'),expected:[]}
]));
