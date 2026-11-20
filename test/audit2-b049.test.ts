import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';
test('B049: control-size', () => auditCases('audit2-b049', 'control-size', [
  ...[true,false].map(clipped=>({name:clipped?'clipped':'full area',html:html(`#clip{width:${clipped?40:80}px;height:${clipped?40:80}px;overflow:hidden}button{width:80px;height:80px;border:0;padding:0;display:block}`, '<div id="clip"><button aria-label="Save" aria-describedby="tip"></button></div><span id="tip" role="tooltip" hidden>Save</span>'),policy:{minControlSize:44},expected:clipped?['failed' as const]:[]}))
]));
