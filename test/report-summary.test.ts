import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeFindings } from '../src/index.js';
import { formatSummary } from '../src/report.js';
import type { Finding } from '../src/types.js';

const base: Finding = { rule: 'font-size', selector: '#save', actual: '11px', expected: '14px or 16px', message: 'Expected 14px or 16px. Found 11px.', fix: 'Use the configured size.', documentUrl: 'https://example.test/' };

test('summary groups repeated problems without losing states or measurements', () => {
  const findings = Array.from({ length: 4000 }, (_, index) => ({ ...base, state: index % 2 ? 'Menu open' : 'initial', viewport: { width: index % 2 ? 1440 : 390, height: 900 }, colorScheme: 'light' as const, actual: index % 2 ? '13px' : '11px' }));
  const summary = summarizeFindings(findings);
  assert.equal(summary.occurrences, 4000);
  assert.equal(summary.problems, 1);
  assert.equal(summary.failed, 4000);
  assert.equal(summary.unresolved, 0);
  assert.equal(summary.groups[0].occurrences.length, 4000);
  assert.deepEqual(summary.byRule, [{ rule: 'font-size', occurrences: 4000, problems: 1, failed: 4000, unresolved: 0 }]);
  const output = formatSummary(summary);
  assert.equal(output.match(/Fix:/g)?.length, 1);
  assert.match(output, /Menu open/);
  assert.match(output, /390×900/);
  assert.match(output, /1440×900/);
  assert.ok(output.length < 1000);
  assert.equal(findings[0].state, 'initial');
});

test('summary keeps documents, related elements, phases, and unresolved findings separate', () => {
  const summary = summarizeFindings([base, { ...base, status: 'unresolved' }, { ...base, phase: 'hover' }, { ...base, relatedSelector: '#cancel' }, { ...base, documentUrl: 'https://example.test/other' }, { ...base, framePath: 'main/1' }]);
  assert.equal(summary.problems, 6);
  assert.equal(summary.failed, 5);
  assert.equal(summary.unresolved, 1);
  assert.match(formatSummary(summary), /5 failed, 1 unresolved/);
  assert.match(formatSummary(summary), /unresolved/);
  assert.deepEqual(summarizeFindings([]).groups, []);
});
