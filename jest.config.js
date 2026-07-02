/** @type {import('jest').Config} */
export default {
  // Test environment
  testEnvironment: 'jsdom',
  
  // Only run tests in the tests/ folder, ignore e2e/ (Playwright handles those)
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  
  // Module settings for ES modules
  transform: {},
  
  // Root directories for module resolution
  roots: ['<rootDir>/tests', '<rootDir>/js'],
  
  // Module directories
  modulePaths: ['<rootDir>/js', '<rootDir>/tests'],
  
  // Module name mapper for path resolution
  moduleNameMapper: {
    // Map ./moduleName.js to ../js/moduleName.js for tests
    '^\\./(fieldOnePager|v3Pivot|talkingPointsBuilder|targeting|precinctMetrics|siteNav|glossary|countyBriefing|listView)\\.js$': '<rootDir>/js/$1.js',
    // mapBins/mapPatterns live in js/map/ since Phase 4
    '^\\./(mapBins|mapPatterns)\\.js$': '<rootDir>/js/map/$1.js',
    // Map test-helpers
    '^\\./(test-helpers)\\.js$': '<rootDir>/tests/$1.js'
  },
  
  // Verbose output
  verbose: true,
  
  // Coverage settings
  collectCoverageFrom: ['js/**/*.js'],
  coveragePathIgnorePatterns: ['/node_modules/']
};
