#!/usr/bin/env bash
set -e
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 未安装。请先安装 Node.js 20 或以上版本。"
  exit 1
fi
npm install
[ -f .env ] || cp .env.example .env
echo "安装完成。执行 npm run dev，然后打开 http://localhost:3000"
