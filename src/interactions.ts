import type { Page, Locator } from 'playwright';
import type { InteractionPlan, Policy, PageReport, InteractionReport, Finding, SuppressedFinding, InteractionCheck, StateReport, Status, RecordCheck, Wait, Visibility } from './types.js';
import { finding } from './report.js';
import { validateWidgets, runWidgets } from './widgets.js';

export function validateInteractions(input: unknown): InteractionPlan {
  const plan = input as Partial<InteractionPlan>;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Interaction plan must be an object.');
  const fields = ['focus', 'buttons', 'tooltips', 'dialogs', 'tabs', 'menus', 'states', 'timeout', 'maxTabStops'];
  for (const key of Object.keys(plan)) if (!fields.includes(key)) throw new Error(`Unknown interaction field: ${key}`);
  const result = { focus: [], buttons: [], tooltips: [], dialogs: [], tabs: [], menus: [], states: [], timeout: 1500, maxTabStops: 100, ...plan };
  for (const [key, max] of [['timeout', 10000], ['maxTabStops', 500]] as const) if (!Number.isInteger(result[key]) || result[key] < 1 || result[key] > max) throw new Error(`${key} must be an integer from 1 to ${max}.`);
  for (const kind of ['focus', 'buttons', 'tooltips', 'dialogs'] as const) {
    if (!Array.isArray(result[kind]) || result[kind].length > 100) throw new Error(`${kind} must be a list of at most 100 interaction checks.`);
    for (const candidate of result[kind]) {
      const item = candidate as { [key: string]: unknown; key?: string; returnFocus?: string };
      const keys = { focus: ['selector'], buttons: ['selector', 'key', 'outcome', 'expectedText'], tooltips: ['trigger', 'tooltip'], dialogs: ['open', 'dialog', 'close', 'returnFocus'] }[kind];
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !keys.includes(key))) throw new Error(`Invalid ${kind} interaction.`);
      for (const key of keys.filter(key => key !== 'returnFocus')) if (typeof item[key] !== 'string' || !item[key].trim()) throw new Error(`${kind} interaction needs ${key}.`);
      if (kind === 'buttons' && !['Enter', 'Space'].includes(item.key ?? '')) throw new Error('Button key must be Enter or Space.');
      if (item.returnFocus !== undefined && (typeof item.returnFocus !== 'string' || !item.returnFocus.trim())) throw new Error('returnFocus must be a selector.');
    }
  }
  validateWidgets(result);
  if (!Array.isArray(result.states) || result.states.length > 100) throw new Error('states must be a list of at most 100 named page checks.');
  const names = new Set(['initial']);
  for (const item of result.states) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !['click', 'fill', 'press', 'hover'].includes(item.action)) throw new Error('Each named state needs a supported action.');
    const keys = ['name', 'action', 'selector', 'ready', ...(item.action === 'fill' ? ['value'] : item.action === 'press' ? ['key'] : [])];
    if (Object.keys(item).some(key => !keys.includes(key))) throw new Error('Unknown named state field.');
    for (const key of ['name', 'selector'] as const) if (typeof item[key] !== 'string' || !item[key].trim()) throw new Error(`Named state needs ${key}.`);
    if (item.name.length > 100 || names.has(item.name) || /^(focus|buttons|tooltips|dialogs|tabs|menus)\[\d+\]:/.test(item.name)) throw new Error('State names must be unique, at most 100 characters, and cannot use initial or a generated interaction name.');
    names.add(item.name);
    if (item.action === 'fill' && typeof item.value !== 'string') throw new Error('Fill action needs a string value.');
    if (item.action === 'press' && (typeof item.key !== 'string' || !item.key.trim())) throw new Error('Press action needs a key.');
    const ready = item.ready;
    if (!ready || typeof ready !== 'object' || Array.isArray(ready) || Object.keys(ready).some(key => !['selector', 'state', 'expectedText'].includes(key)) || typeof ready.selector !== 'string' || !ready.selector.trim()) throw new Error('Named state needs a ready selector.');
    if (ready.state !== undefined && !['visible', 'hidden'].includes(ready.state)) throw new Error('Ready state must be visible or hidden.');
    if (ready.expectedText !== undefined && (typeof ready.expectedText !== 'string' || ready.state === 'hidden')) throw new Error('expectedText needs a visible ready element and a string.');
  }
  return result;
}

