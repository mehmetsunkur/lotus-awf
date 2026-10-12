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
LOTUS_APP_PORT ?= 3101
LOTUS_IMAGE ?= lotus-notes-platform:dev
REGISTRY ?= cr.lan.sunkur.net
IMAGE_REPO ?= lotus-notes/platform
IMAGE_TAG ?= $(shell git rev-parse --short HEAD)
PUSH_IMAGE ?= $(REGISTRY)/$(IMAGE_REPO):$(IMAGE_TAG)
K8S_DIR ?= deploy/k8s
K8S_NAMESPACE ?= lotus-notes
MCP_API_URL ?= http://localhost:3001
LOTUS_USERNAME ?= alice
LOTUS_PASSWORD ?= password123
CLAUDE ?= claude
CODEX ?= codex
MCP_CONFIG_DIR ?= .tmp
MCP_CONFIG ?= $(MCP_CONFIG_DIR)/claude-mcp.lotus.json

.PHONY: help e2e e2e-headed e2e-ui e2e-debug e2e-report setup-e2e \
	deploy-up deploy-down deploy-seed image-build image-push k8s-set-image k8s-dry-run k8s-apply k8s-status \
	mcp-api mcp-reset mcp-test mcp-http claude-mcp \
	claude-mcp-admin claude-mcp-designer claude-mcp-workspace \
	codex-mcp-admin-install codex-mcp-designer-install codex-mcp-workspace-install \
	codex-mcp-admin-remove codex-mcp-designer-remove codex-mcp-workspace-remove \
	codex-mcp-install-all codex-mcp-remove-all codex-mcp-list codex-mcp

help: ## List available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup-e2e: ## One-time: install Linux Chromium + Firefox + system deps for Playwright
	$(NVM) npx playwright install --with-deps chromium firefox

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

deploy-seed: ## Complete first-run setup (if needed) and seed the Agentic Airlines scenario (M25)
	LOTUS_APP_PORT=$(LOTUS_APP_PORT) bash scripts/deploy-seed.sh

image-build: ## Build the Lotus runtime Docker image
	$(DOCKER) build -t $(LOTUS_IMAGE) .

image-push: ## Build and push a single-arch Lotus image with the git SHA tag (CI owns multi-arch :latest)
	$(DOCKER) build -t $(PUSH_IMAGE) .
	$(DOCKER) push $(PUSH_IMAGE)

k8s-set-image: ## Point deploy/k8s/app.yaml at $(REGISTRY)/$(IMAGE_REPO):$(IMAGE_TAG)
	sed -i -E 's#^( +image: )$(REGISTRY)/$(IMAGE_REPO):.*#\1$(PUSH_IMAGE)#' $(K8S_DIR)/app.yaml
	grep -n 'image: $(REGISTRY)/$(IMAGE_REPO)' $(K8S_DIR)/app.yaml

k8s-dry-run: ## Render Kubernetes manifests locally with kubectl kustomize
	kubectl kustomize $(K8S_DIR) >/dev/null

k8s-apply: ## Apply Kubernetes manifests; requires deploy/k8s/secret.yaml
	test -f $(K8S_DIR)/secret.yaml || { echo "Create $(K8S_DIR)/secret.yaml from secret.example.yaml first"; exit 1; }
	kubectl apply -f $(K8S_DIR)/namespace.yaml
	kubectl apply -f $(K8S_DIR)/secret.yaml
	kubectl apply -f $(K8S_DIR)/configmap.yaml
	kubectl apply -f $(K8S_DIR)/local-couchdb.yaml
	kubectl apply -f $(K8S_DIR)/server-couchdb.yaml
	kubectl apply -f $(K8S_DIR)/app.yaml
	kubectl apply -f $(K8S_DIR)/ingress.yaml

k8s-status: ## Show Kubernetes rollout status for Lotus workloads
	kubectl -n $(K8S_NAMESPACE) rollout status statefulset/local-couchdb
	kubectl -n $(K8S_NAMESPACE) rollout status statefulset/server-couchdb
	kubectl -n $(K8S_NAMESPACE) rollout status deployment/lotus-app

