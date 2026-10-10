import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  outputDir: '../../test-results/playwright',
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../test-results/playwright-report', open: 'never' }],
    ...(process.env.GITHUB_ACTIONS ? [['github']] : []),
  ],
  use: { viewport: { width: 390, height: 844 }, screenshot: 'only-on-failure' },
});
