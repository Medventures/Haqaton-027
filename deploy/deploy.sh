#!/usr/bin/env bash
# Обновление на сервере: git pull → зависимости → сборка → перезапуск pm2.
# Запуск на сервере из корня проекта: ./deploy/deploy.sh   (.env лежит в корне проекта, в git не попадает)
set -euo pipefail
cd "$(dirname "$0")/.."

[ "${SKIP_PULL:-0}" = 1 ] || git pull --ff-only
[ -f .env ] || { echo "Нет .env — скопируйте .env.example и заполните"; exit 1; }

[ -x backend/.venv/bin/python ] || python3 -m venv backend/.venv
backend/.venv/bin/pip install -q --upgrade pip
backend/.venv/bin/pip install -q -r backend/requirements.txt

cd frontend
npm ci --no-audit --no-fund
npm run build
# standalone-сборке нужны статические файлы рядом с server.js
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static
[ -d public ] && cp -r public .next/standalone/public
cd ..

pm2 startOrReload deploy/ecosystem.config.js --update-env
pm2 save
sleep 3
curl -fsS http://127.0.0.1:8000/api/health && echo
curl -fsS -o /dev/null -w "web: %{http_code}\n" http://127.0.0.1:3000/
