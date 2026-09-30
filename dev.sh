#!/usr/bin/env bash
# Локальный запуск без Docker: FastAPI на :8000 и Next.js на :3000.
# Первый запуск сам создаёт venv и ставит зависимости. Ключи — только в .env (см. .env.example).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x backend/.venv/bin/uvicorn ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements-dev.txt
fi
if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install --no-audit --no-fund)
fi

trap 'kill 0' EXIT INT TERM
(cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${API_PORT:-8000}" --reload) &
(cd frontend && BACKEND_URL="http://127.0.0.1:${API_PORT:-8000}" npm run dev) &
wait
