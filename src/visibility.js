// Runs in the browser. A semantic group can be visible without its own box.
export function createVisibility() {
  const textRects = el => {
    const rects = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...[...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0));
    }
    return rects;
  };
  const visible = el => {
    if (!el?.isConnected || el.closest('[inert]')) return false;
    const bounds = el.getBoundingClientRect();
    if (el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && bounds.width > 0 && bounds.height > 0) return true;
    if (getComputedStyle(el).visibility !== 'visible' || !textRects(el).length) return false;
    // Boxless elements can paint text. Opacity applies only to ancestor boxes.
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.contentVisibility === 'hidden' || (style.display !== 'contents' && parseFloat(style.opacity) === 0)) return false;
    }
    return true;
  };
  const hasVisibleContent = el => !!el?.isConnected && (visible(el) || [...el.querySelectorAll('*')].some(visible));
  return { textRects, visible, hasVisibleContent };
}
