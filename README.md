# 投递管理 - Cloudflare Workers 版

基于 Cloudflare Workers + D1 数据库的秋招投递追踪工具，支持多端同步、免费部署。

## 功能特性

- 📝 **投递记录管理** - 公司、岗位、截止日期、状态全记录
- 🎯 **状态流转** - 未投 → 已投 → 测评/笔试 → 一面/二面/三面 → OC/已挂
- 📊 **实时统计** - 待投、已投、面试中、OC、7天内截止一目了然
- 🔍 **搜索筛选** - 按公司/部门/备注搜索，按状态/截止日期/添加顺序排序
- 💾 **数据持久化** - Cloudflare D1 (SQLite) 边缘数据库，多端自动同步
- 📤 **导出备份** - CSV 导出给 Excel，JSON 备份迁移
- 🌙 **深色模式** - 自动跟随系统，手动切换
- 💰 **完全免费** - Cloudflare 免费额度：5GB 存储、10万次/天请求

## 技术栈

- **前端**: 原生 HTML/CSS/JS (单文件，无构建)
- **后端**: Hono + Cloudflare Workers
- **数据库**: Cloudflare D1 (SQLite)
- **部署**: Wrangler + GitHub Actions

## 本地开发

```bash
# 安装依赖
bun install

# 启动本地开发服务 (http://127.0.0.1:8787)
bun run dev

# 本地数据库迁移
bun run db:migrate:local
```

## 部署到 Cloudflare

### 1. 创建 D1 数据库
```bash
bun run db:create
```
复制输出的 `database_id`，填入 `wrangler.toml` 的 `database_id` 字段。

### 2. 应用远程迁移 (建表 + 导入初始数据)
```bash
bun run db:migrate:remote
```

### 3. 部署 Worker
```bash
bun run deploy
```

### 4. 配置 GitHub Actions 自动部署 (可选)
在 GitHub 仓库 Settings → Secrets and variables → Actions 添加：
- `CLOUDFLARE_API_TOKEN` - Workers 编辑权限
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare 账号 ID

推送到 main 分支即可自动部署。

## 项目结构

```
├── src/worker.ts          # Hono 后端 API
├── public/index.html      # 前端页面
├── migrations/
│   ├── 0001_init.sql      # 建表 + 默认岗位
│   └── 0002_import_data.sql # 导入初始数据 (可选)
├── wrangler.toml          # Cloudflare 配置
├── package.json
└── .github/workflows/deploy.yml # 自动部署
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/data | 获取所有公司记录 |
| PUT | /api/data | 批量保存公司记录 |
| GET | /api/roles | 获取岗位列表 |
| POST | /api/roles | 新增岗位 |
| DELETE | /api/roles/:name | 删除岗位 |

## 免费额度说明

| 资源 | 免费额度 | 备注 |
|------|----------|------|
| D1 存储 | 5 GB | 约够存几百万条记录 |
| D1 读取 | 500 万次/天 | 远超个人使用 |
| D1 写入 | 10 万次/天 | 足够高频更新 |
| Workers 请求 | 10 万次/天 | 含静态资源 |
| Workers CPU | 10 ms/请求 | 够用 |

## 迁移自本地版

原 Python 本地版 (`server.py` + `data.json`) 数据可通过 `scripts/import-data.mjs` 生成 SQL 导入 D1。

## 许可证

MIT