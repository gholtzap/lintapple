import type { ExampleState } from './types.js';
import { rules } from './rules.js';
import './tooltips.js';

const params = new URLSearchParams(location.search);
const rule = rules.find(item => item.id === params.get('rule'));
const state = params.get('state');
const theme = params.get('theme');
const specimen = document.querySelector<HTMLElement>('.specimen')!;
document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
document.body.dataset.state = state ?? '';
if (!rule || (state !== 'before' && state !== 'after') || (theme !== 'light' && theme !== 'dark')) {
  document.title = 'Invalid rule example';
  specimen.textContent = 'Select a valid rule, state, and theme.';
} else {
  specimen.innerHTML = rule.html;
  const style = document.createElement('style');
  document.head.append(style);
  let selectedState: ExampleState = state;
  let transition: ViewTransition | undefined;
  const applyState = () => {
    for (const [selector, attributes] of Object.entries(rule.attributes?.[selectedState] || {})) {
      const element = specimen.querySelector(selector)!;
      for (const [name, value] of Object.entries(attributes)) {
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      }
    }
    style.textContent = rule[selectedState];
    document.body.dataset.state = selectedState;
    document.title = `${rule.title} — ${selectedState}`;
    specimen.setAttribute('aria-label', `${rule.title}: ${selectedState}`);
    params.set('state', selectedState);
    history.replaceState(null, '', `?${params}`);
  };
  applyState();
  window.setExampleState = nextState => {
    if (!['before', 'after'].includes(nextState) || nextState === selectedState) return;
    selectedState = nextState;
    transition?.skipTransition();
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transition = document.startViewTransition(applyState);
      transition.ready.catch(() => {});
    } else applyState();
  };
  if (rule.id === 'content-overflow') {
    specimen.setAttribute('data-ui-stack', '');
    const panel = specimen.querySelector<HTMLElement>('.resize-panel')!;
    const input = specimen.querySelector<HTMLInputElement>('#example-width')!;
    const output = specimen.querySelector('#width-value')!;
    const update = () => {
      input.max = String(Math.floor(specimen.getBoundingClientRect().width));
      input.value = String(Math.round(panel.getBoundingClientRect().width));
      output.textContent = `${input.value} px`;
    };
    input.addEventListener('input', () => { panel.style.width = `${input.value}px`; update(); });
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    observer.observe(specimen);
    update();
    const requestedWidth = Number(params.get('width'));
    if (Number.isInteger(requestedWidth) && requestedWidth > 0) {
      input.value = String(requestedWidth);
      panel.style.width = `${input.value}px`;
      update();
    }
  }
}
document.body.dataset.ready = 'true';
