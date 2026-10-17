# 投递 · 求职工作台

Cloudflare Workers + Hono + D1，原生 HTML / CSS / JavaScript，无前端构建步骤。

## 功能

- 工作台概览、待投/进行中/Offer 视图、近期截止提醒。
- 表格内直接填写、自动保存、岗位多选管理、搜索排序、暖白与陶土橙的「序章」主题、移动端布局。
- 沿用 Cloudflare Access 访问保护；独立的浏览器本地模式。
- 公司与岗位在同一事务中保存，删除与恢复备份真正替换记录。
- 版本校验防止多端覆盖；断网暂存、重试、未同步修改恢复。
- JSON 备份恢复、CSV 导出（含公式注入防护）。
- 独立的面试安排与阶段进展：先进入下一轮，再补充日期、时间和会议地点；支持改期、标记完成和待反馈。
- 行内状态时间线、实际反馈时间修正；快速连续操作和断网操作会排队保存，不丢失中间进展。
- 星标整行高亮与筛选；星标不改变默认记录排序。
- 批量粘贴公司名称，一次最多 100 家，检查已有记录和回收站同名记录，保持输入顺序。
- 删除移入回收站，支持立即撤销，恢复时保留投递信息、星标和历史。

## 本地开发

需要 Node.js 24 或更高版本。

```sh
npm ci
```

本地开发不需要应用访问密钥。线上访问验证由已配置的 Cloudflare Access 负责。

```sh
npm run db:migrate:local
npm run dev
```

打开 Wrangler 输出的本地地址即可使用，无需输入应用密钥。

也可在「数据管理」中点击「仅在此浏览器使用」。此模式不连接云端，数据只在本机保存，需定期导出备份。

## UI 预览（独立示例数据）

```sh
npm run preview
```

打开 http://127.0.0.1:8790 ，无需登录。预览只绑定本机地址，使用内存 SQLite 和虚构公司记录，重启即还原，不接触真实 D1 数据。它用于页面和接口联调，Cloudflare 运行时仍应使用 `npm run dev` 验证。

## 验证

```sh
npm run check   # TypeScript + Node/SQLite 回归测试
npm run build   # Wrangler dry-run，只打包不部署
```

## 部署与升级

1. 在 `wrangler.toml` 配置 D1 的名称和 ID。
2. 升级旧版前，导出 JSON 备份。
3. 手动执行 `npm run db:migrate:remote`。`0003_sync.sql` 添加排序与同步元数据；`0004_workbench.sql` 添加星标、回收站、面试安排和独立历史表，保留已有记录。历史启用时仅以现有状态建立起点，不推测之前的反馈或面试日期。
4. 沿用已有的 Cloudflare Access 策略，覆盖站点及 `/api/*` 路由。
5. 执行 `npm run deploy`；通过 Cloudflare 验证后直接进入工作台。

旧版浏览器在云端为空时会显示恢复提示，确认后才迁移，不会自动覆盖浏览器备份。版本冲突时先备份当前修改，再重新载入云端并按需恢复。恢复 JSON 是全量替换操作。

GitHub Actions 在 main 推送时依次执行 npm ci、类型检查与回归测试、打包、远程数据库迁移和 Worker 部署。需要两个仓库 Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。不再使用应用 `ACCESS_TOKEN`。部署串行执行，避免并行迁移。

## API

浏览器通过已有的 Cloudflare Access 会话访问 `/api/*`，不再发送应用 Bearer 密钥；响应不允许缓存。

- `GET /api/data`：返回 `{ v, revision, roles, companies }`。
- 默认按记录最近新增或编辑的时间倒序；公司字段 `updatedAt` 为毫秒时间戳，会随云端同步和 JSON 备份保留。连续填写表格时保持行位置，离开表格后重新排序。
- `PUT /api/data`：提交完整快照及读到的 `revision`，成功返回新版本；旧版本返回 `409`，不修改任何记录。
- 快照 v3 包含 `companies` 和 `trash`；删除只移动至回收站，旧版快照省略的记录也会保留。`starred` 为星标，`interview` 包含 `phase`（pending / scheduled / feedback）、UTC ISO 格式的 `at` 和 `location`。页面按浏览器本地时区展示和填写。
- `GET /api/history/:id`：按需加载单条投递的历史，普通自动保存无需传输全部历史。
- `activity`：待同步的进展操作，保留每次操作时间；与数据在同一事务内保存，成功后客户端只移除本次确认的操作。`historyEdits` 仅修正阶段事件的实际反馈时间，保留系统记录时间。
- `GET /api/backup`：导出完整 v3 数据，包含回收站与全部历史。`PUT /api/backup` 用于显式恢复完整备份。旧版 JSON 仍可恢复；被替换的现有记录保留在回收站。
- `GET /api/roles`：返回岗位与版本。
- `POST /api/roles`：提交 `{ name, revision }`。
- `DELETE /api/roles/:name`：携带 `If-Match: <revision>`，同时移除公司岗位关联。

数据最多 2000 条正常投递、2000 条回收站记录、200 个岗位，常规快照最多 1 MB（UTF-8）；完整备份中的历史最多 20000 条、8 MB。事务行为参考 [Cloudflare D1 batch 文档](https://developers.cloudflare.com/d1/worker-api/d1-database/)。静态资源通过 [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) 提供。

## 目录

- `public/`：页面、样式、前端交互、安全响应头。
- `src/worker.ts`：数据校验与版本控制 API。
- `migrations/`：D1 数据库迁移。
- `tests/`：独立 SQLite 回归验证，不使用真实数据库。
- `scripts/preview.mjs`：独立本机演示服务。

本应用是一套共享数据，不是多用户隔离系统。浏览器备份没有加密；共享设备上请注意本地存储。
