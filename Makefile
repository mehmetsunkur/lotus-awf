# Lotus Notes — developer tasks
#
# E2E tests run under Playwright. The browser binaries and Node toolchain live
# in WSL (not the Windows-side scoop Node, which can't drive the repo over a
# \\wsl.localhost UNC path). Every recipe sources nvm so it uses the Linux Node
# regardless of how PATH is ordered in the calling shell.
#
# "Headed" / "ui" targets render a real browser through WSLg (DISPLAY=:0). The
# CouchDB pair is brought up idempotently by Playwright's globalSetup, so you do
# not need to start it yourself.

# Source nvm and select the LTS Node before any node/npm/npx call. Recipes run
# under a non-interactive shell that does not read ~/.bashrc, so we do it here.
NVM := export NVM_DIR="$$HOME/.nvm"; . "$$NVM_DIR/nvm.sh"; nvm use --lts >/dev/null;
DOCKER ?= sudo docker
DEPLOY_PROJECT ?= lotus-fresh
DEPLOY_COMPOSE ?= deploy/compose.yml

.PHONY: help e2e e2e-headed e2e-ui e2e-debug e2e-report setup-e2e \
	deploy-up deploy-down

help: ## List available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup-e2e: ## One-time: install Linux Chromium + system deps for Playwright
	$(NVM) npx playwright install --with-deps chromium

e2e: ## Run the e2e suite headless (CI-equivalent)
	$(NVM) npx playwright test

e2e-headed: ## Run the e2e suite in a visible browser (via WSLg)
	$(NVM) npx playwright test --headed

e2e-ui: ## Open Playwright's interactive UI runner
	$(NVM) npx playwright test --ui

e2e-debug: ## Step through the suite with the Playwright Inspector
	$(NVM) PWDEBUG=1 npx playwright test --headed

e2e-report: ## Open the last HTML report
	$(NVM) npx playwright show-report

deploy-up: ## Build and start the deploy artifact stack (lotus-fresh) using deploy/compose.yml
	$(DOCKER) compose -p $(DEPLOY_PROJECT) -f $(DEPLOY_COMPOSE) up -d --build

deploy-down: ## Stop and remove deploy artifact stack (+ volumes + orphans)
	$(DOCKER) compose -p $(DEPLOY_PROJECT) -f $(DEPLOY_COMPOSE) down -v --remove-orphans
