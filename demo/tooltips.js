let active;
const triggerFor = target => target instanceof Element ? target.closest('[data-ui-tooltip]') : null;
const close = () => {
  if (active) {
    active.tip.hidden = true;
    if (active.home.isConnected) active.home.append(active.tip);
    else active.tip.remove();
  }
  active = null;
};
const open = trigger => {
  const tip = document.getElementById(trigger.dataset.uiTooltip);
  if (!tip) return;
  if (active?.trigger !== trigger) close();
  const home = active?.home || tip.parentElement;
  document.body.append(tip);
  tip.textContent = trigger.getAttribute('aria-label') || tip.textContent;
  tip.hidden = false;
  const rect = trigger.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - box.width - 8))}px`;
  tip.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - box.height - 8))}px`;
  active = { trigger, tip, home };
};
document.addEventListener('pointerover', event => { const trigger = triggerFor(event.target); if (trigger) open(trigger); });
document.addEventListener('focusin', event => { const trigger = triggerFor(event.target); if (trigger) open(trigger); });
document.addEventListener('pointerout', event => {
  if (!active || active.trigger.contains(event.relatedTarget) || active.tip.contains(event.relatedTarget) || document.activeElement === active.trigger) return;
  close();
});
document.addEventListener('focusout', () => { if (active && !active.trigger.matches(':hover') && !active.tip.matches(':hover')) close(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
window.addEventListener('hashchange', close);
