import type { Page } from 'playwright';
import type { TestInfo } from 'playwright/test';

/** Check the current page. Use the project policy when omitted. Attach findings on failure. */
export function expectUI(page: Page, testInfo: Pick<TestInfo, 'attach'>, policy?: Record<string, unknown>): Promise<void>;
