import type { Frame, Page } from 'playwright';
import type { TestInfo } from 'playwright/test';
import { checkPage, checkUrl, checkInteractions, validatePolicy } from '../src/index.js';
import { expectUI } from '../src/playwright.js';
import type { Policy, PageReport, UrlReport, InteractionPlan } from '../src/index.js';

// This function is compiled but never called. Invalid contracts must stay invalid.
export function publicTypes(page: Page, frame: Frame, info: TestInfo, external: unknown) {
  const policy: Partial<Policy> = { colorSchemes: ['light', 'dark'] };
  const pageResult: Promise<PageReport> = checkPage(page, policy);
  const frameResult: Promise<PageReport> = checkPage(frame, policy);
  const urlResult: Promise<UrlReport> = checkUrl('https://example.test', policy);
  const plan: Partial<InteractionPlan> = { states: [{ name: 'Name entered', action: 'fill', selector: '#name', value: 'Project', ready: { selector: '#result' } }] };
  checkInteractions(page, plan);
  expectUI(page, info, policy);
  validatePolicy(external);
  // @ts-expect-error A color scheme must be light or dark.
  checkPage(page, { colorSchemes: ['blue'] });
  // @ts-expect-error A fill action must supply its value.
  checkInteractions(page, { states: [{ name: 'Name entered', action: 'fill', selector: '#name', ready: { selector: '#result' } }] });
  // @ts-expect-error A menu key must be supported by the checker.
  checkInteractions(page, { menus: [{ selector: '#menu', steps: [{ key: 'Delete', focus: '#item' }] }] });
  // @ts-expect-error Findings have a fixed report contract.
  pageResult.then(report => report.findings[0].missing);
  return { pageResult, frameResult, urlResult };
}
