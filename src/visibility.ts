// Runs in the browser. A semantic group can be visible without its own box.
export function createVisibility() {
  const textRects = (el: Element) => {
    const rects: DOMRect[] = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...[...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0));
    }
    return rects;
  };
  const generatedTextStyles = (el: Element) => ['::before', '::after'].flatMap(pseudo => {
    const style = getComputedStyle(el, pseudo);
    const fragments: string[] = [];
    for (const token of style.content.match(/"(?:[^"\\]|\\.)*"|[a-z-]+\((?:[^()"\\]|"(?:[^"\\]|\\.)*")*\)|\/|\S+/gi) ?? []) {
      if (token === '/') break;
      const literal = token.startsWith('"') ? token.slice(1, -1) : null;
      fragments.push(literal?.replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_: string, hex: string | undefined, escaped: string) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : escaped) ?? '\0');
    }
    const text = fragments.some(fragment => fragment !== '\0' && fragment.trim()) ? fragments.join('') : '';
    const counter = [...style.content.matchAll(/(?:^|\s)(counters?\([^)]*\))/g)].some(([, value]) => !/,\s*none\)$/.test(value));
    if ((!text.trim() && !counter) || style.display === 'none' || style.visibility !== 'visible' || (style.display !== 'contents' && parseFloat(style.opacity) === 0) || parseFloat(style.fontSize) === 0) return [];
    return [{ pseudo, style, text }];
  });
  const generatedTextRects = (el: Element) => {
    let unresolved = false;
    const rects = generatedTextStyles(el).flatMap(({ pseudo, style, text }) => {
      // shortcut: Counter text needs review inside clips; add browser text geometry to measure it.
      if (!text || text.includes('\0')) { unresolved = true; return []; }
      const span = document.createElement('span');
      for (const property of style) span.style.setProperty(property, style.getPropertyValue(property), 'important');
      span.style.setProperty('content', 'normal', 'important');
      span.textContent = text;
      const attribute = 'data-lintapple-measure';
      const previous = el.getAttribute(attribute);
      const token = Math.random().toString(36).slice(2);
      const sheets = [...document.adoptedStyleSheets];
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`[${attribute}="${token}"]${pseudo}{content:none!important}[${attribute}="${token}-text"]::before,[${attribute}="${token}-text"]::after{content:none!important}`);
      span.setAttribute(attribute, `${token}-text`);
      try {
        el.setAttribute(attribute, token);
        document.adoptedStyleSheets = [...sheets, sheet];
        if (getComputedStyle(el, pseudo).content !== 'none') { unresolved = true; return []; }
        el.insertBefore(span, pseudo === '::before' ? el.firstChild : null);
        return textRects(span);
      } finally {
        span.remove();
        document.adoptedStyleSheets = sheets;
        if (previous === null) el.removeAttribute(attribute); else el.setAttribute(attribute, previous);
      }
    });
    return unresolved ? null : rects;
  };
  const visible = (el: Element | null | undefined): boolean => {
    if (!el?.isConnected || el.closest('[inert]')) return false;
    const bounds = el.getBoundingClientRect();
    const boxVisible = el.checkVisibility({ checkVisibilityCSS: true }) && bounds.width > 0 && bounds.height > 0;
    if (!boxVisible && !generatedTextStyles(el).length && (getComputedStyle(el).visibility !== 'visible' || !textRects(el).length)) return false;
    // Boxless elements can paint text. Opacity applies only to ancestor boxes.
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node instanceof HTMLDetailsElement && !node.open && el !== node) {
        const summary: Element | undefined = [...node.children].find(child => child.tagName === 'SUMMARY');
        if (!summary?.contains(el)) return false;
      }
      if (style.display === 'none' || (style.display !== 'contents' && (style.contentVisibility === 'hidden' || parseFloat(style.opacity) === 0))) return false;
    }
    return true;
  };
  const hasVisibleContent = (el: Element | null | undefined): boolean => !!el?.isConnected && (visible(el) || [...el.querySelectorAll('*')].some(visible));
  return { textRects, generatedTextRects, visible, hasVisibleContent, generatedTextStyles };
}
