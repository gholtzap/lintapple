import { rules } from './rules.js';
import './tooltips.js';
import Lenis from './vendor/lenis.mjs';

const main = document.querySelector('main');
const themeButton = document.querySelector('#theme-toggle');
const groups = [...new Set(rules.map(rule => rule.group))];
const states = new Map(rules.map(rule => [rule.id, 'before']));
let theme = document.documentElement.dataset.theme;
let lenis;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${({ Typography: '<path d="M4 5h16M12 5v14M8 19h8"/>', Layout: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M4 11h16M11 11v9"/>', Color: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>', Content: '<path d="M5 6h14M5 12h10M5 18h14"/>' })[name]}</svg>`;
const frameURL = (id, state) => `specimen.html?rule=${id}&state=${state}&theme=${theme}`;
const preview = (rule, state, loading = 'lazy') => `<iframe class="preview${['font-size', 'content-overflow'].includes(rule.id) ? ' screen-preview' : ''}${rule.id === 'content-overflow' ? ' resize-preview' : ''}" src="${frameURL(rule.id, state)}" title="${escape(rule.title)}: ${state}" loading="${loading}"></iframe>`;
const stateControls = state => `<div class="state-controls ui-actions" data-ui-actions data-ui-container>${['before', 'after'].map(value => `<button type="button" data-state="${value}" aria-pressed="${value === state}">${value === 'before' ? 'Before' : 'After'}</button>`).join('')}</div>`;

function navigation(id) {
  return `<nav class="ui-stack" data-ui-stack><a href="#/" ${!id ? 'aria-current="page"' : ''}>Index</a>${groups.map(group => `<div class="nav-group ui-stack" data-ui-stack><p>${group}</p>${rules.filter(rule => rule.group === group).map(rule => `<a href="#/rule/${rule.id}" ${id === rule.id ? 'aria-current="page"' : ''}>${escape(rule.title)}</a>`).join('')}</div>`).join('')}</nav>`;
}

function gallery() {
  return `<div class="intro ui-stack" data-ui-stack>
    <h1>Index</h1>
    <p>Interface rules, with before and after examples.</p>
    <section class="ui-stack" data-ui-stack>
      <h2>Install</h2>
      <pre class="fix-code"><code>npm install -D lintapple &amp;&amp; npx lintapple init</code></pre>
    </section>
    <section class="ui-stack" data-ui-stack>
      <h2>Setup prompt</h2>
      <p class="fix-code">Set up lintapple, keep existing settings, match ui-policy.json to this design, set the app URL in lint:ui, and check all pages and states at mobile and desktop sizes; fix findings without adding exceptions.</p>
    </section>
    <section class="ui-stack" data-ui-stack>
      <h2>Try a page</h2>
      <pre class="fix-code"><code>npx lintapple http://localhost:3000</code></pre>
    </section>
    <section class="ui-stack" data-ui-stack>
      <h2>With Playwright</h2>
      <pre class="fix-code"><code>import { expectUI } from 'lintapple/playwright';\nawait expectUI(page, testInfo);</code></pre>
      <p>Add the assertion after the page is ready. It uses your project policy and attaches findings to failed tests.</p>
    </section>
  </div>
  <div class="groups ui-stack" data-ui-stack>${groups.map(group => `<section class="rule-group ui-stack" data-ui-stack><h2 class="group-heading">${icon(group)}${group}</h2><div class="rule-grid" data-ui-stack>${rules.filter(rule => rule.group === group).map(rule => card(rule)).join('')}</div></section>`).join('')}</div>`;
}

function card(rule) {
  const state = states.get(rule.id);
  return `<article class="rule-card" data-rule="${rule.id}">
    ${preview(rule, state)}
    <div class="card-copy ui-stack" data-ui-stack><h3><a href="#/rule/${rule.id}">${escape(rule.title)}</a></h3><p>${escape(rule.summary)}</p></div>
    ${stateControls(state)}
  </article>`;
}

function detail(rule) {
  const state = states.get(rule.id);
  return `<article class="detail ui-stack" data-ui-stack data-rule="${rule.id}">
    <a class="back-link" href="#/">← Index</a>
    <div class="detail-intro ui-stack" data-ui-stack><h1>${escape(rule.title)}</h1><p>${escape(rule.summary)}</p></div>
    <section class="comparison ui-stack" data-ui-stack>${preview(rule, state, 'eager')}${stateControls(state)}</section>
    <section class="ui-stack" data-ui-stack><h2>The fix</h2><pre class="fix-code"><code>${escape(rule.fix)}</code></pre></section>
  </article>`;
}

function render() {
  const requestedId = location.hash.match(/^#\/rule\/([^/]+)$/)?.[1];
  const id = requestedId === 'content-clipping' ? 'content-overflow' : requestedId;
  const rule = rules.find(entry => entry.id === id);
  document.querySelector('.sidebar').innerHTML = navigation(id);
  main.innerHTML = `<details class="mobile-nav"><summary>Browse rules</summary>${navigation(id)}</details>${id ? rule ? detail(rule) : '<div class="empty ui-stack" data-ui-stack><h1>Rule not found</h1><a href="#/">Return to Index</a></div>' : gallery()}`;
  document.title = `${rule ? rule.title : 'Interface rules'} — lintapple`;
  document.body.dataset.ready = 'true';
  lenis?.resize();
}

function setPreviewState(example, state) {
  const id = example.dataset.rule;
  states.set(id, state);
  const frame = example.querySelector('iframe');
  const update = () => frame.contentWindow?.setExampleState?.(state);
  frame.onload = update;
  update();
  frame.title = `${rules.find(rule => rule.id === id).title}: ${state}`;
  example.querySelectorAll('[data-state]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.state === state)));
}

main.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.state) {
    setPreviewState(button.closest('[data-rule]'), button.dataset.state);
  }
});
themeButton.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  themeButton.setAttribute('aria-label', `Use ${theme === 'light' ? 'dark' : 'light'} theme`);
  render();
});
render();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
lenis = new Lenis({ autoRaf: true, virtualScroll: () => !reducedMotion.matches });
reducedMotion.addEventListener('change', () => lenis.scrollTo(lenis.actualScroll, { immediate: true }));
window.addEventListener('hashchange', () => { render(); lenis.scrollTo(0, { immediate: true }); });
