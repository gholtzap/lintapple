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
    const literal = style.content.match(/^"((?:[^"\\]|\\.)*)"/)?.[1];
    const text = literal?.replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_: string, hex: string | undefined, escaped: string) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : escaped);
    if (!text?.trim() || style.display === 'none' || style.visibility !== 'visible' || (style.display !== 'contents' && parseFloat(style.opacity) === 0) || parseFloat(style.fontSize) === 0) return [];
    return [{ pseudo, style }];
  });
  const visible = (el: Element | null | undefined): boolean => {
    if (!el?.isConnected || el.closest('[inert]')) return false;
    const bounds = el.getBoundingClientRect();
    if (el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && bounds.width > 0 && bounds.height > 0) return true;
    if (!generatedTextStyles(el).length && (getComputedStyle(el).visibility !== 'visible' || !textRects(el).length)) return false;
    // Boxless elements can paint text. Opacity applies only to ancestor boxes.
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.contentVisibility === 'hidden' || (style.display !== 'contents' && parseFloat(style.opacity) === 0)) return false;
    }
    return true;
  };
  const hasVisibleContent = (el: Element | null | undefined): boolean => !!el?.isConnected && (visible(el) || [...el.querySelectorAll('*')].some(visible));
  return { textRects, visible, hasVisibleContent, generatedTextStyles };
}