mcp-api: ## Start CouchDB pair and Lotus API for local MCP testing
	$(DOCKER) compose up -d local-couchdb server-couchdb
	$(NVM) npx tsx tests/mcp/support/start-api.ts

mcp-reset: ## Reset local Lotus API state for MCP testing
	curl -fsS -X POST $(MCP_API_URL)/api/reset >/dev/null
	@echo "Reset $(MCP_API_URL)"

mcp-test: ## Run MCP stdio e2e tests
	$(NVM) npm run test:mcp

mcp-http: ## Start the MCP-over-HTTP host against a running Lotus API (see mcp-api)
	$(NVM) env LOTUS_API_URL=$(MCP_API_URL) npm run mcp:http

claude-mcp: ## Launch Claude Code with local Lotus MCP config
	$(MAKE) claude-mcp-designer

claude-mcp-admin: ## Launch Claude Code with Lotus admin MCP config
	@command -v $(CLAUDE) >/dev/null || { echo "Claude CLI not found: $(CLAUDE)"; exit 1; }
	@mkdir -p $(MCP_CONFIG_DIR)
	@printf '%s\n' '{' \
	  '  "mcpServers": {' \
	  '    "lotus-admin": {' \
	  '      "type": "stdio",' \
	  '      "command": "npx",' \
	  '      "args": ["tsx", "src/mcp/admin-server.ts"],' \
	  '      "cwd": "$(CURDIR)",' \
	  '      "env": {' \
	  '        "LOTUS_API_URL": "$(MCP_API_URL)",' \
	  '        "LOTUS_USERNAME": "$(LOTUS_USERNAME)",' \
	  '        "LOTUS_PASSWORD": "$(LOTUS_PASSWORD)"' \
	  '      }' \
	  '    }' \
	  '  }' \
	  '}' > $(MCP_CONFIG)
	$(CLAUDE) --strict-mcp-config --mcp-config $(MCP_CONFIG)

claude-mcp-designer: ## Launch Claude Code with Lotus designer MCP config
	@command -v $(CLAUDE) >/dev/null || { echo "Claude CLI not found: $(CLAUDE)"; exit 1; }
	@mkdir -p $(MCP_CONFIG_DIR)
	@printf '%s\n' '{' \
	  '  "mcpServers": {' \
	  '    "lotus-designer": {' \
	  '      "type": "stdio",' \
	  '      "command": "npx",' \
	  '      "args": ["tsx", "src/mcp/designer-server.ts"],' \
	  '      "cwd": "$(CURDIR)",' \
	  '      "env": {' \
	  '        "LOTUS_API_URL": "$(MCP_API_URL)",' \
	  '        "LOTUS_USERNAME": "$(LOTUS_USERNAME)",' \
	  '        "LOTUS_PASSWORD": "$(LOTUS_PASSWORD)"' \
	  '      }' \
	  '    }' \
	  '  }' \
	  '}' > $(MCP_CONFIG)
	$(CLAUDE) --strict-mcp-config --mcp-config $(MCP_CONFIG)

claude-mcp-workspace: ## Launch Claude Code with Lotus workspace MCP config
	@command -v $(CLAUDE) >/dev/null || { echo "Claude CLI not found: $(CLAUDE)"; exit 1; }
	@mkdir -p $(MCP_CONFIG_DIR)
	@printf '%s\n' '{' \
	  '  "mcpServers": {' \
	  '    "lotus-workspace": {' \
	  '      "type": "stdio",' \
	  '      "command": "npx",' \
	  '      "args": ["tsx", "src/mcp/workspace-server.ts"],' \
	  '      "cwd": "$(CURDIR)",' \
	  '      "env": {' \
	  '        "LOTUS_API_URL": "$(MCP_API_URL)",' \
	  '        "LOTUS_USERNAME": "$(LOTUS_USERNAME)",' \
	  '        "LOTUS_PASSWORD": "$(LOTUS_PASSWORD)"' \
	  '      }' \
	  '    }' \
	  '  }' \
	  '}' > $(MCP_CONFIG)
	$(CLAUDE) --strict-mcp-config --mcp-config $(MCP_CONFIG)

