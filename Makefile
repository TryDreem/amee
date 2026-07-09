SHELL := /bin/bash
-include .env.local
export

.PHONY: env dev check types check-backend check-frontend drift

env:
	@scripts/wt-env.sh --show || scripts/wt-env.sh

dev: ## bring up broker + backend + frontend on this worktree's ports
	@test -f .env.local || scripts/wt-env.sh
	docker compose up -d rabbitmq
	cd backend && uvicorn app.main:app --reload --port $(API_PORT) & \
	cd backend && celery -A app.workers.celery_app worker -Q transcribe,export -l info & \
	cd frontend && pnpm dev --port $(WEB_PORT)

check: check-backend check-frontend drift

check-backend:
	cd backend && ruff check . && ruff format --check . && pytest -q

check-frontend:
	cd frontend && pnpm exec tsc --noEmit && pnpm exec eslint . && pnpm exec vitest run

types: ## regenerate frontend types from backend OpenAPI
	cd backend && python -c "import json,app.main as m; print(json.dumps(m.app.openapi()))" > ../openapi.json
	cd frontend && pnpm exec openapi-typescript ../openapi.json -o src/api/types.gen.ts
	@rm -f openapi.json

drift: ## fail if the committed generated types are stale
	@$(MAKE) types
	@git diff --exit-code frontend/src/api/types.gen.ts \
	  || (echo "types.gen.ts is stale — commit the regenerated file" && exit 1)
