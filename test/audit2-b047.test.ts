import { test } from 'node:test';
import { auditCases, html } from './audit-cases.js';
test('B047: content-clipping', () => auditCases('audit2-b047', 'content-clipping', [
  ...[0,80].map(height=>({name:`scrollport ${height}`,html:html(`#subject{height:${height}px;width:240px;overflow:auto}button{height:40px}`, '<div id="subject"><button>Save changes</button></div><p>Review notes</p>'),expected:height?[]:['failed' as const]}))
]));
