import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.{ts,js}',
  outputDir: '../../test-results/playwright',
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../test-results/playwright-report', open: 'never' }],
    ...(process.env.GITHUB_ACTIONS ? [['github'] as const] : []),
  ],
  use: { viewport: { width: 390, height: 844 }, screenshot: 'only-on-failure' },
});
