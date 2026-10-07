import { rules } from './rules.js';
import './tooltips.js';

const main = document.querySelector('main');
const themeButton = document.querySelector('#theme-toggle');
const groups = [...new Set(rules.map(rule => rule.group))];
const states = new Map(rules.map(rule => [rule.id, 'before']));
let theme = document.documentElement.dataset.theme;
let reports;
let reportError = false;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${({ Typography: '<path d="M4 5h16M12 5v14M8 19h8"/>', Layout: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M4 11h16M11 11v9"/>', Color: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>', Content: '<path d="M5 6h14M5 12h10M5 18h14"/>' })[name === 'Accessibility' ? 'Layout' : name]}</svg>`;
const frameURL = (id, state) => `specimen.html?rule=${id}&state=${state}&theme=${theme}`;
const preview = (rule, state, loading = 'lazy') => `<iframe class="preview${['font-size', 'content-clipping'].includes(rule.id) ? ' screen-preview' : ''}" src="${frameURL(rule.id, state)}" title="${escape(rule.title)}: ${state}" loading="${loading}"></iframe>`;
const result = (id, state) => reports?.examples.find(entry => entry.rule === id && entry.state === state && entry.theme === theme && entry.viewport.width === 248);
const resultLabel = (id, state) => {
  const findings = result(id, state)?.findings;
  const label = findings ? findings.length ? `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}` : 'No findings' : reportError ? 'Check results unavailable' : 'Loading check results';
  return findings && id === 'content-clipping' ? `At initial width: ${label}` : label;
};

function navigation(id) {
  return `<nav class="ui-stack" data-ui-stack><a href="#/" ${!id ? 'aria-current="page"' : ''}>Index</a>${groups.map(group => `<div class="nav-group ui-stack" data-ui-stack><p>${group}</p>${rules.filter(rule => rule.group === group).map(rule => `<a href="#/rule/${rule.id}" ${id === rule.id ? 'aria-current="page"' : ''}>${escape(rule.title)}</a>`).join('')}</div>`).join('')}</nav>`;
}

function gallery() {
  return `<div class="intro ui-stack" data-ui-stack>
    <h1>Index</h1>
    <p>A collection of interface rules, tested in the browser. Compare each error with its fix.</p>
    <p>These examples use the real checker in this repo. Select a rule to see its measured values and the code that fixes it.</p>
    <div class="command" data-ui-container><code>npm run demo:check</code><button class="icon-button" type="button" data-copy="npm run demo:check" aria-label="Copy the check command" data-ui-tooltip="copy-tooltip" aria-describedby="copy-tooltip"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg></button><span class="ui-tooltip" id="copy-tooltip" role="tooltip" hidden>Copy the check command</span></div>
    <p><a href="../downloads/lintapple-0.1.8.tgz" download>Download lintapple 0.1.8</a></p>
    <div class="all-controls ui-actions" data-ui-actions data-ui-container><p>Start with the errors. Then compare the fixes.</p><button type="button" id="all-states">${rules.every(rule => states.get(rule.id) === 'after') ? 'Show all errors' : 'Show all fixes'}</button></div>
  </div>
  <div class="groups ui-stack" data-ui-stack>${groups.map(group => `<section class="rule-group ui-stack" data-ui-stack><h2 class="group-heading">${icon(group)}${group}</h2><div class="rule-grid" data-ui-stack>${rules.filter(rule => rule.group === group).map(rule => card(rule)).join('')}</div></section>`).join('')}</div>`;
}

function card(rule) {
  const state = states.get(rule.id);
  return `<article class="rule-card" data-rule="${rule.id}">
    ${preview(rule, state)}
    <div class="card-copy ui-stack" data-ui-stack><h3><a href="#/rule/${rule.id}">${escape(rule.title)}</a></h3><p>${escape(rule.summary)}</p></div>
    <div class="state-controls ui-actions" data-ui-actions data-ui-container>${['before', 'after'].map(value => `<button type="button" data-state="${value}" aria-pressed="${value === state}">${value === 'before' ? 'Before' : 'After'}</button>`).join('')}</div>
    <p class="finding-note">${resultLabel(rule.id, state)}</p>
  </article>`;
}

function detail(rule) {
  const checked = result(rule.id, 'before');
  return `<article class="detail ui-stack" data-ui-stack>
    <a class="back-link" href="#/">← Index</a>
    <div class="detail-intro ui-stack" data-ui-stack><h1>${escape(rule.title)}</h1><p>${escape(rule.explanation)}</p><p><code>${rule.id}</code></p></div>
    <div class="comparison" data-ui-stack>${['before', 'after'].map(state => `<section class="ui-stack" data-ui-stack><h2>${state === 'before' ? 'Before' : 'After'}</h2>${preview(rule, state, 'eager')}<p class="finding-note">${resultLabel(rule.id, state)}</p></section>`).join('')}</div>
    <section class="ui-stack" data-ui-stack><h2>The fix</h2><pre class="fix-code"><code>${escape(rule.fix)}</code></pre></section>
    <section class="report-list ui-stack" data-ui-stack><h2>Checker results</h2><p class="finding-note">${checked ? `Recorded at ${checked.viewport.width} × ${checked.viewport.height} px in the ${theme} theme.` : resultLabel(rule.id, 'before')}</p>${checked?.findings.map(finding => `<div class="report ui-stack" data-ui-stack><p><code>${escape(finding.rule)}</code></p><dl><dt>Outcome</dt><dd>${finding.status === 'unresolved' ? 'Needs review' : 'Failed'}</dd><dt>Found</dt><dd>${escape(finding.actual)}</dd><dt>Expected</dt><dd>${escape(finding.expected)}</dd><dt>Element</dt><dd><code>${escape(finding.selector)}</code></dd></dl><p>${escape(finding.fix)}</p></div>`).join('') ?? ''}</section>
    <section class="ui-stack" data-ui-stack><h2>Check this example</h2><p class="finding-note">Start the demo server, then run this command from the repo.</p><pre class="fix-code"><code>node bin/lintapple.js "http://localhost:4173/demo/${escape(frameURL(rule.id, 'after'))}"${rule.interactions ? ` --interactions demo/plans/${rule.id}.json` : ''}</code></pre></section>
  </article>`;
}

function render() {
  const id = location.hash.match(/^#\/rule\/([^/]+)$/)?.[1];
  const rule = rules.find(entry => entry.id === id);
  document.querySelector('.sidebar').innerHTML = navigation(id);
  main.innerHTML = `<details class="mobile-nav"><summary>Browse rules</summary>${navigation(id)}</details>${id ? rule ? detail(rule) : '<div class="empty ui-stack" data-ui-stack><h1>Rule not found</h1><a href="#/">Return to Index</a></div>' : gallery()}`;
  document.title = `${rule ? rule.title : 'Interface rules'} — lintapple`;
  document.body.dataset.ready = 'true';
}

function setCardState(card, state) {
  const id = card.dataset.rule;
  states.set(id, state);
  const frame = card.querySelector('iframe');
  const update = () => frame.contentWindow?.setExampleState?.(state);
  frame.onload = update;
  update();
  frame.title = `${rules.find(rule => rule.id === id).title}: ${state}`;
  card.querySelectorAll('[data-state]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.state === state)));
  card.querySelector('.finding-note').textContent = resultLabel(id, state);
}

main.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.state) {
    setCardState(button.closest('[data-rule]'), button.dataset.state);
    document.querySelector('#all-states').textContent = rules.every(rule => states.get(rule.id) === 'after') ? 'Show all errors' : 'Show all fixes';
  } else if (button.id === 'all-states') {
    const state = rules.every(rule => states.get(rule.id) === 'after') ? 'before' : 'after';
    main.querySelectorAll('[data-rule]').forEach(card => setCardState(card, state));
    button.textContent = state === 'after' ? 'Show all errors' : 'Show all fixes';
  } else if (button.dataset.copy) {
    try { await navigator.clipboard.writeText(button.dataset.copy); button.setAttribute('aria-label', 'Check command copied'); }
    catch { button.setAttribute('aria-label', 'Select the command to copy it'); }
  }
});
themeButton.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  themeButton.setAttribute('aria-label', `Use ${theme === 'light' ? 'dark' : 'light'} theme`);
  render();
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
render();
try {
  const response = await fetch('reports.json');
  if (!response.ok) throw new Error('Check results unavailable.');
  reports = await response.json();
} catch { reportError = true; }
render();
