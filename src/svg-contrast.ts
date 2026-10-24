import type { Page, Frame } from 'playwright';
import type { SvgContrast } from './types.js';
// Rasterize only SVG text whose foreground has a known solid paint.
// The black/white pair identifies glyph pixels; hidden text reveals their actual background.
export async function svgTextContrast(page: Page | Frame): Promise<SvgContrast[]> {
  const results: SvgContrast[] = [];
  for (const svg of await page.$$('svg:not(svg svg)')) {
    const targets = await svg.$$('text,tspan');
    const boxes = await Promise.all(targets.map(target => target.boundingBox()));
    const overlaps = (a: number, b: number) => {
      const x = boxes[a], y = boxes[b];
      return !!x && !!y && x.x < y.x + y.width && x.x + x.width > y.x && x.y < y.y + y.height && x.y + x.height > y.y;
    };
    const groups: number[][] = [];
    for (let index = 0; index < targets.length; index++) {
      const group = groups.find(items => items.every(other => !overlaps(index, other)));
      if (group) group.push(index); else groups.push([index]);
    }
    // Labels in one capture must not remove each other's text backgrounds.
    for (const group of groups) {
      const snapshot = await svg.evaluateHandle((svg, targets) => {
        const selector = (el: Element) => {
          const parts: string[] = [];
          for (let node: Element | null = el; node; node = node.parentElement) {
            const tag = node.tagName.toLowerCase();
            if (!node.parentElement) { parts.unshift(tag); break; }
            const siblings = [...node.parentElement.children].filter(other => other.tagName === node.tagName);
            parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
          }
          return parts.join(' > ');
        };
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const texts = [...svg.querySelectorAll<SVGTextContentElement>('text,tspan')].filter(el =>
          targets.includes(el) && !el.closest('button:disabled, [aria-disabled="true"]') &&
          [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) &&
          el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0).map(el => {
          const style = getComputedStyle(el), bounds = el.getBoundingClientRect();
          const matrix = el.getScreenCTM();
          const size = parseFloat(style.fontSize) * (matrix ? Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) : 1);
          let reason: string | null = el.querySelector('tspan') ? 'Nested SVG text needs review' : null;
          if (!/^(rgb|hsl|color\(|#[\da-f]|[a-z]+$)/i.test(style.fill) || style.fill.startsWith('url(') || style.fill === 'none' || style.stroke !== 'none') reason = 'SVG text needs a solid fill without a stroke';
          for (let node: Element | null = el; node; node = node.parentElement) {
            const effect = getComputedStyle(node);
            if (parseFloat(effect.opacity) !== 1 || effect.filter !== 'none' || effect.backdropFilter !== 'none' || effect.mixBlendMode !== 'normal' || effect.textShadow !== 'none' || effect.maskImage !== 'none' || effect.animationName !== 'none') reason = 'SVG text effects need review';
          }
          context.clearRect(0, 0, 1, 1); context.fillStyle = style.fill; context.fillRect(0, 0, 1, 1);
          const rgba = [...context.getImageData(0, 0, 1, 1).data];
          const alpha = rgba[3] / 255 * parseFloat(style.fillOpacity);
          const declarations = Array.from(el.style, property => ({ property, value: el.style.getPropertyValue(property), priority: el.style.getPropertyPriority(property) }));
          return { el, selector: selector(el), originalStyle: el.getAttribute('style'), declarations, painted: false, reason,
            rgba: [...rgba.slice(0, 3), alpha], rect: { x: bounds.x + scrollX, y: bounds.y + scrollY, width: bounds.width, height: bounds.height },
            required: size >= 24 || size >= 56 / 3 && parseFloat(style.fontWeight) >= 700 ? 3 : 4.5 };
        });
        const box = svg.getBoundingClientRect();
        const clip = { x: Math.max(0, Math.floor(box.x + scrollX)), y: Math.max(0, Math.floor(box.y + scrollY)), width: Math.ceil(box.width), height: Math.ceil(box.height) };
        return { texts, clip };
      }, group.map(index => targets[index]));
      try {
        const info = await snapshot.evaluate(value => ({ clip: value.clip, count: value.texts.length }));
        if (!info.count) continue;
        if (info.clip.width * info.clip.height > 4_000_000 || !info.clip.width || !info.clip.height) throw new Error('SVG capture size needs review');
        // Keep the existing report text for frames, which have no screenshot API.
        if (!('screenshot' in page)) throw new TypeError('page.screenshot is not a function');
        const images: string[] = [];
        for (const paint of ['hidden', 'black', 'white', 'hidden']) {
          await snapshot.evaluate((value, paint) => {
            for (const text of value.texts) if (!text.reason) {
              text.painted = true;
              text.el.style.setProperty('opacity', paint === 'hidden' ? '0' : '1', 'important');
              text.el.style.setProperty('fill', paint === 'black' ? '#000' : '#fff', 'important');
              text.el.style.setProperty('fill-opacity', '1', 'important');
            }
          }, paint);
          images.push((await page.screenshot({ clip: info.clip, fullPage: true })).toString('base64'));
        }
        const measured = await snapshot.evaluate(async (value, images) => {
          const rasters: Uint8ClampedArray[] = [];
          let width = 0, height = 0;
          for (const encoded of images) {
            const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
            const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
            const canvas = document.createElement('canvas'); width = canvas.width = bitmap.width; height = canvas.height = bitmap.height;
            const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(bitmap, 0, 0);
            rasters.push(context.getImageData(0, 0, width, height).data); bitmap.close();
          }
          const luminance = (rgb: number[]) => rgb.map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
          const stable = rasters[0].every((channel, index) => channel === rasters[3][index]);
          return value.texts.map((text): SvgContrast => {
            const base = { selector: text.selector, required: text.required };
            if (text.reason) return { ...base, status: 'unresolved', reason: text.reason };
            if (!stable) return { ...base, status: 'unresolved', reason: 'SVG background changed during measurement' };
            const scaleX = width / value.clip.width, scaleY = height / value.clip.height;
            const startX = Math.max(0, Math.floor((text.rect.x - value.clip.x) * scaleX)), endX = Math.min(width, Math.ceil((text.rect.x + text.rect.width - value.clip.x) * scaleX));
            const startY = Math.max(0, Math.floor((text.rect.y - value.clip.y) * scaleY)), endY = Math.min(height, Math.ceil((text.rect.y + text.rect.height - value.clip.y) * scaleY));
            let ratio = Infinity, pixels = 0, fgColor: string | undefined, bgColor: string | undefined;
            for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
              const i = (y * width + x) * 4;
              if (Math.max(...[0, 1, 2].map(channel => Math.abs(rasters[1][i + channel] - rasters[2][i + channel]))) <= 2) continue;
              const background = [...rasters[0].slice(i, i + 3)];
              const foreground = background.map((channel, index) => text.rgba[index] * text.rgba[3] + channel * (1 - text.rgba[3]));
              const a = luminance(background), b = luminance(foreground);
              const sample = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
              if (sample < ratio) { ratio = sample; fgColor = `rgb(${foreground.map(Math.round).join(', ')})`; bgColor = `rgb(${background.join(', ')})`; }
              pixels++;
            }
            if (!pixels || !Number.isFinite(ratio)) return { ...base, status: 'unresolved', reason: 'SVG glyph pixels could not be measured' };
            return { ...base, status: ratio < text.required ? 'failed' : 'passed', contrastRatio: Math.floor(ratio * 100) / 100, fgColor, bgColor, pixels };
          });
        }, images);
        results.push(...measured);
      } catch (error) {
        results.push(...await snapshot.evaluate((value, reason) => value.texts.map(text => ({ selector: text.selector, required: text.required, status: 'unresolved' as const, reason })), error instanceof Error ? error.message : String(error)));
      } finally {
        await snapshot.evaluate(value => { for (const text of value.texts) {
          if (!text.painted) continue;
          for (const property of ['opacity', 'fill', 'fill-opacity']) {
            const original = text.declarations.find(declaration => declaration.property === property);
            if (original) text.el.style.setProperty(property, original.value, original.priority);
            else text.el.style.removeProperty(property);
          }
          // Keep exact markup when the application has not changed other declarations.
          if (text.el.style.length === text.declarations.length && text.declarations.every(({ property, value, priority }) => text.el.style.getPropertyValue(property) === value && text.el.style.getPropertyPriority(property) === priority)) {
            if (text.originalStyle === null) text.el.removeAttribute('style'); else text.el.setAttribute('style', text.originalStyle);
          }
        } });
        await snapshot.dispose();
      }
    }
    await Promise.all(targets.map(target => target.dispose()));
    await svg.dispose();
  }
  return results;
}
