let active: { trigger: HTMLElement; tip: HTMLElement; home: HTMLElement } | null;
const triggerFor = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-ui-tooltip]') : null;
export const closeTooltip = () => {
  if (active) {
    active.tip.hidden = true;
    if (active.home.isConnected) active.home.append(active.tip);
    else active.tip.remove();
  }
  active = null;
};
export const openTooltip = (trigger: HTMLElement) => {
  const tip = document.getElementById(trigger.dataset.uiTooltip ?? '');
  if (!tip) return;
  if (active?.trigger !== trigger) closeTooltip();
  const home = active?.home || tip.parentElement!;
  document.body.append(tip);
  tip.textContent = trigger.getAttribute('aria-label') || tip.textContent;
  tip.hidden = false;
  const rect = trigger.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  tip.style.setProperty('--tooltip-left', `${Math.max(8, Math.min(rect.left, innerWidth - box.width - 8))}px`);
  tip.style.setProperty('--tooltip-top', `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - box.height - 8))}px`);
  active = { trigger, tip, home };
};
document.addEventListener('pointerover', event => { const trigger = triggerFor(event.target); if (trigger) openTooltip(trigger); });
document.addEventListener('focusin', event => { const trigger = triggerFor(event.target); if (trigger) openTooltip(trigger); });
document.addEventListener('pointerout', event => {
  if (!active || !(active.trigger.contains(event.target as Node) || active.tip.contains(event.target as Node)) || active.trigger.contains(event.relatedTarget as Node | null) || active.tip.contains(event.relatedTarget as Node | null) || document.activeElement === active.trigger) return;
  closeTooltip();
});
document.addEventListener('focusout', () => { if (active && !active.trigger.matches(':hover') && !active.tip.matches(':hover')) closeTooltip(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeTooltip(); });
window.addEventListener('hashchange', closeTooltip);
window.addEventListener('resize', () => { if (active) openTooltip(active.trigger); });
