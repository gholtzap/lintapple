import type { Page } from 'playwright';
import type { TestInfo } from 'playwright/test';

/** Check the current page state. Attach the report and fail when findings exist. */
export function expectUI(page: Page, testInfo: Pick<TestInfo, 'attach'>, policy?: Record<string, unknown>): Promise<void>;
