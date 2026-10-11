// Runs in the browser. Use one report shape for all design rules.
export async function audit({ policy, contrast, accessibility, format, visibility }) {
  for (const rule of [...policy.typeRules, ...policy.controlSizeRules, ...policy.exceptions]) document.querySelector(rule.selector);
  for (const container of policy.controlContainers) document.querySelector(container);
  const findings = [];
  const selector = element => {
    const parts = [];
    for (let node = element; node; node = node.parentElement) {
      const tag = node.tagName.toLowerCase();
      if (node === document.documentElement) { parts.unshift(tag); break; }
      const siblings = [...node.parentElement.children].filter(s => s.tagName === node.tagName);
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
    }
    return parts.join(' > ');
  };
  const add = (rule, element, actual, expected, fix, related, details = {}) => {
    const exception = policy.exceptions.find(e => e.rules.includes(rule) && element.matches(e.selector));
    if (exception) { suppressed.push({ rule, selector: selector(element), reason: exception.reason }); return; }
    findings.push(format(rule, selector(element), actual, expected, fix, { ...(related ? { relatedSelector: selector(related) } : {}), ...details }));
  };
  const suppressed = [];
  const { textRects, visible, hasVisibleContent, generatedTextStyles } = visibility;
  const elements = [...document.querySelectorAll('body, body *')].filter(visible);
  if (!elements.length) throw new Error('Page has no visible body. Wait for the interface before checking it.');
  if (elements.length > 5000) throw new Error('Page exceeds the 5000 element limit. Check a smaller page or component.');
  const styles = new Map(elements.map(el => [el, getComputedStyle(el)]));
  const controls = elements.filter(el => el.matches('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]'));
  const isText = el => [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) || el.matches('input, textarea, select');
  const checkFontSize = (el, style, pseudo = '') => {
    const size = parseFloat(style.fontSize);
    const sizes = policy.typeRules.find(rule => el.closest(rule.selector))?.sizes ?? policy.fontSizes;
    if (!sizes.some(allowed => Math.abs(size - allowed) < 0.1))
      add('font-size', el, `${size}px`, `one of ${sizes.join(', ')}px`, 'Use a configured size for this text role.', undefined, { selector: `${selector(el)}${pseudo}` });
  };
  let numericElements = 0;
  for (const el of elements) {
    const style = styles.get(el);
    if (isText(el) && !el.closest('pre, code, kbd, samp')) {
      const family = style.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (!policy.fonts.some(font => font.toLowerCase() === family.toLowerCase()))
        add('font-family', el, family, `one of ${policy.fonts.join(', ')}`, 'Use the approved interface font.');
      checkFontSize(el, style);
    }
    if (!el.closest('pre, code, kbd, samp'))
      for (const { pseudo, style: textStyle } of generatedTextStyles(el)) checkFontSize(el, textStyle, pseudo);
    // Numeric meaning is explicit for live values. Numeric table cells are inferred.
    const numericCell = el.matches('td') && /^[+−-]?[\d\s,.:%$€£]+$/.test(el.textContent.trim()) && /\d/.test(el.textContent);
    if (el.matches('[data-ui-number]') || numericCell) {
      numericElements++;
      if (!style.fontVariantNumeric.split(/\s+/).includes('tabular-nums') && !/['"]tnum['"](?:\s+(?:1|on))?(?:\s*,|$)/.test(style.fontFeatureSettings))
        add('tabular-numbers', el, style.fontVariantNumeric, 'tabular digits', 'Set font-variant-numeric: tabular-nums. Use a font that supports tabular figures.');
      if (numericCell && style.textAlign !== 'right' && style.textAlign !== (style.direction === 'rtl' ? 'start' : 'end'))
        add('numeric-alignment', el, style.textAlign, 'right-aligned numeric table cells', 'Set text-align: right on the numeric column.');
    }
  }
  const copyText = new Map();
  const textOf = el => {
    if (copyText.has(el)) return copyText.get(el);
    if (el.matches('pre, code, kbd, samp')) return '\0';
    if (!hasVisibleContent(el)) return '';
    const text = (el.matches('input[type="button"], input[type="submit"], input[type="reset"]') ? el.value : [...el.childNodes].map(node => {
      if (node.nodeType === Node.TEXT_NODE) return visible(el) ? node.textContent : '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (node.tagName === 'BR') return '\n';
      const content = textOf(node);
      const display = getComputedStyle(node).display;
      return display.startsWith('inline') || display === 'contents' ? content : `\n${content}\n`;
    }).join('')).replace(/\s+/g, ' ').toLowerCase();
    copyText.set(el, text);
    return text;
  };
  for (const el of elements.filter(el => !el.closest('pre, code, kbd, samp'))) {
    for (const phrase of policy.bannedCopy) {
      const normalized = phrase.replace(/\s+/g, ' ').toLowerCase();
      if (textOf(el).includes(normalized) && ![...el.children].some(child => textOf(child).includes(normalized)))
        add('copy', el, phrase, 'text without prohibited phrases', 'Remove the phrase or use specific text that helps the user.');
    }
  }
  for (const el of controls) {
    const rect = el.getBoundingClientRect();
    const minimum = policy.controlSizeRules.find(rule => el.matches(rule.selector) && innerWidth >= (rule.minViewportWidth ?? 1) && innerWidth <= (rule.maxViewportWidth ?? 10000))?.minSize ?? policy.minControlSize;
    if (rect.width + 0.1 < minimum || rect.height + 0.1 < minimum)
      add('control-size', el, `${Number(rect.width.toFixed(2))} × ${Number(rect.height.toFixed(2))}px`, `at least ${minimum}px in each dimension`, 'Increase the control hit area.');
  }
  const groups = new Map();
  for (const el of controls) {
    const parent = el.closest('[data-ui-actions]') ?? el.parentElement;
    const list = groups.get(parent) ?? [];
    list.push(el); groups.set(parent, list);
  }
  // Use the same geometry for control groups and component stacks.
  const checkGap = (group, rule, minimum) => {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i].getBoundingClientRect(), b = group[j].getBoundingClientRect();
      const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const gap = yOverlap > 0 ? Math.max(a.left - b.right, b.left - a.right) : xOverlap > 0 ? Math.max(a.top - b.bottom, b.top - a.bottom) : Infinity;
      if (gap + 0.1 < minimum)
        add(rule, group[i], `${Number(gap.toFixed(2))}px`, `a gap of at least ${minimum}px`, 'Use a layout group with an approved gap. Check for overlap.', group[j]);
    }
  };
  for (const group of groups.values()) checkGap(group, 'control-gap', policy.minControlGap);
  for (const el of [...document.querySelectorAll('[data-ui-stack]')].filter(hasVisibleContent))
    checkGap([...el.children].filter(visible), 'layout-gap', policy.minLayoutGap);
  let alignmentGroups = 0;
  for (const group of [...document.querySelectorAll('[data-ui-align]')].filter(hasVisibleContent)) {
    const alignment = group.getAttribute('data-ui-align');
    const items = [...group.querySelectorAll('[data-ui-align-item]')].filter(el => el.closest('[data-ui-align]') === group);
    if (!['start', 'center', 'end'].includes(alignment) || items.length < 2) {
      add('layout-alignment', group, `${alignment || 'empty alignment'} with ${items.length} marked items`, 'start, center, or end alignment with at least two marked items', 'Set data-ui-align and mark the elements that must align with data-ui-align-item.');
      continue;
    }
    const targets = items.filter(visible);
    if (targets.length < 2) continue;
    alignmentGroups++;
    const rtl = getComputedStyle(group).direction === 'rtl';
    const position = element => {
      const rect = element.getBoundingClientRect();
      return alignment === 'center' ? (rect.left + rect.right) / 2 : rect[(alignment === 'start') !== rtl ? 'left' : 'right'];
    };
    const reference = targets[0];
    for (const target of targets.slice(1)) {
      const distance = Math.abs(position(target) - position(reference));
      if (distance > 1)
        add('layout-alignment', target, `${Number(distance.toFixed(2))}px horizontal misalignment`, `horizontal ${alignment} alignment within 1px`, 'Align the marked elements. Use matching margins and container padding.', reference);
    }
  }
  const edgeInsets = (outer, inner) => ({
    left: inner.left - outer.left,
    top: inner.top - outer.top,
    right: outer.right - inner.right,
    bottom: outer.bottom - inner.bottom,
  });
  const scaleFor = container => {
    const bounds = container.getBoundingClientRect();
    const style = styles.get(container) ?? getComputedStyle(container);
    const length = axis => {
      const edges = axis === 'width' ? ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] : ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'];
      return parseFloat(style[axis]) + (style.boxSizing === 'border-box' ? 0 : edges.reduce((sum, key) => sum + parseFloat(style[key]), 0));
    };
    return { x: bounds.width / (length('width') || container.offsetWidth), y: bounds.height / (length('height') || container.offsetHeight) };
  };
  // One client-box primitive for control insets and text clipping.
  const clientBounds = container => {
    const bounds = container.getBoundingClientRect();
    // Client dimensions use rounded layout pixels, so their scale uses offset dimensions.
    const scaleX = container.offsetWidth ? bounds.width / container.offsetWidth : 1;
    const scaleY = container.offsetHeight ? bounds.height / container.offsetHeight : 1;
    const left = bounds.left + container.clientLeft * scaleX;
    const top = bounds.top + container.clientTop * scaleY;
    const result = { left, top, right: left + container.clientWidth * scaleX, bottom: top + container.clientHeight * scaleY };
    if (!Object.values(result).every(Number.isFinite)) throw new Error('A clipping or control container must have a measurable HTML box.');
    return result;
  };
  let insetControls = 0;
  for (const el of controls) {
    const container = el.parentElement.closest(policy.controlContainers.join(', '));
    if (!container || !visible(container)) continue;
    insetControls++;
    const innerBounds = clientBounds(container);
    for (const [edge, distance] of Object.entries(edgeInsets(innerBounds, el.getBoundingClientRect()))) {
      if (distance + 0.1 < policy.minControlInset)
        add('control-inset', el, `${edge} inset ${Number(distance.toFixed(2))}px`, `at least ${policy.minControlInset}px from the container's inner ${edge} edge`, 'Add container padding or correct the button position. Check absolute offsets, transforms, and negative margins.', container);
    }
  }
  for (const outer of elements.filter(el => el.matches('[data-ui-radius]'))) {
    const inner = [...outer.children].find(el => el.matches('[data-ui-radius-inner]') && visible(el));
    if (!inner) { add('nested-radius', outer, 'no visible direct inner element', 'a direct child with data-ui-radius-inner', 'Mark the inner surface or remove the radius contract.'); continue; }
    const a = outer.getBoundingClientRect(), b = inner.getBoundingClientRect();
    const insets = Object.values(edgeInsets(a, b));
    const corners = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];
    const outerValues = corners.map(key => styles.get(outer)[key]);
    const innerValues = corners.map(key => getComputedStyle(inner)[key]);
    const outerScale = scaleFor(outer), innerScale = scaleFor(inner);
    if ([outerScale, innerScale].some(scale => !Number.isFinite(scale.x) || !Number.isFinite(scale.y) || Math.abs(scale.x - scale.y) > 0.01) || insets.some(n => n < 0 || Math.abs(n - insets[0]) > 1) || [...outerValues, ...innerValues].some(n => !/^\d+(?:\.\d+)?px$/.test(n)) || new Set(outerValues).size !== 1 || new Set(innerValues).size !== 1) {
      add('nested-radius', outer, 'unequal insets or unsupported corner shapes', 'equal insets and circular pixel radii', 'Use this contract only for concentric, equally inset surfaces. Use a reasoned exception for other shapes.');
      continue;
    }
    const expected = Math.max(0, parseFloat(outerValues[0]) * outerScale.x - insets[0]);
    if (Math.abs(parseFloat(innerValues[0]) * innerScale.x - expected) > 1)
      add('nested-radius', inner, innerValues[0], `${Number((expected / innerScale.x).toFixed(2))}px inner radius`, 'Set the inner radius to max(0px, outer radius minus the inset). The inset includes the border.');
  }
  const styleOf = el => styles.get(el) ?? getComputedStyle(el);
  const scrolls = (node, axis) => !['inline', 'contents'].includes(styleOf(node).display) && /^(auto|scroll)$/.test(styleOf(node)[`overflow${axis}`]);
  const scrollsWithin = (ancestors, clip, axis) => {
    for (const node of ancestors) {
      if (node === clip.element || !clip.element.contains(node)) break;
      if (!scrolls(node, axis)) continue;
      const bounds = node.getBoundingClientRect();
      const edges = axis === 'X' ? ['left', 'right'] : ['top', 'bottom'];
      if (bounds[edges[0]] >= clip.bounds[edges[0]] - 1 && bounds[edges[1]] <= clip.bounds[edges[1]] + 1) return true;
    }
    return false;
  };
  const viewport = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight };
  const contextFor = el => {
    const ancestors = [];
    let containingBlock = null;
    let overlay = false;
    for (let node = el; node; node = node.parentElement) {
      overlay ||= styleOf(node).position === 'fixed' || node.matches('dialog[open], [role="dialog"], [role="alertdialog"], [data-ui-overlay]');
      // Overflow below an absolute box's containing block cannot clip that box.
      if (containingBlock && node !== containingBlock) continue;
      ancestors.push(node);
      // A viewport-fixed box escapes ordinary ancestor scrolling and clipping.
      if (styleOf(node).position === 'fixed') break;
      containingBlock = styleOf(node).position === 'absolute' ? node.offsetParent ?? document.documentElement : null;
    }
    const clips = ancestors.filter(node => node instanceof HTMLElement && !['inline', 'contents'].includes(styleOf(node).display)).map(node => ({
      element: node,
      x: /^(hidden|clip)$/.test(styleOf(node).overflowX),
      y: /^(hidden|clip)$/.test(styleOf(node).overflowY),
    })).filter(clip => clip.x || clip.y).map(clip => ({ ...clip, bounds: clientBounds(clip.element) }));
    return {
      ancestors,
      clips,
      overlay,
      boxScrollX: ancestors.slice(1).some(node => scrolls(node, 'X') && node !== document.body && node !== document.documentElement),
      boxScrollY: ancestors.slice(1).some(node => scrolls(node, 'Y') && node !== document.body && node !== document.documentElement),
      textScrollX: ancestors.some(node => scrolls(node, 'X') && node !== document.body && node !== document.documentElement),
      textScrollY: ancestors.some(node => scrolls(node, 'Y') && node !== document.body && node !== document.documentElement),
    };
  };
  const outside = (bounds, rect, x, y) => Object.entries(edgeInsets(bounds, rect)).filter(([edge, distance]) => distance < -1 && ((edge === 'left' || edge === 'right') ? x : y));
  const clippedRect = (rect, clips, el, includeSelf) => {
    const result = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    for (const clip of clips) {
      if ((!includeSelf && clip.element === el) || clip.element === document.body || clip.element === document.documentElement) continue;
      if (clip.x) { result.left = Math.max(result.left, clip.bounds.left); result.right = Math.min(result.right, clip.bounds.right); }
      if (clip.y) { result.top = Math.max(result.top, clip.bounds.top); result.bottom = Math.min(result.bottom, clip.bounds.bottom); }
    }
    return result;
  };
  for (const el of elements.filter(el => el instanceof HTMLElement || el.tagName.toLowerCase() === 'svg')) {
    const context = contextFor(el);
    const rects = textRects(el);
    const escaped = new Map();
    for (const [rect, scrollX, scrollY, isTextRect] of [[el.getBoundingClientRect(), context.boxScrollX, context.boxScrollY, false], ...rects.map(rect => [rect, context.textScrollX, context.textScrollY, true])]) {
      const painted = clippedRect(rect, context.clips, el, isTextRect);
      if (painted.left >= painted.right || painted.top >= painted.bottom) continue;
      for (const [edge, distance] of outside(viewport, painted, !scrollX, context.overlay && !scrollY))
        escaped.set(edge, Math.max(escaped.get(edge) ?? 0, -distance));
    }
    if (escaped.size)
      add('viewport-bounds', el, [...escaped].map(([edge, amount]) => `${edge} overflow ${Number(amount.toFixed(2))}px`).join(', '), 'content inside the horizontal viewport; fixed elements and open overlays also fit vertically', 'Use responsive widths and wrapping. Constrain the overlay size and use a local scroll region for long content.');
    const container = el.closest('[data-ui-content]');
    if (container && rects.length) {
      const contract = { element: container, bounds: clientBounds(container) };
      const overflow = new Map();
      const checkX = !(context.ancestors.includes(container) && scrolls(container, 'X')) && !scrollsWithin(context.ancestors, contract, 'X');
      const checkY = !(context.ancestors.includes(container) && scrolls(container, 'Y')) && !scrollsWithin(context.ancestors, contract, 'Y');
      for (const rect of rects) {
        const painted = clippedRect(rect, context.clips, el, true);
        if (painted.left >= painted.right || painted.top >= painted.bottom) continue;
        for (const [edge, distance] of outside(contract.bounds, painted, checkX, checkY))
          overflow.set(edge, Math.max(overflow.get(edge) ?? 0, -distance));
      }
      if (overflow.size)
        add('content-overflow', el, [...overflow].map(([edge, amount]) => `${edge} text overflow ${Number(amount.toFixed(2))}px`).join(', '), 'text inside the nearest data-ui-content container', 'Let text wrap or provide a local scroll region inside the marked container.', container);
    }
    for (const clip of context.clips) {
      const cut = new Map();
      for (const rect of rects) for (const [edge, distance] of outside(clip.bounds, rect, clip.x && !scrollsWithin(context.ancestors, clip, 'X'), clip.y && !scrollsWithin(context.ancestors, clip, 'Y')))
        cut.set(edge, Math.max(cut.get(edge) ?? 0, -distance));
      if (cut.size)
        add('content-clipping', el, [...cut].map(([edge, amount]) => `${edge} text clipping ${Number(amount.toFixed(2))}px`).join(', '), 'text lines inside the clipping area', 'Allow text to wrap, increase the container size, or provide a local scroll region. Use a reasoned exception for intentional truncation.', clip.element);
    }
  }
  const root = document.documentElement;
  const background = getComputedStyle(root).backgroundColor;
  if (background === 'transparent' || /(?:,\s*0\s*\)|\/\s*0(?:%|\s*\)))/.test(background))
    add('root-background', root, background, 'an explicit root background color', 'Set the page background on html. Use the active theme color.');
  const overflow = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0) - root.clientWidth;
  if (overflow > 1) add('horizontal-overflow', root, `${overflow}px of overflow`, 'no page-level horizontal overflow', 'Fix the element that is wider than the page. Use a local scroll region for wide content.');
  for (const font of document.fonts) {
    if (font.status === 'error') add('font-loading', root, `failed font ${font.family}`, 'all requested font files to load', 'Fix the font URL or font file.');
  }
  // A single character can be meaningful text, such as a counter or initial.
  contrast.configure({ checks: [{ id: 'color-contrast', options: {
    ignoreUnicode: true, ignoreLength: true, ignorePseudo: false,
    boldValue: 700, boldTextPt: 14, largeTextPt: 18,
    contrastRatio: { normal: { expected: 4.5 }, large: { expected: 3 } },
    pseudoSizeThreshold: 0.25, shadowOutlineEmMax: 0.2, textStrokeEmMin: 0.03,
  } }] });
  const contrastResult = await contrast.run(document, {
    runOnly: ['color-contrast'], iframes: false, elementRef: true,
    resultTypes: ['violations', 'incomplete'],
  });
  const inScope = new Set(elements);
  const reportContrast = (el, status, data, reason) => {
    const required = parseFloat(data.expectedContrastRatio);
    const actual = status === 'failed' ? `${data.contrastRatio}:1 text contrast (foreground ${data.fgColor}, background ${data.bgColor})` : `contrast could not be measured: ${reason ?? 'background or text needs review'}`;
    add('text-contrast', el, actual, Number.isFinite(required) ? `text contrast of at least ${required}:1` : 'a measurable WCAG AA text contrast ratio',
      status === 'failed' ? 'Increase the contrast between the text and its background. Check text color, opacity, and background layers.' : 'Use a measurable background or review the text and background. Record a scoped exception with a reason after review.',
      null, { status, ...(Number.isFinite(required) ? { requiredContrastRatio: required } : {}), ...(status === 'failed' ? { contrastRatio: data.contrastRatio, foreground: data.fgColor, background: data.bgColor } : {}) });
  };
  for (const [status, results] of [['failed', contrastResult.violations], ['unresolved', contrastResult.incomplete]]) {
    for (const result of results) for (const node of result.nodes) {
      const el = node.element;
      if (!inScope.has(el) || !visible(el)) continue;
      const check = [...node.any, ...node.all, ...node.none].find(check => check.id === 'color-contrast');
      const data = check?.data ?? {};
      reportContrast(el, status, data, check?.message ?? node.failureSummary);
    }
  }
  // axe checks input text color, not the separately styled placeholder.
  // Use its color and background primitives without changing form values.
  contrast.setup(document);
  try {
    for (const el of elements.filter(el => textRects(el).length && (!el.getBoundingClientRect().width || !el.getBoundingClientRect().height) && !el.closest(':disabled, [aria-disabled="true"]'))) {
      const style = styles.get(el);
      const required = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontWeight) >= 700 && parseFloat(style.fontSize) >= 56 / 3) ? 3 : 4.5;
      const data = { expectedContrastRatio: `${required}:1` };
      const rects = textRects(el);
      let box = el.parentElement, unsupported = false;
      while (box && rects.some(rect => outside(box.getBoundingClientRect(), rect, true, true).length)) box = box.parentElement;
      for (let node = el; node; node = node.parentElement) {
        const nodeStyle = styleOf(node);
        if ((nodeStyle.display !== 'contents' && parseFloat(nodeStyle.opacity) !== 1) || nodeStyle.filter !== 'none' || nodeStyle.backdropFilter !== 'none' || nodeStyle.mixBlendMode !== 'normal' || nodeStyle.textShadow !== 'none' || parseFloat(nodeStyle.webkitTextStrokeWidth) > 0) unsupported = true;
        if (box && node !== box && box.contains(node) && nodeStyle.display !== 'contents') {
          const bounds = node.getBoundingClientRect();
          if (rects.some(rect => bounds.left < rect.right && bounds.right > rect.left && bounds.top < rect.bottom && bounds.bottom > rect.top)) {
            try { if (nodeStyle.backgroundImage !== 'none' || new contrast.commons.color.Color().parseString(nodeStyle.backgroundColor).alpha > 0) unsupported = true; }
            catch { unsupported = true; }
          }
        }
        for (const pseudo of ['::before', '::after']) {
          if (!['none', 'normal'].includes(getComputedStyle(node, pseudo).content)) unsupported = true;
        }
      }
      // The ancestor background is valid only when no other painted box overlaps the text.
      if (elements.some(node => node !== el && !node.contains(el) && rects.some(rect => {
        const bounds = node.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 && bounds.left < rect.right && bounds.right > rect.left && bounds.top < rect.bottom && bounds.bottom > rect.top;
      }))) unsupported = true;
      if (!box || unsupported) { reportContrast(el, 'unresolved', data, 'boxless text effects or background layers need review'); continue; }
      try {
        let background = contrast.commons.color.getBackgroundColor(box);
        if (!background && box === root && styleOf(root).backgroundImage === 'none') {
          background = new contrast.commons.color.Color().parseString(styleOf(root).backgroundColor);
          if (background.alpha !== 1) background = null;
        }
        if (!background) { reportContrast(el, 'unresolved', data, 'boxless text background needs review'); continue; }
        const foreground = new contrast.commons.color.Color().parseString(style.webkitTextFillColor || style.color);
        const blended = contrast.commons.color.flattenColors(foreground, background);
        const ratio = contrast.commons.color.getContrast(background, blended);
        if (!Number.isFinite(ratio)) { reportContrast(el, 'unresolved', data, 'boxless text color could not be parsed'); continue; }
        if (ratio < required) reportContrast(el, 'failed', { ...data, contrastRatio: Math.floor(ratio * 100) / 100, fgColor: blended.toHexString(), bgColor: background.toHexString() });
      } catch (error) { reportContrast(el, 'unresolved', data, `boxless text calculation failed: ${error.message}`); }
    }
    for (const el of elements.filter(el => el.matches('input:placeholder-shown, textarea:placeholder-shown') && !el.matches(':disabled') && !el.closest('[aria-disabled="true"]'))) {
      const style = getComputedStyle(el, '::placeholder');
      const size = parseFloat(style.fontSize), bold = parseFloat(style.fontWeight) >= 700;
      const required = size >= 24 || (bold && size >= 56 / 3) ? 3 : 4.5;
      const data = { expectedContrastRatio: `${required}:1` };
      let unsupported = false;
      for (let node = el; node; node = node.parentElement) {
        const nodeStyle = getComputedStyle(node);
        if (parseFloat(nodeStyle.opacity) !== 1 || nodeStyle.filter !== 'none' || nodeStyle.backdropFilter !== 'none' || nodeStyle.mixBlendMode !== 'normal') unsupported = true;
      }
      if (unsupported || style.textShadow !== 'none' || style.filter !== 'none' || style.mixBlendMode !== 'normal') {
        reportContrast(el, 'unresolved', data, 'placeholder opacity, filters, blend modes, or text shadows need review');
        continue;
      }
      try {
        const background = contrast.commons.color.getBackgroundColor(el);
        if (!background) { reportContrast(el, 'unresolved', data, 'placeholder background needs review'); continue; }
        const foreground = new contrast.commons.color.Color().parseString(style.color);
        foreground.alpha *= parseFloat(style.opacity);
        const blended = contrast.commons.color.flattenColors(foreground, background);
        const ratio = contrast.commons.color.getContrast(background, blended);
        if (!Number.isFinite(ratio)) { reportContrast(el, 'unresolved', data, 'placeholder color could not be parsed'); continue; }
        if (ratio < required) reportContrast(el, 'failed', { ...data, contrastRatio: Math.floor(ratio * 100) / 100, fgColor: blended.toHexString(), bgColor: background.toHexString() });
      } catch (error) { reportContrast(el, 'unresolved', data, `placeholder calculation failed: ${error.message}`); }
    }
  } finally { contrast.teardown(); }
  const accessibilityCoverage = await accessibility({ elements, controls, visible, hasVisibleContent, add, engine: contrast });
  return { findings, suppressed, accessibilityCoverage, elements: elements.length, controls: controls.length, insetControls, numericElements, alignmentGroups, radiusContracts: elements.filter(el => el.matches('[data-ui-radius]')).length };
}
