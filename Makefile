# AqylRoute AI — локальный запуск без Docker.
# Требования: Python 3.14, Node.js 26 (npm 11). Переменные окружения — в .env (см. .env.example).

PY      ?= python3
VENV    := backend/.venv
BIN     := $(VENV)/bin
API_PORT ?= 8000

.PHONY: help install run backend frontend test typecheck build reset-db eval check-secrets

help:
	@echo "make install       — зависимости backend (venv) и frontend (npm ci)"
	@echo "make run           — backend :$(API_PORT) + frontend :3000 (http://localhost:3000)"
	@echo "make test          — pytest + проверка типов TypeScript"
	@echo "make reset-db      — удалить SQLite; при старте база пересоздаётся из seed"
	@echo "make eval          — 10 генераций плана на реальной модели (нужен OPENAI_API_KEY)"
	@echo "make check-secrets — убедиться, что в истории git нет ключей"

install:
	[ -x $(BIN)/python ] || $(PY) -m venv $(VENV)
	$(BIN)/pip install -q -r backend/requirements-dev.txt
	cd frontend && npm ci --no-audit --no-fund
	[ -f .env ] || cp .env.example .env

run:
	./dev.sh

backend:
	cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $(API_PORT) --reload

frontend:
	cd frontend && BACKEND_URL=http://127.0.0.1:$(API_PORT) npm run dev

test:
	cd backend && .venv/bin/python -m pytest -q
	cd frontend && npx tsc --noEmit

build:
	cd frontend && npm run build

reset-db:
	rm -f backend/data/*.db
	@echo "База удалена. Запустите make run — она пересоздастся из seed (2 синтетических кейса)."

eval:
	cd backend && .venv/bin/python -m scripts.eval_plan --scenario 2 --runs 10

check-secrets:
	@if git log -p --all | grep -E 'sk-[A-Za-z0-9_-]{20,}'; then echo "НАЙДЕН КЛЮЧ В ИСТОРИИ — отзовите его в OpenAI"; exit 1; else echo "OK: ключей в истории git нет"; fi
