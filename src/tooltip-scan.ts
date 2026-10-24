import type { Page } from 'playwright';
import type { InteractionPlan, InteractionReport, PageReport, Policy, TooltipCoverage, Visibility } from './types.js';
import { runInteractions } from './interactions.js';

// Only declared tooltip relationships are safe to open without an interaction plan.
export async function scanTooltips(page: Page, policy: Policy, checkPage: (page: Page, policy: Policy) => Promise<PageReport>, createVisibility: () => Visibility, explicit: Partial<InteractionPlan> = {}) {
  const visibility = await page.evaluateHandle<Visibility>(`(${createVisibility.toString()})()`);
  const discovery = await page.evaluate(({ visibility, excluded }) => {
    const tooltips: InteractionPlan['tooltips'] = [];
    const unmeasured: TooltipCoverage['unmeasured'] = [];
    const owned = new Set<Element>();
    const selector = (el: Element) => {
      if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
      const path: string[] = [];
      for (let node: Element | null = el; node; node = node.parentElement)
        path.unshift(`${node.tagName.toLowerCase()}:nth-child(${node.parentElement ? [...node.parentElement.children].indexOf(node) + 1 : 1})`);
      return path.join(' > ');
    };
    for (const trigger of document.querySelectorAll('[aria-describedby], [data-ui-tooltip], [title]')) {
      if (!visibility.visible(trigger)) continue;
      const ids = new Set(`${trigger.getAttribute('aria-describedby') ?? ''} ${trigger.getAttribute('data-ui-tooltip') ?? ''}`.split(/\s+/).filter(Boolean));
      const declared = (trigger.getAttribute('data-ui-tooltip') ?? '').split(/\s+/);
      const references = [...ids].filter(id => declared.includes(id) || document.getElementById(id)?.matches('[role="tooltip"]'));
      if (!references.length && trigger.getAttribute('title')?.trim()) unmeasured.push({ selector: selector(trigger), reason: 'Native title tooltips have no DOM box.' });
      for (const id of references) {
        const tips = document.querySelectorAll(`#${CSS.escape(id)}`);
        for (const tip of tips) owned.add(tip);
        if (excluded.some(value => trigger.matches(value))) continue;
        const item = { trigger: selector(trigger), tooltip: `#${CSS.escape(id)}` };
        const reason = tips.length > 1 ? 'The tooltip ID is not unique.' : trigger.matches(':disabled, [aria-disabled="true"]') || trigger.closest('[aria-disabled="true"]') ? 'The tooltip trigger is disabled.' : tooltips.length >= 100 ? 'The 100 tooltip limit was reached.' : null;
        if (reason) unmeasured.push({ selector: item.trigger, reason });
        else tooltips.push(item);
      }
    }
    for (const tip of document.querySelectorAll('[role="tooltip"]'))
      if (!owned.has(tip)) unmeasured.push({ selector: selector(tip), reason: 'No visible trigger has a declared relationship with this tooltip.' });
    return { tooltips, unmeasured };
  }, { visibility, excluded: (explicit.tooltips ?? []).map(item => item.trigger) }).finally(() => visibility.dispose());
  const coverage: TooltipCoverage = { checked: [], unmeasured: discovery.unmeasured };
  const report: InteractionReport = { findings: [], suppressed: [], checks: [], states: [] };
  for (const [index, item] of discovery.tooltips.entries()) {
    try {
      const result = await runInteractions(page, { tooltips: [item], ...(explicit.timeout ? { timeout: explicit.timeout } : {}), ...(explicit.maxTabStops ? { maxTabStops: explicit.maxTabStops } : {}) }, policy, checkPage, createVisibility);
      const name = (state: string) => state.replace('tooltips[0]', `automatic tooltips[${index}]`);
      report.findings.push(...result.findings.map(finding => ({ ...finding, ...(finding.state ? { state: name(finding.state) } : {}) })));
      report.suppressed.push(...result.suppressed.map(finding => ({ ...finding, ...(finding.state ? { state: name(finding.state) } : {}) })));
      report.checks.push(...result.checks);
      report.states.push(...result.states.map(state => ({ ...state, name: name(state.name) })));
      if (['hover', 'focus'].every(phase => result.checks.some(check => check.phase === phase && check.status === 'passed'))) coverage.checked.push(item);
      else coverage.unmeasured.push({ selector: item.trigger, reason: 'The tooltip did not open for both hover and keyboard focus.' });
    } catch (error) {
      if (!(error instanceof Error) || !(error.name === 'TimeoutError' || /Interaction selector must match/.test(error.message))) throw error;
      coverage.unmeasured.push({ selector: item.trigger, reason: 'The declared tooltip could not be reached or matched. Use an explicit interaction plan.' });
    }
  }
  return { ...report, coverage };
}
