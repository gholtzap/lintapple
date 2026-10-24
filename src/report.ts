import type { RuleId, Finding, FindingDetails, FindingSummary, FindingGroup, FindingCounts, Policy, FrameCoverage } from './types.js';
export function finding(rule: RuleId, selector: string, actual: string, expected: string, fix: string, details: FindingDetails = {}): Finding {
  return { rule, selector, message: `Expected ${expected}. Found ${actual}.`, actual, expected, fix, ...details };
}

export function summarizeFindings(findings: readonly (Finding & { viewport?: Policy['viewports'][number]; colorScheme?: 'light' | 'dark' })[]): FindingSummary {
  const groups = new Map<string, FindingGroup>();
  const byRule = new Map<RuleId, FindingCounts & { rule: RuleId }>();
  let unresolved = 0;
  for (const item of findings) {
    const status = item.status === 'unresolved' ? 'unresolved' : 'failed';
    const key = JSON.stringify([item.rule, item.selector, item.relatedSelector, item.expected, item.fix, status, item.phase, item.sourceRule, item.documentUrl, item.framePath, item.category, item.focusSelector, item.outcomeSelector]);
    let counts = byRule.get(item.rule);
    if (!counts) { counts = { rule: item.rule, occurrences: 0, problems: 0, failed: 0, unresolved: 0 }; byRule.set(item.rule, counts); }
    counts.occurrences++; counts[status]++;
    if (status === 'unresolved') unresolved++;
    let group = groups.get(key);
    if (!group) {
      const { viewport: _viewport, colorScheme: _scheme, state: _state, ...finding } = item;
      group = { finding, occurrences: [] };
      groups.set(key, group); counts.problems++;
    }
    group.occurrences.push({ actual: item.actual, ...(item.state ? { state: item.state } : {}), ...(item.viewport ? { viewport: item.viewport } : {}), ...(item.colorScheme ? { colorScheme: item.colorScheme } : {}) });
  }
  return { occurrences: findings.length, problems: groups.size, failed: findings.length - unresolved, unresolved, byRule: [...byRule.values()], groups: [...groups.values()] };
}

export function formatSummary(summary: FindingSummary): string {
  const unique = (values: (string | undefined)[]) => [...new Set(values.filter((value): value is string => value !== undefined))].join(', ');
  return [
    `${summary.problems} distinct problems, ${summary.occurrences} occurrences: ${summary.failed} failed, ${summary.unresolved} unresolved.`,
    ...summary.byRule.map(count => `${count.rule}: ${count.problems} problems, ${count.failed} failed, ${count.unresolved} unresolved.`),
    ...summary.groups.map(({ finding: f, occurrences }) => {
      const states = unique(occurrences.map(item => item.state));
      const screens = unique(occurrences.map(item => item.viewport ? `${item.viewport.width}×${item.viewport.height}` : undefined));
      const schemes = unique(occurrences.map(item => item.colorScheme));
      return `\n${f.rule} (${f.status === 'unresolved' ? 'unresolved' : 'failed'}; ${occurrences.length} occurrences)\n${f.documentUrl ? `${f.documentUrl}\n` : ''}${f.framePath ? `Frame: ${f.framePath}\n` : ''}${f.selector}${f.relatedSelector ? `; related: ${f.relatedSelector}` : ''}${f.phase ? `\nPhase: ${f.phase}` : ''}\n${occurrences.length > 1 ? 'Example: ' : ''}${f.message}\n${[states && `States: ${states}`, screens && `Screens: ${screens}`, schemes && `Themes: ${schemes}`].filter(Boolean).join('\n')}\nFix: ${f.fix}`;
    }),
  ].join('\n');
}

export function formatFrameCoverage(coverages: readonly FrameCoverage[]): string {
  const lines = new Set<string>();
  for (const coverage of coverages) {
    lines.add(`Checked document: ${coverage.checked.url} (frame: ${coverage.checked.path}; name: ${JSON.stringify(coverage.checked.name)}).`);
    for (const frame of coverage.omitted) lines.add(`Omitted child frame: ${frame.url} (frame: ${frame.path}; name: ${JSON.stringify(frame.name)}; checked document: ${coverage.checked.url}).`);
  }
  return ['Frame coverage: only the listed documents were checked. Child frames need separate checkPage calls.', ...lines].join('\n');
}

export function formatControlContentCoverage(coverages: readonly import('./types.js').PageReport['controlContentCoverage'][]): string {
  const lines = new Set(coverages.flatMap(coverage => coverage.unmeasured.map(item => `${item.selector}: ${item.reason}`)));
  return [`Control content: ${coverages.reduce((sum, coverage) => sum + coverage.checked, 0)} control checks with measurable content.`, ...(lines.size ? ['Unmeasured control content:', ...lines] : [])].join('\n');
}

export function formatTooltipCoverage(coverages: readonly (import('./types.js').TooltipCoverage | undefined)[]): string {
  const checked = coverages.reduce((count, coverage) => count + (coverage?.checked.length ?? 0), 0);
  const unmeasured = new Set(coverages.flatMap(coverage => (coverage?.unmeasured ?? []).map(item => `${item.selector}: ${item.reason}`)));
  return [`Tooltip states: ${checked} declared trigger checks completed.`, ...(unmeasured.size ? ['Unmeasured tooltip states:', ...unmeasured] : [])].join('\n');
}