codex-mcp-admin-install: ## Persistently register Lotus admin MCP with Codex CLI
	@command -v $(CODEX) >/dev/null || { echo "Codex CLI not found: $(CODEX)"; exit 1; }
	$(CODEX) mcp remove lotus-admin >/dev/null 2>&1 || true
	$(CODEX) mcp add lotus-admin \
	  --env LOTUS_API_URL=$(MCP_API_URL) \
	  --env LOTUS_USERNAME=$(LOTUS_USERNAME) \
	  --env LOTUS_PASSWORD=$(LOTUS_PASSWORD) \
	  -- bash -lc 'cd $(CURDIR) && npx tsx src/mcp/admin-server.ts'

codex-mcp-designer-install: ## Persistently register Lotus designer MCP with Codex CLI
	@command -v $(CODEX) >/dev/null || { echo "Codex CLI not found: $(CODEX)"; exit 1; }
	$(CODEX) mcp remove lotus-designer >/dev/null 2>&1 || true
	$(CODEX) mcp add lotus-designer \
	  --env LOTUS_API_URL=$(MCP_API_URL) \
	  --env LOTUS_USERNAME=$(LOTUS_USERNAME) \
	  --env LOTUS_PASSWORD=$(LOTUS_PASSWORD) \
	  -- bash -lc 'cd $(CURDIR) && npx tsx src/mcp/designer-server.ts'

codex-mcp-workspace-install: ## Persistently register Lotus workspace MCP with Codex CLI
	@command -v $(CODEX) >/dev/null || { echo "Codex CLI not found: $(CODEX)"; exit 1; }
	$(CODEX) mcp remove lotus-workspace >/dev/null 2>&1 || true
	$(CODEX) mcp add lotus-workspace \
	  --env LOTUS_API_URL=$(MCP_API_URL) \
	  --env LOTUS_USERNAME=$(LOTUS_USERNAME) \
	  --env LOTUS_PASSWORD=$(LOTUS_PASSWORD) \
	  -- bash -lc 'cd $(CURDIR) && npx tsx src/mcp/workspace-server.ts'

codex-mcp-admin-remove: ## Remove the persistent Lotus admin MCP registration
	$(CODEX) mcp remove lotus-admin

codex-mcp-designer-remove: ## Remove the persistent Lotus designer MCP registration
	$(CODEX) mcp remove lotus-designer

codex-mcp-workspace-remove: ## Remove the persistent Lotus workspace MCP registration
	$(CODEX) mcp remove lotus-workspace

codex-mcp-install-all: ## Register all Lotus MCP surfaces with Codex CLI
	$(CODEX) mcp remove lotus-notes >/dev/null 2>&1 || true
	$(MAKE) codex-mcp-admin-install
	$(MAKE) codex-mcp-designer-install
	$(MAKE) codex-mcp-workspace-install

codex-mcp-remove-all: ## Remove all Lotus MCP surface registrations from Codex CLI
	$(CODEX) mcp remove lotus-notes >/dev/null 2>&1 || true
	$(CODEX) mcp remove lotus-admin >/dev/null 2>&1 || true
	$(CODEX) mcp remove lotus-designer >/dev/null 2>&1 || true
	$(CODEX) mcp remove lotus-workspace >/dev/null 2>&1 || true

codex-mcp-list: ## List Codex MCP registrations
	$(CODEX) mcp list

codex-mcp: ## Launch Codex CLI after verifying Lotus designer MCP is registered
	@command -v $(CODEX) >/dev/null || { echo "Codex CLI not found: $(CODEX)"; exit 1; }
	@$(CODEX) mcp get lotus-designer >/dev/null || { echo "Run: make codex-mcp-designer-install"; exit 1; }
	$(CODEX) -C $(CURDIR)
