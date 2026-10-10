// Runs in the browser with the same scope and report helpers as the layout audit.
export async function auditAccessibility({ elements, controls, visible, hasVisibleContent, add, engine }) {
  const rules = {
    'button-name': 'accessible-name', 'input-button-name': 'accessible-name',
    'input-image-alt': 'accessible-name', 'aria-tab-name': 'accessible-name',
    'aria-meter-name': 'accessible-name', 'aria-progressbar-name': 'accessible-name',
    'aria-tooltip-name': 'accessible-name', 'aria-treeitem-name': 'accessible-name',
    'link-name': 'accessible-name', 'aria-command-name': 'accessible-name',
    'aria-dialog-name': 'accessible-name', 'aria-input-field-name': 'form-label',
    'aria-toggle-field-name': 'form-label', 'select-name': 'form-label',
    'label': 'form-label', 'label-title-only': 'form-label',
    'label-content-name-mismatch': 'label-consistency',
    'aria-valid-attr-value': 'control-state', 'aria-required-attr': 'control-state',
    'aria-allowed-attr': 'control-state', 'aria-prohibited-attr': 'control-state',
    'aria-valid-attr': 'control-state', 'aria-roles': 'control-state',
    'aria-conditional-attr': 'control-state', 'aria-required-children': 'control-state',
    'aria-required-parent': 'control-state',
    'aria-hidden-focus': 'keyboard-operation', 'target-size': 'target-size',
  };
  const result = await engine.run(document, {
    runOnly: Object.keys(rules), iframes: false, elementRef: true,
    rules: Object.fromEntries(Object.keys(rules).map(id => [id, { enabled: true }])),
    resultTypes: ['violations', 'incomplete'],
  });
  const scope = new Set(elements);
  const reported = new Set();
  for (const [status, results] of [['failed', result.violations], ['unresolved', result.incomplete]]) {
    for (const rule of results) for (const node of rule.nodes) {
      const el = node.element;
      if (!scope.has(el) || !visible(el)) continue;
      // Resolve only the engine's popup-reference uncertainty with unique DOM targets.
      if (status === 'unresolved' && rule.id === 'aria-valid-attr-value') {
        const checks = [...node.any, ...node.all, ...node.none];
        const ids = (el.getAttribute('aria-controls') || '').trim().split(/\s+/).filter(Boolean);
        const resolved = ['true', 'menu'].includes(el.getAttribute('aria-haspopup')) && ids.length && ids.every(id => {
          const targets = document.querySelectorAll(`#${CSS.escape(id)}`);
          return targets.length === 1 && targets[0].getAttribute('role') === 'menu';
        });
        if (resolved && checks.length && checks.every(check => check.id === 'aria-valid-attr-value' && check.data?.messageKey === 'controlsWithinPopup')) continue;
      }
      const id = rules[rule.id];
      const key = `${id}:${elements.indexOf(el)}`;
      if (reported.has(key)) continue;
      reported.add(key);
      add(id, el, node.failureSummary || rule.description, rule.help,
        `Review ${rule.helpUrl} and fix the reported control.`, null,
        { status, category: 'accessibility', sourceRule: rule.id, helpUrl: rule.helpUrl });
    }
  }
  engine.setup(document);
  try {
    const refs = el => (el.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean).map(id => document.getElementById(id));
    for (const el of elements) {
      for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto']) {
        if (!el.hasAttribute(attr)) continue;
        // A collapsed popup can create its controlled element only when opened.
        if (attr === 'aria-controls' && el.getAttribute('aria-expanded') === 'false') continue;
        const ids = el.getAttribute(attr).trim().split(/\s+/).filter(Boolean);
        const missing = ids.filter(id => !document.getElementById(id));
        if (!ids.length || missing.length) add('aria-reference', el, `${attr}: ${missing.join(', ') || 'empty reference'}`, 'ARIA references to existing element IDs', 'Correct the IDs or render the referenced elements.', null, { status: 'failed', category: 'accessibility' });
      }
      if (el.matches('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), textarea, select')) {
        const named = el.getAttribute('aria-label')?.trim() || refs(el).some(ref => ref?.textContent.trim()) || [...(el.labels || [])].some(label => label.textContent.trim());
        if (!named && !reported.has(`form-label:${elements.indexOf(el)}`)) add('form-label', el, 'no label beyond a placeholder or title', 'a programmatic form label', 'Use a label element, aria-label, or aria-labelledby. Keep placeholders as examples.', null, { status: 'failed', category: 'accessibility' });
      }
      if (el.matches('[data-ui-disclosure], button[aria-haspopup="menu"], button[aria-haspopup="true"], [role="button"][aria-haspopup="menu"], [role="button"][aria-haspopup="true"]')) {
        if (!['true', 'false'].includes(el.getAttribute('aria-expanded'))) add('control-state', el, 'missing or invalid aria-expanded', 'aria-expanded="true" or "false"', 'Expose the current expanded state and update it when the panel changes.', null, { status: 'failed', category: 'accessibility' });
        if (el.hasAttribute('data-ui-disclosure')) {
          const id = el.getAttribute('aria-controls');
          const panel = document.getElementById(id);
          if (!id?.trim() || (!panel && el.getAttribute('aria-expanded') !== 'false')) add('control-state', el, 'no controlled panel', 'aria-controls naming the disclosure panel', 'Connect the disclosure button to its panel.', null, { status: 'failed', category: 'accessibility' });
          if (panel && ['true', 'false'].includes(el.getAttribute('aria-expanded')) && (el.getAttribute('aria-expanded') === 'true') !== hasVisibleContent(panel)) add('control-state', el, 'aria-expanded does not match panel visibility', 'expanded state matching the controlled panel', 'Update aria-expanded and panel visibility together.', panel, { status: 'failed', category: 'accessibility' });
        }
      }
    }
    for (const el of controls.filter(el => !el.matches(':disabled') && !el.closest('[aria-disabled="true"]'))) {
      if (!engine.commons.dom.isVisibleOnScreen(el) || /[\p{L}\p{N}]/u.test(engine.commons.text.visible(el)) || el.matches('input')) continue;
      const ids = `${el.getAttribute('aria-describedby') || ''} ${el.getAttribute('data-ui-tooltip') || ''}`.trim().split(/\s+/).filter(Boolean);
      const tooltip = ids.map(id => document.getElementById(id)).find(node => node?.getAttribute('role') === 'tooltip' && node.textContent.trim());
      if (!tooltip) add('icon-button-tooltip', el, 'no linked text tooltip', 'a text tooltip for a button without a visible text label', 'Give the button an accessible name. Connect a role="tooltip" element with aria-describedby or data-ui-tooltip, and show it on hover and keyboard focus.', null, { status: 'failed', category: 'design' });
    }
    for (const dialog of elements.filter(el => el.matches('dialog:modal, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'))) {
      if (!dialog.contains(document.activeElement)) add('dialog-focus', dialog, 'focus outside the open modal', 'focus inside the open modal', 'Move focus into the modal when it opens. Test focus containment and return with an interaction plan.', null, { status: 'failed', category: 'accessibility' });
    }
  } finally { engine.teardown(); }
  return { pageRules: [...new Set([...Object.values(rules), 'aria-reference', 'icon-button-tooltip', 'dialog-focus'])], interactionRules: 'not tested without an interaction plan' };
}
