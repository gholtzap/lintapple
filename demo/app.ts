import type { DemoRule, ExampleState } from './types.js';
import { rules } from './rules.js';
import { highlightedCode } from './highlighted-code.js';
import './tooltips.js';
import Lenis from './vendor/lenis.mjs';

const base = new URL('.', document.baseURI);
const main = document.querySelector('main')!;
const themeButton = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
const groups = [...new Set(rules.map(rule => rule.group))];
const states = new Map(rules.map(rule => [rule.id, 'before' as ExampleState]));
let theme = document.documentElement.dataset.theme;
let lenis: Lenis;
const escape = (value: string) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const icon = (name: DemoRule['group']) => `<svg viewBox="0 0 24 24" aria-hidden="true">${({ Typography: '<path d="M4 5h16M12 5v14M8 19h8"/>', Layout: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M4 11h16M11 11v9"/>', Color: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>', Content: '<path d="M5 6h14M5 12h10M5 18h14"/>' })[name]}</svg>`;
const frameURL = (id: string, state: ExampleState) => `specimen.html?rule=${id}&state=${state}&theme=${theme}`;
const preview = (rule: DemoRule, state: ExampleState, loading = 'lazy') => `<iframe class="preview${['font-size', 'content-overflow', 'content-inset'].includes(rule.id) ? ' screen-preview' : ''}${rule.id === 'content-overflow' ? ' resize-preview' : ''}" src="${frameURL(rule.id, state)}" title="${escape(rule.title)}: ${state}" loading="${loading}"></iframe>`;
const stateControls = (state: ExampleState) => `<div class="state-controls ui-actions" data-ui-actions data-ui-container>${['before', 'after'].map(value => `<button type="button" data-state="${value}" aria-pressed="${value === state}">${value === 'before' ? 'Before' : 'After'}</button>`).join('')}</div>`;

function navigation(id?: string) {
  return `<nav class="ui-stack" data-ui-stack><a href="./" ${!id ? 'aria-current="page"' : ''}>About</a>${groups.map(group => `<div class="nav-group ui-stack" data-ui-stack><p>${group}</p>${rules.filter(rule => rule.group === group).map(rule => `<a href="rule/${rule.id}" ${id === rule.id ? 'aria-current="page"' : ''}>${escape(rule.title)}</a>`).join('')}</div>`).join('')}</nav>`;
}

function gallery() {
  return `<div class="intro ui-stack" data-ui-stack>
    <h1>About</h1>
    <p>It should be impossible for AI to make a bad UI.</p>
    <p>lintapple checks for common UI mistakes that AI overlooks when building frontends.</p>
    <section class="ui-stack" data-ui-stack>
      <h2>Ask your coding agent</h2>
      <p class="fix-code">Install and set up github.com/gholtzap/lintapple in this project. Configure it for this app’s URL, fonts, and text sizes.</p>
    </section>
    <section class="ui-stack" data-ui-stack>
      <h2>Or run this command</h2>
      <div class="install-command ui-stack" data-ui-stack>
        <div class="command-code" data-ui-container>
          ${highlightedCode['npm install -D lintapple && npx lintapple init']}
          <button class="icon-button copy-button" type="button" data-copy-command aria-label="Copy" data-ui-tooltip="copy-tooltip" aria-describedby="copy-tooltip">
            <!-- Copy icon from Tabler Icons (MIT), as used in the reference. -->
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z"/><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/></svg>
          </button>
          <span class="ui-tooltip" id="copy-tooltip" role="tooltip" hidden>Copy</span>
        </div>
        <span class="copy-status" role="status"></span>
      </div>
    </section>
  </div>
  <div class="groups ui-stack" data-ui-stack><h2>Examples</h2>${groups.map(group => `<section class="rule-group ui-stack" data-ui-stack><h2 class="group-heading">${icon(group)}${group}</h2><div class="rule-grid" data-ui-stack>${rules.filter(rule => rule.group === group).map(rule => card(rule)).join('')}</div></section>`).join('')}</div>`;
}

function card(rule: DemoRule) {
  const state = states.get(rule.id)!;
  return `<article class="rule-card" data-rule="${rule.id}">
    ${preview(rule, state)}
    <div class="card-footer ui-stack" data-ui-stack>
      <div class="card-copy ui-stack" data-ui-stack><h3><a href="rule/${rule.id}">${escape(rule.title)}</a></h3><p>${escape(rule.summary)}</p></div>
      ${stateControls(state)}
    </div>
  </article>`;
}

