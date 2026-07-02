// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Collin County Elections
 * @see https://playwright.dev/docs/test-configuration
 */
// Sandboxed/CI environments sometimes pre-install a pinned system Chromium
// (PLAYWRIGHT_BROWSERS_PATH) that doesn't match this @playwright/test version.
// Set CCD_CHROMIUM_PATH to that binary to run the chromium-family projects
// against it; leave it unset on normal machines.
const chromiumExe = process.env.CCD_CHROMIUM_PATH
  ? { launchOptions: { executablePath: process.env.CCD_CHROMIUM_PATH } }
  : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...chromiumExe },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile viewports
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'], ...chromiumExe },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
    // iPad — the primary device of the 60+ audience; runs the a11y and
    // orientation-critical specs.
    {
      name: 'iPad',
      use: { ...devices['iPad (gen 7) landscape'] },
      testMatch: /(a11y|command-center|onboarding)\.spec\.js/,
    },
  ],

  // Run local dev server before tests
  webServer: {
    command: 'python3 serve.py 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
