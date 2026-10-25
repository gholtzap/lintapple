import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';
test('B048: form-label', () => auditCases('audit2-b048', 'form-label', [
  {name:'native element reference',html:html('', '<span id="label">Project name</span><input id="subject"><script>subject.ariaLabelledByElements=[label]</script>'),expected:[]},
  {name:'attribute reference',html:html('', '<span id="label">Project name</span><input aria-labelledby="label">'),expected:[]},
  {name:'missing label',html:html('', '<input>'),expected:['failed']}
]));
