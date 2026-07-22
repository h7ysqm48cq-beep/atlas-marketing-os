# MGMBETMYR Marketing OS V4 Pro

可直接运行的本地营销管理系统 Starter，包含：

- Web Dashboard
- 内容数据库与状态管理
- AI 内容生成（未填 API Key 时自动使用示例生成器）
- Notion 内容写入接口
- KPI 总览
- Docker 部署

## Mac 安装

```bash
cd ~/Downloads/mgmbetmyr-marketing-os-v4-pro
./install.sh
npm run dev
```

浏览器打开：`http://localhost:3000`

## 手动安装

```bash
npm install
cp .env.example .env
npm run dev
```

## OpenAI

在 `.env` 填入：

```env
OPENAI_API_KEY=你的APIKey
OPENAI_MODEL=gpt-4o-mini
```

没有填写 API Key 也能运行，只会使用内置示例生成器。

## Notion

先建立一个 Notion Database，并确保属性名称和类型如下：

- `Name`：Title
- `Status`：Select，包含 Draft
- `Platform`：Select，包含 Facebook、Instagram、TikTok、Telegram
- `Publish Date`：Date

然后在 `.env` 填入：

```env
NOTION_TOKEN=secret_xxx
NOTION_CONTENT_DATABASE_ID=数据库ID
```

## API

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/contents`
- `POST /api/contents`
- `PATCH /api/contents/:id`
- `POST /api/generate`
- `POST /api/contents/:id/notion`

## Docker

```bash
cp .env.example .env
docker compose up --build
```
