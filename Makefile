SHELL := /bin/bash
-include .env.local
export

# Fallback only — the real per-worktree value comes from scripts/wt-env.sh's
# .env.local (?= means this is skipped once that's included above).
AMEE_DB_URL ?= postgresql://amee:amee@localhost:5432/amee

.PHONY: env dev check types check-backend check-frontend drift migrate

env:
	@scripts/wt-env.sh --show || scripts/wt-env.sh

dev: ## bring up broker + db + backend + frontend on this worktree's ports
	@test -f .env.local || scripts/wt-env.sh
	docker compose up -d rabbitmq postgres redis
	cd backend && uvicorn app.main:app --reload --port $(API_PORT) & \
	cd backend && celery -A app.workers.celery_app worker -Q transcribe,export -l info & \
	cd frontend && pnpm dev --port $(WEB_PORT)

migrate: ## run Alembic migrations against this worktree's Postgres — lands in M1, not deferred
	cd backend && alembic upgrade head

check: check-backend check-frontend drift

check-backend:
	cd backend && ruff check . && ruff format --check . && mypy app && pytest -q

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
