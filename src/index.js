import { readFile } from 'node:fs/promises';
import { launchBrowser } from './browser.js';
import axe from 'axe-core';
import { audit } from './audit.js';
import { auditAccessibility } from './accessibility.js';
import { finding } from './report.js';
import { runInteractions, validateInteractions } from './interactions.js';
import { createVisibility } from './visibility.js';

export const ruleIds = ['font-family', 'font-size', 'copy', 'control-size', 'control-gap', 'control-inset', 'layout-gap', 'layout-alignment', 'tabular-numbers', 'numeric-alignment', 'nested-radius', 'root-background', 'horizontal-overflow', 'viewport-bounds', 'content-clipping', 'content-overflow', 'text-contrast', 'font-loading', 'accessible-name', 'form-label', 'aria-reference', 'label-consistency', 'control-state', 'keyboard-operation', 'focus-visible', 'focus-obscured', 'dialog-focus', 'icon-button-tooltip', 'target-size'];
export const defaultPolicy = JSON.parse(await readFile(new URL('../ui-policy.json', import.meta.url), 'utf8'));

export function validatePolicy(input = {}) {
  const policy = { ...structuredClone(defaultPolicy), ...input };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Policy must be an object.');
  for (const key of Object.keys(input)) if (!(key in defaultPolicy)) throw new Error(`Unknown policy field: ${key}`);
  const strings = (value, name, nonempty = true) => {
    if (!Array.isArray(value) || (nonempty && !value.length) || value.some(v => typeof v !== 'string' || !v.trim())) throw new Error(`${name} must be a list of nonempty strings.`);
  };
  const positive = (value, name) => { if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`); };
  strings(policy.fonts, 'fonts'); strings(policy.bannedCopy, 'bannedCopy', false);
  if (!Array.isArray(policy.fontSizes) || !policy.fontSizes.length) throw new Error('fontSizes must be a nonempty list.');
  policy.fontSizes.forEach(n => positive(n, 'fontSizes'));
  if (!Array.isArray(policy.typeRules)) throw new Error('typeRules must be a list.');
  for (const rule of policy.typeRules) {
    if (!rule || Object.keys(rule).some(k => !['selector', 'sizes'].includes(k)) || typeof rule.selector !== 'string' || !rule.selector.trim() || !Array.isArray(rule.sizes) || !rule.sizes.length) throw new Error('Each type rule needs a selector and a nonempty size list.');
    rule.sizes.forEach(n => positive(n, 'typeRules sizes'));
  }
  positive(policy.minControlSize, 'minControlSize'); positive(policy.minControlGap, 'minControlGap');
  if (!Array.isArray(policy.controlSizeRules)) throw new Error('controlSizeRules must be a list.');
  for (const rule of policy.controlSizeRules) {
    if (!rule || Object.keys(rule).some(k => !['selector', 'minSize', 'minViewportWidth', 'maxViewportWidth'].includes(k)) || typeof rule.selector !== 'string' || !rule.selector.trim()) throw new Error('Each control size rule needs a selector and minSize.');
    positive(rule.minSize, 'control size rule minSize');
    for (const key of ['minViewportWidth', 'maxViewportWidth']) {
      if (rule[key] !== undefined && (!Number.isInteger(rule[key]) || rule[key] < 1 || rule[key] > 10000)) throw new Error('Control size rule viewport bounds must be integers from 1 to 10000.');
    }
    if ((rule.minViewportWidth ?? 1) > (rule.maxViewportWidth ?? 10000)) throw new Error('Control size rule viewport bounds must be in increasing order.');
  }
  positive(policy.minLayoutGap, 'minLayoutGap');
  positive(policy.minControlInset, 'minControlInset');
  strings(policy.controlContainers, 'controlContainers');
  if (!Array.isArray(policy.viewports) || !policy.viewports.length) throw new Error('viewports must be a nonempty list.');
  for (const v of policy.viewports) if (!v || Object.keys(v).some(k => !['width', 'height'].includes(k)) || !Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 1 || v.height < 1 || v.width > 10000 || v.height > 10000) throw new Error('Each viewport needs integer width and height from 1 to 10000.');
  if (!Array.isArray(policy.colorSchemes) || !policy.colorSchemes.length || policy.colorSchemes.some(s => !['light', 'dark'].includes(s))) throw new Error('colorSchemes must contain light or dark.');
  if (!Array.isArray(policy.exceptions)) throw new Error('exceptions must be a list.');
  for (const e of policy.exceptions) {
    if (!e || Object.keys(e).some(k => !['selector', 'rules', 'reason'].includes(k)) || typeof e.selector !== 'string' || !e.selector.trim() || typeof e.reason !== 'string' || !e.reason.trim()) throw new Error('Each exception needs a selector, rules, and a reason.');
    strings(e.rules, 'exception rules');
    for (const id of e.rules) if (!ruleIds.includes(id)) throw new Error(`Unknown rule: ${id}`);
  }
  return policy;
}

// Use this API after your test enters a dialog, error state, or signed-in page.
export async function checkPage(page, input = {}) {
  const policy = validatePolicy(input);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  // Keep the app's own axe object unchanged. Each check gets a fresh engine.
  const contrast = await page.evaluateHandle(`(() => { const previous = window.axe; ${axe.source}\n const engine = window.axe; window.axe = previous; return engine; })()`);
  const accessibility = await page.evaluateHandle(`(${auditAccessibility.toString()})`);
  const format = await page.evaluateHandle(`(${finding.toString()})`);
  const visibility = await page.evaluateHandle(`(${createVisibility.toString()})()`);
  try { return await page.evaluate(audit, { policy, contrast, accessibility, format, visibility }); }
  finally { await Promise.all([contrast.dispose(), accessibility.dispose(), format.dispose(), visibility.dispose()]); }
}

export async function checkInteractions(page, plan, input = {}, { timeout = 15000 } = {}) {
  if (!Number.isInteger(timeout) || timeout < 1) throw new Error('Page-check timeout must be a positive integer.');
  const validated = validateInteractions(plan);
  const policy = validatePolicy(input);
  return runInteractions(page, validated, policy, (page, policy) => checkPageWithin(page, policy, timeout), createVisibility);
}

async function checkPageWithin(page, policy, timeout) {
  let timer;
  try {
    return await Promise.race([checkPage(page, policy), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Page checks exceeded the time limit.')), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

export async function checkUrl(url, input = {}, { ready, timeout = 15000, interactions } = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) throw new Error('Use an HTTP, HTTPS, or file URL.');
  const policy = validatePolicy(input);
  if (interactions !== undefined) validateInteractions(interactions);
  const browser = await launchBrowser();
  const report = { url, rules: ruleIds, runs: [], findings: [] };
  try {
    for (const viewport of policy.viewports) for (const colorScheme of policy.colorSchemes) {
      const context = await browser.newContext({ viewport, colorScheme, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        const response = await page.goto(url, { waitUntil: 'load', timeout });
        if (response && !response.ok()) {
          if (response.status() === 404) throw new Error(`Page not found: ${response.url()} (HTTP 404). Check the page path.`);
          throw new Error(`Page returned HTTP ${response.status()} at ${response.url()}.`);
        }
        if (ready) await page.locator(ready).waitFor({ state: 'visible' });
        const result = await checkPageWithin(page, policy, timeout);
        const states = [{ name: 'initial', url: page.url(), ...result }];
        const findings = result.findings.map(f => ({ ...f, state: 'initial' }));
        const suppressed = result.suppressed.map(f => ({ ...f, state: 'initial' }));
        const accessibilityCoverage = { ...result.accessibilityCoverage };
        if (interactions !== undefined) {
          const interaction = await checkInteractions(page, interactions, policy, { timeout });
          findings.push(...interaction.findings);
          suppressed.push(...interaction.suppressed);
          states.push(...interaction.states);
          accessibilityCoverage.interactions = interaction.checks;
          accessibilityCoverage.interactionRules = interaction.checks.length ? 'only listed interactions tested' : interaction.states.length ? 'not tested: page-state actions only' : 'not tested: empty interaction plan';
        }
        report.runs.push({ viewport, colorScheme, elements: result.elements, controls: result.controls, insetControls: result.insetControls, numericElements: result.numericElements, alignmentGroups: result.alignmentGroups, radiusContracts: result.radiusContracts, suppressed, accessibilityCoverage, states });
        report.findings.push(...findings.map(f => ({ ...f, viewport, colorScheme })));
      } finally { await context.close(); }
    }
    return report;
  } finally { await browser.close(); }
}