function detail(rule: DemoRule) {
  const state = states.get(rule.id)!;
  return `<article class="detail ui-stack" data-ui-stack data-rule="${rule.id}">
    <a class="back-link" href="./">← About</a>
    <div class="detail-intro ui-stack" data-ui-stack><h1>${escape(rule.title)}</h1><p>${escape(rule.summary)}</p>${rule.note ? `<p>${escape(rule.note)}</p>` : ''}</div>
    <section class="comparison ui-stack" data-ui-stack>${preview(rule, state, 'eager')}${stateControls(state)}</section>
    <section class="ui-stack" data-ui-stack><h2>The fix</h2>${highlightedCode[rule.fix]}</section>
  </article>`;
}

function render() {
  const requestedId = location.pathname.slice(base.pathname.length).match(/^rule\/([^/]+)\/?$/)?.[1];
  const id = requestedId === 'content-clipping' ? 'content-overflow' : requestedId;
  const rule = rules.find(entry => entry.id === id);
  document.querySelector('.sidebar')!.innerHTML = navigation(id);
  main.innerHTML = `<details class="mobile-nav"><summary>Browse rules</summary>${navigation(id)}</details>${id ? rule ? detail(rule) : '<div class="empty ui-stack" data-ui-stack><h1>Rule not found</h1><a href="./">Return to About</a></div>' : gallery()}`;
  const tooltipExample = main.querySelector<HTMLElement>('[data-rule="viewport-bounds"]');
  if (tooltipExample) setPreviewState(tooltipExample, states.get('viewport-bounds')!);
  document.title = rule ? `${rule.title} — lintapple` : 'lintapple — It should be impossible for AI to make a bad UI.';
  document.body.dataset.ready = 'true';
  lenis?.resize();
}

function setPreviewState(example: HTMLElement, state: ExampleState) {
  const id = example.dataset.rule!;
  states.set(id, state);
  const frame = example.querySelector('iframe')!;
  const update = () => frame.contentWindow?.setExampleState?.(state);
  frame.onload = update;
  update();
  frame.title = `${rules.find(rule => rule.id === id)!.title}: ${state}`;
  example.querySelectorAll<HTMLElement>('[data-state]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.state === state)));
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') for (const frame of main.querySelectorAll('iframe')) frame.contentWindow?.dismissExampleTooltip?.();
});
main.addEventListener('click', async event => {
  const button = (event.target as Element).closest('button');
  if (!button) return;
  if (button.dataset.state) {
    setPreviewState(button.closest<HTMLElement>('[data-rule]')!, button.dataset.state as ExampleState);
  } else if (button.hasAttribute('data-copy-command')) {
    const block = button.closest('.install-command')!;
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(block.querySelector('code')!.textContent!);
      block.querySelector('[role="status"]')!.textContent = 'Copied';
    } catch {
      block.querySelector('[role="status"]')!.textContent = 'Could not copy. Select the command to copy it.';
    } finally {
      button.disabled = false;
    }
  }
});
themeButton.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  themeButton.setAttribute('aria-label', `Use ${theme === 'light' ? 'dark' : 'light'} theme`);
  render();
});
migrateHash();
render();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
lenis = new Lenis({ autoRaf: true, virtualScroll: () => !reducedMotion.matches });
reducedMotion.addEventListener('change', () => lenis.scrollTo(lenis.actualScroll, { immediate: true }));
function migrateHash() {
  if (!location.hash.startsWith('#/')) return;
  const route = location.hash.match(/^#\/rule\/([^/]+)$/)?.[1];
  const target = new URL(route ? `rule/${route}` : './', base);
  target.search = location.search;
  history.replaceState(null, '', target);
}
function navigate() {
  migrateHash();
  lenis.stop();
  render();
  requestAnimationFrame(() => {
    lenis.start();
    lenis.scrollTo(0, { immediate: true });
  });
}
document.addEventListener('click', event => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
  const target = new URL(link.href);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) || (target.pathname !== base.pathname && !/^rule\/[^/]+\/?$/.test(target.pathname.slice(base.pathname.length)))) return;
  event.preventDefault();
  if (target.href !== location.href) history.pushState(null, '', target);
  navigate();
});
window.addEventListener('popstate', navigate);
window.addEventListener('hashchange', navigate);
