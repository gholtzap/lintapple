const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Space', 'Escape', 'Tab', 'Shift+Tab'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && !!value.trim();

export function validateWidgets(plan) {
  for (const kind of ['tabs', 'menus']) {
    if (!Array.isArray(plan[kind]) || plan[kind].length > 100) throw new Error(`${kind} must be a list of at most 100 interaction checks.`);
    for (const item of plan[kind]) {
      const fields = kind === 'tabs' ? ['selector', 'steps'] : ['selector', 'open', 'openKey', 'steps'];
      if (!object(item) || Object.keys(item).some(key => !fields.includes(key)) || !text(item.selector)) throw new Error(`Invalid ${kind} interaction.`);
      if (item.open !== undefined && !text(item.open)) throw new Error('Menu open must be a selector.');
      if (item.openKey !== undefined && (!item.open || !['Enter', 'Space', 'ArrowDown', 'ArrowUp'].includes(item.openKey))) throw new Error('Menu openKey needs an opener and Enter, Space, ArrowDown, or ArrowUp.');
      if (!Array.isArray(item.steps) || !item.steps.length || item.steps.length > 100) throw new Error(`${kind} needs 1 to 100 key steps.`);
      for (const step of item.steps) {
        const fields = kind === 'tabs' ? ['key', 'focus', 'selected'] : ['key', 'focus', 'checked', 'outcome', 'expectedText'];
        if (!object(step) || Object.keys(step).some(key => !fields.includes(key)) || !keys.includes(step.key) || !text(step.focus)) throw new Error(`Invalid ${kind} key step.`);
        if (kind === 'tabs' && !text(step.selected)) throw new Error('Each tab step needs the selected tab selector.');
        if (step.checked !== undefined) {
          if (!Array.isArray(step.checked) || !step.checked.length || step.checked.length > 100) throw new Error('checked needs 1 to 100 state checks.');
          for (const state of step.checked) if (!object(state) || Object.keys(state).some(key => !['selector', 'value'].includes(key)) || !text(state.selector) || ![true, false, 'mixed'].includes(state.value)) throw new Error('Each checked state needs a selector and a boolean or mixed value.');
          if (new Set(step.checked.map(state => state.selector)).size !== step.checked.length) throw new Error('checked selectors must be unique.');
        }
        if ((step.outcome !== undefined || step.expectedText !== undefined) && (!text(step.outcome) || !text(step.expectedText))) throw new Error('A menu outcome needs a selector and expectedText.');
      }
    }
  }
}

// The same focus contract supports direct focus and aria-activedescendant.
function hasFocus(selector) {
  const elements = document.querySelectorAll(selector), active = document.activeElement;
  if (elements.length > 1) throw new Error(`Interaction selector must match one element: ${selector}`);
  const el = elements[0];
  if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || !el.getBoundingClientRect().width || !el.getBoundingClientRect().height || el.closest('[inert]')) return false;
  return active === el || (active?.contains(el) && el.id && active.getAttribute('aria-activedescendant') === el.id);
}

