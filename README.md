# OKX 合约带单观察（SWAP）

- 远程 D1 表：`trader_info`、`watched_traders`、`watched_trader_metrics`
- 首页：已观察优先展示，未观察列表默认显示前 50（实时抓 OKX）
- 左上弹窗：一次输入 `ADMIN_PASSWORD` 验证后即可观察/取消交易员；附带“手动刷新数据”按钮（拉取 OKX → 写 D1 → 刷新列表与图表）
- 点击交易员卡片弹窗，可看 AUM/带单规模趋势图
- AUTH_SECRET 已写死；ADMIN_PASSWORD 未设置则默认 `admin`

## 快速开始（远程 D1）
```bash
wrangler login
npm run db:reset           # 远程建表（会 DROP 旧表）
npm run dev                # 本地热更新，直连远程 D1
```

若需真实 Worker 运行时调试：`npm run dev:remote`

## 部署
- Web：`npm run deploy:site`
- Worker (每5分钟 cron)：`npm run deploy:worker`
- 远程密钥（可选）：`wrangler secret put ADMIN_PASSWORD`（不设则默认 `admin`）

## API
- `POST /api/auth/verify.json` {password} → 设置 cookie
- `GET /api/auth/status.json` → 校验已有 auth cookie（避免每次重输）
- `POST /api/watch/toggle.json` {instId} → 观察/取消
- `POST /api/refresh.json` → 触发一次全量刷新（需已鉴权）
- `GET /api/watch/list.json` → 已观察 + 最新指标
- `GET /api/trader/[instId].json` → 单个交易员的指标时间序列
- `GET /api/traders.json` → 前 50（SWAP），含 watched 标记

## OKX 数据（public）
- 交易员列表 + AUM：`/api/v5/copytrading/public-lead-traders?instType=SWAP&sortType=overview&limit=20&page=1`
- 指标（规模/收益等）：`/api/v5/copytrading/public-stats?instType=SWAP&uniqueCode=<instId>&lastDays=4`
