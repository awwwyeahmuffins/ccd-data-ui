import js from '@eslint/js';

// Browser globals plus the CDN libraries the app loads via <script> tags
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  FileReader: 'readonly',
  AbortController: 'readonly',
  TextDecoder: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  KeyboardEvent: 'readonly',
  HTMLElement: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  history: 'readonly',
  getComputedStyle: 'readonly',
  // CDN libraries
  L: 'readonly', // Leaflet
  d3: 'readonly',
  Chart: 'readonly',
};

export default [
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Layering rule (REDESIGN.md §4.2): js/lib/ is the bottom layer and may
    // not import from any other app directory — lib imports nothing.
    files: ['js/lib/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['../*', './../*'],
        message: 'js/lib/ is the bottom layer — it must not import app modules (REDESIGN.md §4.2).',
      }] }],
    },
  },
  {
    // page.evaluate() callbacks execute in the browser, so e2e specs
    // legitimately reference browser globals
    files: ['e2e/**/*.spec.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...browserGlobals, process: 'readonly' },
    },
  },
  {
    files: ['tests/**/*.test.js', 'jest.config.js', 'jest.setup.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        global: 'writable',
        process: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
