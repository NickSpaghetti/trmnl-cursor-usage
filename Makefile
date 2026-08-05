# TRMNL plugin monorepo. Every target runs inside the trmnl/trmnlp container,
# so the only host dependency is Docker. Pick a plugin with PLUGIN=<name>:
#
#   make dev                        # default plugin
#   make build PLUGIN=other-plugin

PLUGIN     ?= cursor-member-usage
PLUGIN_DIR := plugins/$(PLUGIN)

DOCKER_ENV := HOST_UID=$(shell id -u) HOST_GID=$(shell id -g)
COMPOSE    := PLUGIN=$(PLUGIN) $(DOCKER_ENV) docker compose
RUN        := $(COMPOSE) run --rm trmnlp

# Throwaway plugin dir used by `make screenshots`. Leading dot keeps it out of
# `make plugins`.
STAGE         := .screenshots-stage
COMPOSE_STAGE := PLUGIN=$(STAGE) $(DOCKER_ENV) docker compose

.DEFAULT_GOAL := help
.PHONY: help dev up down logs shell pull build build-png screenshots lint test test-local check \
        clean plugins crop-shot guard-plugin

help: ## Show this help
	@echo "TRMNL plugin monorepo — PLUGIN=$(PLUGIN)"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "Plugins: $(notdir $(wildcard plugins/*))"

## --- dev loop ---------------------------------------------------------------

dev: guard-plugin ## Serve the plugin with live reload at http://localhost:4567
	$(COMPOSE) up

up: guard-plugin ## Same as dev, detached
	$(COMPOSE) up -d

down: ## Stop and remove the dev container
	$(COMPOSE) down --remove-orphans

logs: ## Tail the dev container logs
	$(COMPOSE) logs -f

shell: guard-plugin ## Open a shell in the container, cwd /plugin
	$(COMPOSE) run --rm --entrypoint bash trmnlp

pull: ## Pull the latest trmnl/trmnlp image
	$(COMPOSE) pull

## --- build ------------------------------------------------------------------

build: guard-plugin ## Render static HTML into the plugin _build/ dir
	$(RUN) build
	@echo "→ $(PLUGIN_DIR)/_build/"

build-png: guard-plugin ## Render HTML + 800x480 PNGs into _build/
	$(RUN) build --png
	@echo "→ $(PLUGIN_DIR)/_build/"

# Renders the README images from fixtures/demo-usage-events.json, so they can be
# regenerated when the templates change instead of going stale. Builds in a
# throwaway plugin dir whose .trmnlp.yml feeds the fixture in as polled data —
# no Cursor API key involved.
#
# Every view renders onto the same 800x480 device canvas, so the smaller ones
# come out padded with dead space. crop-shot trims each to the region it
# actually occupies on a real device.
screenshots: guard-plugin ## Regenerate the README screenshots from the demo fixture
	@rm -rf plugins/$(STAGE)
	@mkdir -p plugins/$(STAGE)
	@cp -r $(PLUGIN_DIR)/src plugins/$(STAGE)/
	@cp $(PLUGIN_DIR)/fixtures/demo-usage-events.json plugins/$(STAGE)/demo.json
	@cp $(PLUGIN_DIR)/tools/demo-config.mjs plugins/$(STAGE)/
	@$(COMPOSE_STAGE) run --rm --entrypoint node trmnlp demo-config.mjs
	@$(COMPOSE_STAGE) run --rm trmnlp build --png
	@mkdir -p $(PLUGIN_DIR)/docs
	@cp plugins/$(STAGE)/_build/*.png $(PLUGIN_DIR)/docs/
	@$(MAKE) --no-print-directory crop-shot SHOT=half_horizontal GEOM=800x240
	@$(MAKE) --no-print-directory crop-shot SHOT=half_vertical   GEOM=400x480
	@$(MAKE) --no-print-directory crop-shot SHOT=quadrant        GEOM=400x240
	@rm -rf plugins/$(STAGE)
	@echo "→ $(PLUGIN_DIR)/docs/"

# -strip drops the date:create / date:modify chunks ImageMagick would otherwise
# stamp in, which made every regeneration produce a different byte stream and
# showed up as a spurious git diff.
crop-shot:
	@$(DOCKER_ENV) docker run --rm -v "$(CURDIR)/$(PLUGIN_DIR)/docs:/w" \
		-u "$(shell id -u):$(shell id -g)" --entrypoint magick trmnl/trmnlp \
		/w/$(SHOT).png -crop $(GEOM)+0+0 +repage -strip /w/$(SHOT).png

## --- checks -----------------------------------------------------------------

# The image bundles node for the serverless transform backend, so the tests run
# on the same interpreter that will execute transform.js in the preview server.
test: guard-plugin ## Run the plugin's transform unit tests (in container)
	$(COMPOSE) run --rm --entrypoint sh trmnlp -c 'node --test tests/*.test.js'

test-local: guard-plugin ## Run the same tests on host node, no Docker
	cd $(PLUGIN_DIR) && node --test tests/*.test.js

lint: guard-plugin ## Check the plugin against TRMNL best practices
	$(RUN) lint

check: lint test ## lint + test

## --- housekeeping -----------------------------------------------------------

clean: ## Remove build output
	rm -rf $(PLUGIN_DIR)/_build

plugins: ## List available plugins
	@ls -1 plugins

guard-plugin:
	@test -f $(PLUGIN_DIR)/.trmnlp.yml \
		|| { echo "no plugin at $(PLUGIN_DIR) (missing .trmnlp.yml)"; exit 1; }