function widgetState({ selector, kind, selected, checked = [], visibility }) {
  const root = document.querySelector(selector), errors = [];
  if (!root) return kind === 'menus' && !checked.length ? [] : ['The declared widget or checked states are absent.'];
  if (!(kind === 'tabs' ? root.getAttribute('role') === 'tablist' : ['menu', 'menubar'].includes(root.getAttribute('role')))) return ['The widget role changed or is invalid.'];
  const { hasVisibleContent: visible } = visibility;
  if (kind === 'tabs') {
    const tabs = [...root.querySelectorAll('[role="tab"]')].filter(el => el.closest('[role="tablist"]') === root);
    const active = tabs.filter(el => el.getAttribute('aria-selected') === 'true');
    if (!tabs.length || active.length !== 1) errors.push('The tab list must have one selected tab.');
    if (selected && (!tabs.includes(document.querySelector(selected)) || active[0] !== document.querySelector(selected))) errors.push(`The selected tab does not match ${selected}.`);
    for (const tab of tabs) {
      const value = tab.getAttribute('aria-selected');
      if (!['true', 'false'].includes(value)) errors.push('A tab has no valid aria-selected state.');
      const ids = (tab.getAttribute('aria-controls') || '').trim().split(/\s+/).filter(Boolean);
      const panel = ids.length === 1 ? document.getElementById(ids[0]) : null;
      if (!panel || panel.getAttribute('role') !== 'tabpanel' || !tab.id || !(panel.getAttribute('aria-labelledby') || '').split(/\s+/).includes(tab.id)) errors.push('A tab needs a linked and labelled tabpanel.');
      else if (visible(panel) !== (value === 'true')) errors.push('Tab selection does not match panel visibility.');
      if (value === 'true' && !visible(tab)) errors.push('The selected tab is not visible.');
    }
  } else {
    const items = [...root.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="separator"]')];
    if (!items.some(el => el.getAttribute('role') !== 'separator')) errors.push('The menu has no items.');
    const groups = new Map(), separators = new Map();
    for (const el of items) {
      const menu = el.closest('[role="menu"], [role="menubar"]');
      if (el.getAttribute('role') === 'separator') { separators.set(menu, el); continue; }
      const role = el.getAttribute('role'), value = el.getAttribute('aria-checked');
      if (['menu', 'true'].includes(el.getAttribute('aria-haspopup'))) {
        const id = el.getAttribute('aria-controls');
        const submenu = id ? document.getElementById(id) : el.nextElementSibling;
        const expanded = el.getAttribute('aria-expanded');
        if (!['true', 'false'].includes(expanded) || (submenu?.getAttribute('role') === 'menu' ? visible(submenu) !== (expanded === 'true') : expanded !== 'false')) errors.push('A submenu state does not match its visibility.');
      }
      if (role === 'menuitem') continue;
      if (!(role === 'menuitemcheckbox' ? ['true', 'false', 'mixed'] : ['true', 'false']).includes(value)) errors.push('A menu choice has no valid aria-checked state.');
      if (role === 'menuitemradio' && value === 'true') {
        const group = el.closest('[role="group"]');
        const boundary = group && menu.contains(group) ? group : separators.get(menu) || menu;
        groups.set(boundary, (groups.get(boundary) || 0) + 1);
      }
    }
    if ([...groups.values()].some(count => count > 1)) errors.push('A menu radio group has more than one checked item.');
    for (const state of checked) {
      const el = document.querySelector(state.selector);
      if (!el || !root.contains(el) || !['menuitemradio', 'menuitemcheckbox'].includes(el.getAttribute('role')) || el.getAttribute('aria-checked') !== String(state.value)) errors.push(`The checked state does not match ${state.selector}: ${state.value}.`);
    }
  }
  return errors;
}

