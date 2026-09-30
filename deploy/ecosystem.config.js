// pm2: API (FastAPI, один воркер — SQLite и блокировки в процессе) и веб (Next.js standalone).
// Запуск: pm2 startOrReload deploy/ecosystem.config.js && pm2 save
const path = require("path");
const root = path.resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "aqyl-api",
      cwd: path.join(root, "backend"),
      script: ".venv/bin/uvicorn",
      args: "app.main:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers",
      interpreter: "none",
      max_memory_restart: "500M",
    },
    {
      name: "aqyl-web",
      cwd: path.join(root, "frontend", ".next", "standalone"),
      script: "server.js",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
        BACKEND_URL: "http://127.0.0.1:8000",
      },
      max_memory_restart: "500M",
    },
  ],
};
