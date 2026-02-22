# Collin County Elections - Development Makefile
# ==============================================

.PHONY: help install serve start stop test test-unit test-e2e test-all lint format clean cdk-deploy cdk-destroy

# Default target
help:
	@echo "Collin County Elections - Available Commands"
	@echo "============================================="
	@echo ""
	@echo "  Server Commands:"
	@echo "    make serve       - Start development server on port 3000"
	@echo "    make start       - Kill port 3000 processes and start server"
	@echo "    make stop        - Stop any process running on port 3000"
	@echo ""
	@echo "  Testing Commands:"
	@echo "    make test        - Run all tests (unit + e2e)"
	@echo "    make test-unit   - Run unit tests with Jest"
	@echo "    make test-e2e    - Run Playwright e2e tests"
	@echo "    make test-headed - Run Playwright tests with browser visible"
	@echo "    make test-debug  - Run Playwright tests in debug mode"
	@echo ""
	@echo "  Setup Commands:"
	@echo "    make install     - Install all dependencies"
	@echo "    make clean       - Clean generated files and caches"
	@echo ""
	@echo "  Code Quality:"
	@echo "    make lint        - Run linter checks"
	@echo "    make format      - Format code"
	@echo ""

# ===================
# DEPENDENCIES
# ===================

install:
	@echo "Installing npm dependencies..."
	npm install
	@echo "Installing Playwright browsers..."
	npx playwright install
	@echo "Done! Run 'make serve' to start the server."

# ===================
# SERVER COMMANDS
# ===================

# Kill anything on port 3000
stop:
	@echo "Stopping processes on port 3000..."
	@-lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@echo "Port 3000 is free."

# Start server without killing existing
serve:
	@echo "Starting development server on http://localhost:3000..."
	python3 -m http.server 3000

# Kill + start (safe restart)
start: stop
	@echo "Starting development server on http://localhost:3000..."
	@python3 -m http.server 3000 &
	@echo "Server started in background. Use 'make stop' to stop it."
	@sleep 1
	@echo "Opening http://localhost:3000/index.html in browser..."
	@open http://localhost:3000/index.html 2>/dev/null || xdg-open http://localhost:3000/index.html 2>/dev/null || echo "Open http://localhost:3000/index.html in your browser"

# ===================
# TESTING
# ===================

# Run Jest unit tests (excludes e2e folder)
test-unit:
	@echo "Running unit tests..."
	npm run test:unit || true

# Run Playwright e2e tests (headless)
test-e2e:
	@echo "Running Playwright e2e tests..."
	npx playwright test

# Run Playwright tests with UI
test-headed:
	@echo "Running Playwright tests in headed mode..."
	npx playwright test --headed

# Run Playwright tests in debug mode
test-debug:
	@echo "Running Playwright tests in debug mode..."
	npx playwright test --debug

# Run Playwright tests for specific browser
test-chrome:
	npx playwright test --project=chromium

test-firefox:
	npx playwright test --project=firefox

test-safari:
	npx playwright test --project=webkit

test-mobile:
	npx playwright test --project="Mobile Chrome" --project="Mobile Safari"

# Run all tests
test: test-unit test-e2e
	@echo "All tests completed!"

# Run tests in CI mode
test-ci:
	npm test -- --ci
	npx playwright test --reporter=github

# ===================
# CODE QUALITY
# ===================

lint:
	@echo "Running linter..."
	npx eslint js/*.js --ext .js || true
	@echo "Lint complete."

format:
	@echo "Formatting code..."
	npx prettier --write "js/**/*.js" "e2e/**/*.js" || true
	@echo "Format complete."

# ===================
# CLEANUP
# ===================

clean:
	@echo "Cleaning generated files..."
	rm -rf node_modules
	rm -rf playwright-report
	rm -rf test-results
	rm -rf .cache
	rm -rf coverage
	@echo "Clean complete. Run 'make install' to reinstall dependencies."

# ===================
# REPORTS
# ===================

# Open Playwright HTML report
report:
	npx playwright show-report

# Generate coverage report
coverage:
	npm test -- --coverage

# ===================
# CDK INFRASTRUCTURE
# ===================

cdk-deploy:
	@echo "Deploying CDK stack..."
	cd infra && npm install && npx cdk deploy --outputs-file ../cdk-outputs.json
	@echo "Stack deployed. Update js/authConfig.js with values from cdk-outputs.json."

cdk-destroy:
	@echo "Destroying CDK stack..."
	cd infra && npx cdk destroy