export async function runInteractions(page: Page, input: Partial<InteractionPlan>, policy: Policy, checkPage: (page: Page, policy: Policy) => Promise<PageReport>, createVisibility: () => Visibility): Promise<InteractionReport> {
  const plan = validateInteractions(input);
  const findings: Finding[] = [], suppressed: SuppressedFinding[] = [], checks: InteractionCheck[] = [], states: StateReport[] = [];
  const selectors = plan.focus.map(x => x.selector).concat(plan.buttons.flatMap(x => [x.selector, x.outcome]), plan.tooltips.flatMap(x => [x.trigger, x.tooltip]), plan.dialogs.flatMap(x => [x.open, x.dialog, x.close, x.returnFocus].filter((value): value is string => !!value)));
  await page.evaluate(selectors => selectors.forEach(selector => document.querySelector(selector)), selectors);
  const target = async (selector: string) => {
    const locator = page.locator(selector);
    if (await locator.count() !== 1) throw new Error(`Interaction selector must match one element: ${selector}`);
    if (!await locator.evaluate(el => el.getRootNode() === document)) throw new Error(`Interaction selector must name an element in the main document: ${selector}`);
    return locator;
  };
  const record: RecordCheck = async (rule, selector, passed, actual, expected, fix, details = {}) => {
    const status = details.status || (passed ? 'passed' : 'failed');
    checks.push({ rule, selector, status, ...details });
    if (passed) return;
    const locator = page.locator(selector);
    const exception = await locator.count() === 1 ? await locator.evaluate((el, { exceptions, rule }) => exceptions.find(e => e.rules.includes(rule) && el.matches(e.selector)), { exceptions: policy.exceptions, rule }) : null;
    if (exception) { suppressed.push({ rule, selector, reason: exception.reason }); return; }
    findings.push(finding(rule, selector, actual ?? '', expected, fix, { documentUrl: page.url(), framePath: 'main', category: rule === 'icon-button-tooltip' ? 'design' : 'accessibility', ...details, status }));
  };
  const wait: Wait = async (fn, argument) => {
    try { await page.waitForFunction(fn, argument, { timeout: plan.timeout }); return true; }
    catch (error) { if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error; return false; }
  };
  const contentState = async (selector: string, expected: boolean, expectedText?: string) => {
    // Earlier actions can navigate to a new document.
    const visibility = await page.evaluateHandle<Visibility>(`(${createVisibility.toString()})()`);
    try { return await wait(({ selector, expected, expectedText, visibility }) => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 1) throw new Error(`Interaction selector must match at most one element: ${selector}`);
      return visibility.hasVisibleContent(elements[0]) === expected && (expectedText === undefined || elements[0]?.textContent?.trim() === expectedText);
    }, { selector, expected, expectedText, visibility }); }
    finally { await visibility.dispose(); }
  };
  const shown = (selector: string) => contentState(selector, true);
  const hidden = (selector: string) => contentState(selector, false);
  const focused = (locator: Locator) => locator.evaluate(el => el === document.activeElement);
  const inspect = async (name: string) => {
    let result: PageReport;
    try { result = await checkPage(page, policy); }
    catch (error) { throw new Error(`State "${name}" could not be checked: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    states.push({ name, url: page.url(), ...result });
    findings.push(...result.findings.map(item => ({ ...item, state: name })));
    suppressed.push(...result.suppressed.map(item => ({ ...item, state: name })));
  };
  const reach = async (locator: Locator) => {
    for (let step = 0; step < plan.maxTabStops; step++) {
      await page.keyboard.press('Tab');
      if (await focused(locator)) return true;
    }
    return false;
  };
  const signature = (locator: Locator) => locator.evaluate(el => {
    const properties = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'borderColor', 'borderWidth', 'backgroundColor', 'color', 'textDecorationLine'] as const;
    return [null, '::before', '::after'].map(pseudo => Object.fromEntries(properties.map(key => [key, getComputedStyle(el, pseudo)[key]])));
  });
  for (const [index, item] of plan.focus.entries()) {
    const locator = await target(item.selector);
    await locator.evaluate(el => (el as HTMLElement).blur());
    const before = await signature(locator);
    const reachable = await reach(locator);
    await record('keyboard-operation', item.selector, reachable, 'not reached by Tab within the configured limit', 'the planned control to receive keyboard focus', 'Review the tab order, configured limit, and keyboard navigation.', { phase: 'tab-reachability', ...(reachable ? {} : { status: 'unresolved' }) });
    if (!reachable) { await inspect(`focus[${index}]: unreachable`); continue; }
    const after = await signature(locator);
    const indicator = after.some((style, index) => {
      const prior = before[index];
      return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && JSON.stringify(style) !== JSON.stringify(prior)) || (style.boxShadow !== 'none' && style.boxShadow !== prior.boxShadow) || ['borderColor', 'borderWidth', 'backgroundColor', 'color', 'textDecorationLine'].some(key => style[key] !== prior[key]);
    });
    await record('focus-visible', item.selector, indicator, 'no focus indicator detected in the computed styles', 'a visible keyboard focus indicator', 'Add a clear :focus-visible style. Review custom indicators that the checker cannot measure.', { ...(indicator ? {} : { status: 'unresolved' }), phase: 'keyboard-focus' });
    const exposure = await locator.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      if (left >= right || top >= bottom) return { status: 'failed' as const, actual: 'focused control is outside the viewport' };
      const points = [[left + 1, top + 1], [right - 1, top + 1], [left + 1, bottom - 1], [right - 1, bottom - 1], [(left + right) / 2, (top + bottom) / 2]];
      // Hit testing omits painted layers with pointer-events:none.
      const overrides = [...document.querySelectorAll<HTMLElement | SVGElement>('*')].filter(node => node.style && getComputedStyle(node).pointerEvents === 'none').map(node => ({ node, style: node.getAttribute('style') }));
      try {
        for (const { node } of overrides) node.style.setProperty('pointer-events', 'auto', 'important');
        const covers: Element[] = [];
        for (const [x, y] of points) {
          let uncertain = false;
          for (const node of document.elementsFromPoint(x, y)) {
            let hidden = false, effects = false;
            for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
              const style = getComputedStyle(ancestor);
              hidden ||= parseFloat(style.opacity) === 0;
              effects ||= parseFloat(style.opacity) !== 1 || style.filter !== 'none' || style.backdropFilter !== 'none' || style.mixBlendMode !== 'normal' || style.clipPath !== 'none' || style.maskImage !== 'none' || style.transform !== 'none';
            }
            if (hidden) continue;
            if (node === el || el.contains(node)) {
              if (!uncertain) return { status: 'passed' as const };
              break;
            }
            const style = getComputedStyle(node);
            const pseudo = ['::before', '::after'].some(pseudo => !['none', 'normal', '""'].includes(getComputedStyle(node, pseudo).content));
            if (node.contains(el)) { uncertain ||= pseudo; continue; }
            if (!effects && /^rgb\(/.test(style.backgroundColor) && style.borderRadius === '0px') {
              covers.push(node);
              break;
            }
            const clear = ['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor) && style.backgroundImage === 'none' && style.boxShadow === 'none' && style.outlineStyle === 'none' && ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].every(key => style[key as keyof CSSStyleDeclaration] === '0px') && !pseudo && ![...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) && !node.matches('img,svg,canvas,video,iframe,input,textarea,select');
            uncertain ||= effects || !clear;
          }
        }
        const cover = covers[0];
        if (covers.length === points.length && covers.every(node => node === cover)) {
          const box = cover.getBoundingClientRect();
          if (box.left <= rect.left && box.top <= rect.top && box.right >= rect.right && box.bottom >= rect.bottom) return { status: 'failed' as const, actual: 'an opaque element covers the focused control' };
        }
        return { status: 'unresolved' as const, actual: 'painted focus coverage needs review' };
      } finally {
        // This measurement is synchronous, so no user action runs during the overrides.
        for (const { node, style } of overrides) {
          if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
        }
      }
    });
    await record('focus-obscured', item.selector, exposure.status === 'passed', exposure.actual, 'the focused control to remain visible', 'Keep focused controls in view and clear of sticky bars and overlays.', { status: exposure.status, phase: 'keyboard-focus' });
    await inspect(`focus[${index}]: keyboard focus`);
  }
  for (const [index, item] of plan.tooltips.entries()) {
    const trigger = await target(item.trigger);
    await target(item.tooltip);
    const linked = await trigger.evaluate((el, selector) => {
      const tip = document.querySelector(selector);
      const ids = `${el.getAttribute('aria-describedby') || ''} ${el.getAttribute('data-ui-tooltip') || ''}`.split(/\s+/);
      return tip!.getAttribute('role') === 'tooltip' && tip!.textContent?.trim() && tip!.id && ids.includes(tip!.id);
    }, item.tooltip);
    await record('icon-button-tooltip', item.trigger, !!linked, 'tooltip has no text, role, or trigger reference', 'a linked role="tooltip" element with text', 'Connect the text tooltip to its trigger.', { phase: 'tooltip-link' });
    await page.mouse.move(0, 0);
    await trigger.evaluate(el => (el as HTMLElement).blur());
    if (!await hidden(item.tooltip)) {
      await record('icon-button-tooltip', item.trigger, false, 'tooltip is already visible before hover or focus', 'a tooltip that opens for its trigger', 'Use the tooltip open state or use a visible text label.', { phase: 'tooltip-baseline' });
      continue;
    }
    await trigger.hover({ timeout: plan.timeout });
    await record('icon-button-tooltip', item.trigger, await shown(item.tooltip), 'tooltip did not appear on hover', 'a text tooltip on hover', 'Show the tooltip on pointer hover.', { phase: 'hover' });
    await inspect(`tooltips[${index}]: hover`);
    await page.mouse.move(0, 0);
    const reset = await hidden(item.tooltip);
    const reachable = await reach(trigger);
    await record('keyboard-operation', item.trigger, reachable, 'tooltip trigger was not reached within the configured Tab limit', 'a keyboard-reachable tooltip trigger', 'Review the tab order, configured limit, and keyboard navigation.', { phase: 'tooltip-tab', ...(reachable ? {} : { status: 'unresolved' }) });
    const focusShown = reset && reachable && await shown(item.tooltip);
    await record('icon-button-tooltip', item.trigger, focusShown, reset ? 'tooltip did not appear on keyboard focus' : 'hover tooltip did not reset before the focus check', 'a text tooltip on keyboard focus', 'Show the tooltip for keyboard focus and clear its hover state.', { phase: 'focus', ...(!reset || !reachable ? { status: 'unresolved' } : {}) });
    await inspect(`tooltips[${index}]: keyboard focus`);
    if (focusShown) {
      await page.keyboard.press('Escape');
      await record('icon-button-tooltip', item.trigger, await hidden(item.tooltip), 'tooltip remained visible after Escape', 'Escape to dismiss the tooltip', 'Close the tooltip on Escape without moving focus.', { phase: 'escape' });
      await record('keyboard-operation', item.trigger, await focused(trigger), 'Escape moved focus away from the tooltip trigger', 'focus to stay on the tooltip trigger', 'Dismiss the tooltip without moving focus.', { phase: 'tooltip-escape-focus' });
      await inspect(`tooltips[${index}]: Escape`);
    }
    await trigger.evaluate(el => (el as HTMLElement).blur());
  }
  for (const [index, item] of plan.buttons.entries()) {
    const button = await target(item.selector);
    const reached = await reach(button);
    await record('keyboard-operation', item.selector, reached, 'button was not reached within the configured Tab limit', 'a keyboard-reachable button', 'Review the tab order, configured limit, and keyboard navigation.', { phase: item.key, ...(reached ? {} : { status: 'unresolved' }) });
    if (!reached) continue;
    const matches = ({ selector, text }: { selector: string; text: string }) => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 1) throw new Error(`Button outcome must match one element: ${selector}`);
      return elements[0]?.textContent?.trim() === text;
    };
    const witness = { selector: item.outcome, text: item.expectedText };
    if (await page.evaluate(matches, witness)) throw new Error(`Button outcome already matches before activation: ${item.outcome}`);
    await page.keyboard.press(item.key);
    const activated = await wait(matches, witness);
    await record('keyboard-operation', item.selector, activated, `${item.key} did not produce the declared result`, `${item.key} to produce text "${item.expectedText}" at ${item.outcome}`, 'Handle the keyboard action or use a native button.', { phase: item.key, outcomeSelector: item.outcome });
    await inspect(`buttons[${index}]: ${item.key}`);
  }
  for (const [index, item] of plan.dialogs.entries()) {
    const opener = await target(item.open);
    const returnSelector = item.returnFocus || item.open;
    for (const closeMethod of ['button', 'Escape']) {
      await opener.click({ timeout: plan.timeout });
      if (!await shown(item.dialog)) {
        await record('dialog-focus', item.dialog, false, 'dialog did not open', 'the planned dialog to open', 'Correct the open action or interaction selectors.', { phase: 'open' });
        break;
      }
      const inside = (selector: string) => document.querySelector(selector)?.contains(document.activeElement);
      await record('dialog-focus', item.dialog, await wait(inside, item.dialog), 'focus stayed outside the open dialog', 'focus to enter the dialog', 'Move focus into the dialog when it opens.', { phase: 'entry' });
      await inspect(`dialogs[${index}]: open for ${closeMethod}`);
      for (const key of ['Tab', 'Shift+Tab']) {
        const seen = new Set<number>();
        let status: Status = 'unresolved';
        for (let step = 0; step < plan.maxTabStops; step++) {
          await page.keyboard.press(key);
          if (!await page.evaluate(inside, item.dialog)) {
            const browserFocus = await page.evaluate(() => !document.hasFocus() && document.activeElement === document.body);
            if (browserFocus) continue;
            status = 'failed'; break;
          }
          const position = await page.evaluate(() => [...document.querySelectorAll('*')].indexOf(document.activeElement!));
          if (seen.has(position)) { status = 'passed'; break; }
          seen.add(position);
        }
        await record('dialog-focus', item.dialog, status === 'passed', status === 'failed' ? `${key} moved focus outside the modal` : 'focus cycle exceeded the configured limit', 'keyboard focus to stay inside the modal', 'Contain Tab and Shift+Tab inside the modal.', { status, phase: key });
      }
      if (closeMethod === 'Escape') await page.keyboard.press('Escape');
      else await (await target(item.close)).click({ timeout: plan.timeout });
      const closed = await hidden(item.dialog);
      await record('dialog-focus', item.dialog, closed, `${closeMethod} did not close the modal`, 'the close action to close the modal', 'Connect the close action and handle Escape.', { phase: `close-${closeMethod}` });
      if (!closed) { await inspect(`dialogs[${index}]: close with ${closeMethod}`); break; }
      const returned = await wait((selector: string) => document.querySelector(selector) === document.activeElement, returnSelector);
      await record('dialog-focus', returnSelector, returned, 'focus did not return to the planned control', 'focus to return to the opener or declared workflow target', 'Restore focus when the modal closes.', { phase: `return-${closeMethod}` });
      await inspect(`dialogs[${index}]: close with ${closeMethod}`);
    }
  }
  await runWidgets(page, plan, { target, record, wait, reach, shown, hidden, inspect, createVisibility });
  for (const item of plan.states) {
    try {
      await page.evaluate(({ selector, ready }) => { document.querySelector(selector); document.querySelector(ready.selector); }, item);
      const locator = await target(item.selector);
      if (item.action === 'fill') await locator.fill(item.value, { timeout: plan.timeout });
      else if (item.action === 'press') await locator.press(item.key, { timeout: plan.timeout });
      else await locator[item.action]({ timeout: plan.timeout });
      const ready = page.locator(item.ready.selector);
      if (await ready.count() > 1) throw new Error(`Ready selector must match at most one element: ${item.ready.selector}`);
      if (!await contentState(item.ready.selector, item.ready.state !== 'hidden', item.ready.expectedText))
        throw new Error(item.ready.expectedText === undefined ? 'Timeout waiting for the ready element.' : 'Ready text did not match.');
      if (await ready.count() > 1) throw new Error(`Ready selector must match at most one element: ${item.ready.selector}`);
      if (await ready.count() === 1) await target(item.ready.selector);
    } catch (error) { throw new Error(`State "${item.name}" could not be checked: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    await inspect(item.name);
  }
  return { findings, suppressed, checks, states };
}