export async function runWidgets(page, plan, { target, record, wait, reach, shown, hidden, inspect, createVisibility }) {
  for (const kind of ['tabs', 'menus']) for (const [widgetIndex, item] of plan[kind].entries()) {
    // Validate every declared selector before this widget changes page state.
    const selectors = [item.selector, item.open, ...item.steps.flatMap(step => [step.focus, step.selected, step.outcome, ...(step.checked || []).map(state => state.selector)])].filter(Boolean);
    await page.evaluate(selectors => selectors.forEach(selector => document.querySelector(selector)), selectors);
    let opener;
    if (item.open) {
      opener = await target(item.open);
      const reached = await reach(opener);
      await record('keyboard-operation', item.open, reached, 'menu opener was not reached within the configured Tab limit', 'a keyboard-reachable menu opener', 'Review the tab order and configured limit.', { phase: 'menu-tab', ...(!reached ? { status: 'unresolved' } : {}) });
      if (!reached) continue;
      if (!await hidden(item.selector)) throw new Error(`Menu must be closed before its open action: ${item.selector}`);
      await page.keyboard.press(item.openKey || 'Enter');
      const opened = await shown(item.selector);
      await record('keyboard-operation', item.open, opened, 'the keyboard action did not open the menu', 'the planned menu to open', 'Connect the menu opener to its keyboard action.', { phase: 'menu-open' });
      if (inspect) await inspect(`menus[${widgetIndex}]: open`);
      if (!opened) continue;
    }
    const root = await target(item.selector);
    const role = await root.getAttribute('role');
    const validRole = kind === 'tabs' ? role === 'tablist' : item.open ? role === 'menu' : ['menu', 'menubar'].includes(role);
    await record('control-state', item.selector, validRole, `widget role is ${role}`, kind === 'tabs' ? 'role="tablist"' : item.open ? 'role="menu"' : 'role="menu" or "menubar"', 'Use the correct widget role.', { phase: 'widget-role' });
    if (!validRole) continue;
    const stateHandle = await page.evaluateHandle(`(${widgetState.toString()})`);
    const visibility = await page.evaluateHandle(`(${createVisibility.toString()})()`);
    try {
      // A handle keeps the app's global objects unchanged.
      const checkState = async (phase, step = {}) => {
        const witness = { selector: item.selector, kind, selected: step.selected, checked: step.checked, visibility };
        const passed = await wait(({ fn, witness }) => fn(witness).length === 0, { fn: stateHandle, witness });
        const errors = passed ? [] : await page.evaluate(widgetState, witness);
        await record('control-state', item.selector, passed, errors.join(' ') || 'widget state did not settle within the configured limit', 'valid widget selection and linked content', 'Update the declared selection, checked states, and panel visibility together.', { phase, ...(!passed && !errors.length ? { status: 'unresolved' } : {}) });
        if (opener) {
          const expanded = await wait(({ open, menu, visibility }) => {
            const trigger = document.querySelector(open), panel = document.querySelector(menu);
            const visible = visibility.hasVisibleContent(panel);
            return ['true', 'menu'].includes(trigger?.getAttribute('aria-haspopup')) && trigger.getAttribute('aria-expanded') === String(visible);
          }, { open: item.open, menu: item.selector, visibility });
          await record('control-state', item.open, expanded, 'menu opener state does not match menu visibility', 'aria-haspopup and aria-expanded to match the menu', 'Set aria-haspopup="menu" and update aria-expanded when the menu opens or closes.', { phase });
        }
      };
      await checkState('widget-baseline');
      if (item.open) {
        const entered = await wait(({ selector, last }) => {
          const root = document.querySelector(selector), active = document.activeElement;
          const items = [...root.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')].filter(el => el.closest('[role="menu"], [role="menubar"]') === root && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
          const expected = last ? items.at(-1) : items[0];
          return !!expected && (active === expected || (active === root && expected.id && root.getAttribute('aria-activedescendant') === expected.id));
        }, { selector: item.selector, last: item.openKey === 'ArrowUp' });
        await record('keyboard-operation', item.selector, entered, 'menu opening did not focus its entry item', 'focus on the first item, or the last item for ArrowUp', 'Move focus into the menu when it opens.', { phase: 'menu-entry' });
        if (!entered) continue;
      }
      const entry = await root.evaluate((el, kind) => {
        const active = document.activeElement;
        const items = [...el.querySelectorAll(kind === 'tabs' ? '[role="tab"]' : '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')].filter(child => child.closest('[role="tablist"], [role="menu"], [role="menubar"]') === el && child.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
        return { active: items.includes(active) || (active === el && items.some(child => child.id === el.getAttribute('aria-activedescendant'))) };
      }, kind);
      if (!item.open && !entry.active) {
        let entryTarget = root;
        if (!await root.evaluate(el => el.tabIndex >= 0 || el.hasAttribute('aria-activedescendant'))) {
          const items = root.locator(kind === 'tabs' ? '[role="tab"][aria-selected="true"]' : '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]').filter({ visible: true });
          const index = await items.evaluateAll((elements, kind) => elements.findIndex(el => kind === 'tabs' || el.tabIndex >= 0), kind);
          if (index < 0) {
            await record('keyboard-operation', item.selector, false, 'widget has no keyboard entry item', 'a keyboard-reachable widget', 'Use one tab stop or a focusable container for keyboard entry.', { phase: 'widget-tab' });
            continue;
          }
          entryTarget = items.nth(index);
        }
        if (await entryTarget.count() !== 1) throw new Error(`Widget needs a keyboard entry item: ${item.selector}`);
        const reached = await reach(entryTarget);
        await record('keyboard-operation', item.selector, reached, 'widget was not reached within the configured Tab limit', 'a keyboard-reachable widget', 'Use one tab stop or a focusable container for keyboard entry.', { phase: 'widget-tab', ...(!reached ? { status: 'unresolved' } : {}) });
        if (!reached) continue;
      }
      for (const [index, step] of item.steps.entries()) {
        if (await page.locator(step.focus).count()) await target(step.focus);
        if (step.selected) await target(step.selected);
        for (const check of step.checked || []) await target(check.selector);
        const phase = `${kind}-${index + 1}-${step.key}`;
        const matches = ({ selector, text }) => document.querySelector(selector)?.textContent.trim() === text;
        if (step.outcome) {
          await target(step.outcome);
          if (await page.evaluate(matches, { selector: step.outcome, text: step.expectedText })) throw new Error(`Menu outcome already matches before activation: ${step.outcome}`);
        }
        if (kind === 'tabs' && ['Enter', 'Space'].includes(step.key)) {
          const same = await page.evaluate(({ focus, selected }) => document.querySelector(focus) === document.querySelector(selected), step);
          if (!same || !await page.evaluate(hasFocus, step.selected)) throw new Error('Tab activation needs the focused tab as its selected target.');
        }
        if (kind === 'menus' && ['Enter', 'Space'].includes(step.key)) {
          const choice = await page.evaluate(({ checked, focus }) => {
            const active = document.activeElement;
            const el = active?.getAttribute('aria-activedescendant') ? document.getElementById(active.getAttribute('aria-activedescendant')) : active;
            const expected = checked.find(state => document.querySelector(state.selector) === el);
            return { role: el?.getAttribute('role'), disabled: el?.getAttribute('aria-disabled') === 'true' || el?.disabled, submenu: ['true', 'menu'].includes(el?.getAttribute('aria-haspopup')), declared: !!expected, expected: expected?.value, before: el?.getAttribute('aria-checked'), next: document.querySelector(focus) !== el };
          }, { checked: step.checked || [], focus: step.focus });
          if (['menuitemcheckbox', 'menuitemradio'].includes(choice.role) && !choice.declared) throw new Error('A menu choice activation needs its expected checked state.');
          if (!choice.disabled && choice.role === 'menuitemcheckbox' && String(choice.expected) === choice.before) throw new Error('Menu checkbox state already matches before activation.');
          if (!choice.disabled && choice.role === 'menuitemradio' && choice.expected !== true) throw new Error('Menu radio activation needs a true checked state.');
          if (choice.role === 'menuitem' && !choice.disabled && !step.outcome && !(choice.submenu && choice.next)) throw new Error('A menu action needs a declared outcome or submenu focus target.');
        }
        const previousChoices = kind === 'menus' && !['Enter', 'Space'].includes(step.key) ? await root.evaluateHandle(el => [...el.querySelectorAll('[role="menuitemcheckbox"], [role="menuitemradio"]')].map(el => ({ el, value: el.getAttribute('aria-checked') }))) : null;
        const closingMenu = kind === 'menus' && ['Escape', 'Tab', 'Shift+Tab'].includes(step.key) ? await page.evaluateHandle(({ selector, key }) => {
          const root = document.querySelector(selector), active = document.activeElement;
          const el = active?.getAttribute('aria-activedescendant') ? document.getElementById(active.getAttribute('aria-activedescendant')) : active;
          const menu = key === 'Escape' ? el?.closest('[role="menu"]') : (root.getAttribute('role') === 'menu' ? root : el?.closest('[role="menu"]'));
          return { menu, id: menu?.id, root: menu === root };
        }, { selector: item.selector, key: step.key }) : null;
        try {
          await page.keyboard.press(step.key);
          const moved = await wait(hasFocus, step.focus);
          await record('keyboard-operation', item.selector, moved, `${step.key} did not focus ${step.focus}`, `${step.key} to focus ${step.focus}`, 'Handle the declared key and update focus or aria-activedescendant.', { phase, focusSelector: step.focus });
          await checkState(phase, step);
          if (closingMenu) {
            const closure = ({ closing, selector, visibility }) => {
              if (!closing.menu) return 'passed';
              const current = closing.menu.isConnected ? closing.menu : closing.root ? document.querySelector(selector) : closing.id ? document.getElementById(closing.id) : null;
              if (!current && !closing.root && !closing.id) return 'unresolved';
              return visibility.hasVisibleContent(current) ? 'failed' : 'passed';
            };
            const witness = { closing: closingMenu, selector: item.selector, visibility };
            const closureHandle = await page.evaluateHandle(`(${closure.toString()})`);
            let closed;
            try { closed = await wait(value => value.fn(value.witness) === 'passed', { fn: closureHandle, witness }); }
            finally { await closureHandle.dispose(); }
            const status = closed ? 'passed' : await page.evaluate(closure, witness);
            await record('keyboard-operation', item.selector, status === 'passed', status === 'unresolved' ? 'the removed submenu has no stable ID to check its replacement' : 'the exit key left the menu open', `${step.key} to close the menu`, 'Close the menu and put focus on the declared return control. Give replaced submenus stable IDs.', { phase, status });
          }
          if (previousChoices) {
            const unchanged = await page.evaluate(({ states, selector }) => {
              const root = document.querySelector(selector);
              if (!root) return 'passed';
              let status = 'passed';
              for (const { el, value } of states) {
                const current = el.isConnected ? el : el.id ? document.getElementById(el.id) : null;
                if (!current || !root.contains(current)) status = 'unresolved';
                else if (current.getAttribute('aria-checked') !== value) return 'failed';
              }
              return status;
            }, { states: previousChoices, selector: item.selector });
            await record('control-state', item.selector, unchanged === 'passed', unchanged === 'unresolved' ? 'navigation replaced choices without stable IDs' : 'navigation changed a menu choice', 'navigation to keep checked states unchanged', 'Change menu choices only on activation. Give replaced choices stable IDs.', { phase, status: unchanged });
          }
          if (step.outcome) await record('keyboard-operation', item.selector, await wait(matches, { selector: step.outcome, text: step.expectedText }), 'menu action did not produce the declared result', `text "${step.expectedText}" at ${step.outcome}`, 'Connect the menu action to the declared result.', { phase, outcomeSelector: step.outcome });
          if (inspect) await inspect(`${kind}[${widgetIndex}]: step ${index + 1} ${step.key}`);
          // Stop when focus is wrong so later keys cannot activate unrelated controls.
          if (!moved) break;
        } finally { if (previousChoices) await previousChoices.dispose(); if (closingMenu) await closingMenu.dispose(); }
      }
    } finally { await Promise.all([stateHandle.dispose(), visibility.dispose()]); }
  }
}
