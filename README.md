# IDN TikTok Spider (MVP)

基于 **Chrome 插件众包采集 + Cloudflare Workers 后端 + Cloudflare Access 身份认证** 的 Tokopedia / TikTok Shop 店铺与商品监控平台。

## 架构概览

- **`extension/`**：Chrome MV3 扩展。通过 `chrome.alarms` 定时唤醒，在真实住宅网络与浏览器环境下抓取 Tokopedia 店铺商品与评论，绕过 Akamai 风控并自动上报数据。
- **`worker/`**：Cloudflare Workers 后端。基于 Hono 框架与 Cloudflare D1 关系型数据库，提供 RESTful API，通过 Cloudflare Access（Zero Trust）实现 Google 登录与多租户 `user_id` 数据隔离。
- **`shared/`**：TypeScript 共享数据模型定义（商品、快照、SKU、评论等）。

---

## 快速开始

### 1. 准备工作
- 安装 Node.js 18+
- 安装 Cloudflare Wrangler CLI (`npm i -g wrangler`)
- Cloudflare 账号并配置 Zero Trust (Cloudflare Access)

---

### 2. 后端部署 (Cloudflare Worker + D1)

```bash
cd worker
npm install

# 1. 创建 D1 数据库
npx wrangler d1 create idn-tiktok-spider-db
# 将输出的 database_id 填入 worker/wrangler.toml 中的 database_id 字段

# 2. 执行数据库建表
npx wrangler d1 execute idn-tiktok-spider-db --file=src/schema.sql

# 3. 部署 Worker
npx wrangler deploy
```

部署完成后，记录你的 Worker 域名（例如：`https://idn-tiktok-spider.<subdomain>.workers.dev`）。

---

### 3. 配置 Cloudflare Access (Zero Trust)

1. 进入 **Cloudflare Zero Trust 控制台** -> **Access** -> **Applications** -> 点击 **Add an Application** -> 选择 **Self-hosted**。
2. 配置应用：
   - **Application name**: `IDN TikTok Spider`
   - **Application domain**: 填入你的 Worker 域名（例如 `idn-tiktok-spider.<subdomain>.workers.dev`）
   - **Identity providers**: 选择 Google / Google Workspace
3. 配置 Policy：
   - 规则类型：Allow
   - Include: Emails / Emails ending in 你的团队邮箱域名
4. 保存生效。

---

### 4. Chrome 插件安装与使用

```bash
cd extension
npm install
npm run build
```

构建完成后产物位于 `extension/dist/` 目录：
1. 打开 Chrome 浏览器，访问 `chrome://extensions/`。
2. 开启右上角 **「开发者模式」**。
3. 点击 **「加载已解压的扩展程序」**，选择 `idn_tiktok_sipder/extension/dist` 目录。
4. 点击插件图标打开 Popup：
   - 点击 **「设置 API」**，输入部署好的 Worker 域名。
   - 点击 **「打开 Dashboard」** 并在浏览器中完成 Google 账号登录。
   - 在输入框粘贴 Tokopedia 店铺链接（例如 `https://www.tokopedia.com/shopname`），点击 **「添加监控」**。
   - 插件将每日自动定时唤醒扫描，或点击 **「立即执行一次扫描」** 手动触发。

---

### 5. API 接口文档

所有 `/api/v1/*` 接口需携带 Cloudflare Access JWT 认证（浏览器与插件自动携带 Cookie）。

| Method | Path | 描述 |
|--------|------|------|
| GET | `/api/health` | 公开健康检查 |
| GET | `/dashboard` | 控制台 Web UI |
| GET | `/api/v1/shops` | 获取当前用户监控的店铺列表 |
| POST | `/api/v1/shops` | 添加监控店铺 (`{ url: string }`) |
| GET | `/api/v1/shops/:id` | 获取指定店铺信息 |
| GET | `/api/v1/shops/:id/products` | 获取指定店铺下的所有已采集商品 |
| DELETE | `/api/v1/shops/:id` | 删除监控店铺 |
| POST | `/api/v1/shops/:id/scan` | 插件上报店铺扫描完成与商品数 |
| GET | `/api/v1/products` | 列出当前用户所有商品 |
| GET | `/api/v1/products/:id` | 获取商品详情（含最新快照与属性合并） |
| POST | `/api/v1/products/submit` | 插件上报商品数据与生成新快照 |
| GET | `/api/v1/products/:id/stats` | 查询商品历史日级统计（销量/库存变动） |
| GET | `/api/v1/products/:id/skus` | 查询商品各 SKU 库存快照 |
| GET | `/api/v1/products/:id/reviews` | 查询商品评论列表 |
| POST | `/api/v1/products/:id/reviews/submit` | 插件上报商品评论 |

---

## 目录结构

```
idn_tiktok_sipder/
├── extension/                 # Chrome MV3 插件
│   ├── build.mjs              # esbuild 打包脚本
│   ├── manifest.json          # MV3 清单文件
│   ├── src/
│   │   ├── background.ts      # Service Worker 调度器 (alarms + fetch)
│   │   ├── content-shop.ts    # 店铺页滚动与商品链接提取
│   │   ├── popup.html / ts    # 插件弹出层交互
│   │   ├── scraper.ts         # 商品页 __cache Apollo 解析
│   │   ├── review-scraper.ts  # GraphQL 评论采集
│   │   ├── resolve.ts         # 链接分类与归一化
│   │   └── config.ts          # API 节点配置管理
│   └── dist/                  # 插件构建输出目录 (可直接加载)
├── worker/                    # Cloudflare Workers 后端
│   ├── wrangler.toml          # Wrangler 配置文件
│   ├── src/
│   │   ├── index.ts           # Hono 应用入口与 Dashboard UI
│   │   ├── auth.ts            # Cloudflare Access JWT 校验与 Email 提取
│   │   ├── db.ts              # D1 数据库查询与快照差值计算
│   │   ├── schema.sql         # D1 建表与索引
│   │   └── routes/            # 路由拆分 (shops, products, reviews)
│   └── package.json
├── shared/
│   └── types.ts               # 前后端共享 TypeScript 类型
└── README.md
```
