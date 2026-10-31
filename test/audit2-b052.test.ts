import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';
test('B052: dialog-focus', () => auditCases('audit2-b052', 'dialog-focus', [
  ...[false,true].map(reverse=>({name:reverse?'reverse show order':'normal show order',html:html('dialog{width:240px;height:100px}', `<dialog id="one" aria-label="First"><button>First action</button></dialog><dialog id="two" aria-label="Second"><button>Second action</button></dialog><script>${reverse?'two.showModal();one.showModal()':'one.showModal();two.showModal()'}</script>`),expected:[]})),
  {name:'focus outside active modal',html:html('', '<dialog id="one" aria-label="First"><button>First action</button></dialog><script>one.showModal();document.activeElement.blur()</script>'),expected:['failed']}
]));
