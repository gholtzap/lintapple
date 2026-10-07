import { rules } from './rules.js';
import './tooltips.js';

const params = new URLSearchParams(location.search);
const rule = rules.find(item => item.id === params.get('rule'));
const state = params.get('state');
const theme = params.get('theme');
const specimen = document.querySelector('.specimen');
document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
document.body.dataset.state = state ?? '';
if (!rule || !['before', 'after'].includes(state) || !['light', 'dark'].includes(theme)) {
  document.title = 'Invalid rule example';
  specimen.textContent = 'Select a valid rule, state, and theme.';
} else {
  specimen.innerHTML = rule.html;
  const style = document.createElement('style');
  document.head.append(style);
  let selectedState = state;
  let transition;
  const applyState = () => {
    if (rule.afterHTML) specimen.innerHTML = selectedState === 'after' ? rule.afterHTML : rule.html;
    for (const [selector, attributes] of Object.entries(rule.attributes?.[selectedState] || {})) {
      const element = specimen.querySelector(selector);
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
  specimen.addEventListener('click', event => {
    if (event.target.closest('#keyboard-button')) specimen.querySelector('#keyboard-result').textContent = 'Applied';
    if (event.target.closest('#disclosure')) {
      const panel = specimen.querySelector('#details-panel');
      panel.hidden = !panel.hidden;
      if (selectedState === 'after') specimen.querySelector('#disclosure').setAttribute('aria-expanded', String(!panel.hidden));
    }
    const dialog = specimen.querySelector('#edit-dialog');
    if (event.target.closest('#edit-open')) {
      if (selectedState === 'after') dialog.showModal();
      else dialog.hidden = false;
    }
    if (event.target.closest('#edit-cancel')) {
      if (selectedState === 'after') dialog.close();
      else { dialog.hidden = true; event.target.blur(); }
    }
  });
  window.setExampleState = nextState => {
    if (!['before', 'after'].includes(nextState) || nextState === selectedState) return;
    selectedState = nextState;
    transition?.skipTransition();
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transition = document.startViewTransition(applyState);
      transition.ready.catch(() => {});
    } else applyState();
  };
  if (rule.id === 'content-clipping') {
    specimen.setAttribute('data-ui-stack', '');
    const panel = specimen.querySelector('.resize-panel');
    const input = specimen.querySelector('#example-width');
    const output = specimen.querySelector('#width-value');
    const update = () => {
      input.max = Math.floor(specimen.getBoundingClientRect().width);
      input.value = Math.round(panel.getBoundingClientRect().width);
      output.textContent = `${input.value} px`;
    };
    input.addEventListener('input', () => { panel.style.width = `${input.value}px`; update(); });
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    observer.observe(specimen);
    update();
    const requestedWidth = Number(params.get('width'));
    if (Number.isInteger(requestedWidth) && requestedWidth > 0) {
      input.value = requestedWidth;
      panel.style.width = `${input.value}px`;
      update();
    }
  }
}
document.body.dataset.ready = 'true';
