import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware, AppContext } from './auth';
import { shopRoutes } from './routes/shops';
import { productRoutes } from './routes/products';
import { reviewRoutes } from './routes/reviews';

const app = new Hono<AppContext>();

app.use(
 '/api/*',
 cors({
 origin: (origin) => {
 if (!origin) return '*';
 if (origin.startsWith('chrome-extension://')) return origin;
 if (origin.includes('localhost') || origin.includes('127.0.0.1')) return origin;
 return origin;
 },
 allowHeaders: ['Content-Type', 'Cf-Access-Jwt-Assertion', 'cf-access-authenticated-user-email', 'x-user-email'],
 allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
 credentials: true,
 })
);

app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.get('/api/v1/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/v1/*', authMiddleware);

app.route('/api/v1/shops', shopRoutes);
app.route('/api/v1/products', productRoutes);
app.route('/api/v1', reviewRoutes);

app.get('/api/v1/me', async (c) => {
 const email = c.get('userEmail');
 const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
 return c.json({ user });
});

app.get('/dashboard', (c) => c.html(getDashboardHtml()));
app.get('/shops/:id', (c) => c.html(getShopDetailHtml()));
app.get('/product/:id', (c) => c.html(getProductDetailHtml()));

app.get('/', (c) => c.redirect('/dashboard'));

function getDashboardHtml(): string {
 return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
 <meta charset="UTF-8" />
 <meta name="viewport" content="width=device-width, initial-scale=1.0" />
 <title>IDN TikTok Spider - 控制台</title>
 <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
 <style>
 :root { --pico-font-size: 90%; }
 .container { max-width: 1200px; padding: 20px; }
 .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
 .badge-success { background: #198754; color: #fff; }
 .badge-secondary { background: #6c757d; color: #fff; }
 .card { padding: 16px; margin-bottom: 20px; border: 1px solid var(--pico-muted-border-color); border-radius: 8px; }
 .grid-2 { display: grid; grid-template-columns: 320px 1fr; gap: 24px; }
 .product-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 4px; }
 .positive-delta { color: #198754; font-weight: bold; }
 .negative-delta { color: #dc3545; font-weight: bold; }
 pre { max-height: 300px; overflow-y: auto; font-size: 12px; }
 .back-btn { margin-bottom: 12px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--pico-primary); text-decoration: none; font-size: 13px; }
 .back-btn:hover { text-decoration: underline; }
 </style>
</head>
<body>
 <main class="container">
 <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
 <div>
 <h2>🕷️ IDN TikTok Spider</h2>
 <p style="margin: 0; color: var(--pico-muted-color);">众包分布式采集平台控制台</p>
 </div>
 <div id="user-info" style="text-align: right;">
 <span id="user-email" class="badge badge-success">加载中...</span>
 </div>
 </header>

 <div class="grid-2">
 <aside>
 <div class="card">
 <h4>添加监控店铺</h4>
 <form id="add-shop-form" onsubmit="event.preventDefault(); addShop();">
 <input type="text" id="shop-input" placeholder="粘贴 Tokopedia 店铺链接或 slug" required />
 <button type="submit" style="width: 100%;">添加店铺</button>
 </form>
 </div>

 <div class="card">
 <h4>监控店铺列表</h4>
 <div id="shop-list">加载中...</div>
 </div>
 </aside>

 <section>
 <div class="card">
 <div style="display: flex; justify-content: space-between; align-items: center;">
 <h4 id="content-title">已采集商品列表</h4>
 <div>
 <button class="outline secondary" onclick="loadProducts()" style="padding: 4px 12px; font-size: 12px; margin-right: 6px;">全部商品</button>
 <button class="outline secondary" onclick="triggerFullScan()" style="padding: 4px 12px; font-size: 12px;">全量扫描</button>
 </div>
 </div>
 <div id="product-container">
 <table id="products-table">
 <thead>
 <tr>
 <th>图片</th>
 <th>商品名称</th>
 <th>价格 (IDR)</th>
 <th>已售 / 变动</th>
 <th>库存 / 变动</th>
 <th>评分 / 评论</th>
 <th>操作</th>
 </tr>
 </thead>
 <tbody id="products-tbody">
 <tr><td colspan="7">正在加载商品...</td></tr>
 </tbody>
 </table>
 </div>
 </div>
 </section>
 </div>
 </main>

 <script>
 const API_BASE = '/api/v1';

 async function fetchApi(path, options = {}) {
 const res = await fetch(API_BASE + path, {
 headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
 ...options
 });
 if (res.status === 401) {
 alert('未认证或登录已过期，请刷新');
 return null;
 }
 return res.json();
 }

 async function init() {
 const me = await fetchApi('/me');
 document.getElementById('user-email').textContent = me?.user?.email || '已登录';
 await loadShops();
 await loadProducts();
 }

 async function loadShops() {
 const data = await fetchApi('/shops');
 const listEl = document.getElementById('shop-list');
 if (!data || !data.shops || data.shops.length === 0) {
 listEl.innerHTML = '<p style="color:var(--pico-muted-color);font-size:13px;">暂无监控店铺</p>';
 return;
 }
 listEl.innerHTML = data.shops.map(s => \`
 <div style="padding: 8px 0; border-bottom: 1px solid var(--pico-muted-border-color); display: flex; justify-content: space-between; align-items: center;">
 <div>
 <strong>\${s.shop_name || s.shop_id}</strong>
 <div style="font-size: 11px; color: var(--pico-muted-color);">
 商品: \${s.active_products ?? '-'} | 上次扫描: \${s.last_scan_at ? new Date(s.last_scan_at).toLocaleDateString() : '未扫描'}
 </div>
 </div>
 <div>
 <a href="/shops/\${s.shop_id}" target="_blank" class="outline secondary" style="padding: 2px 6px; font-size: 11px; margin-right: 4px; text-decoration: none;">查看</a>
 <button class="outline contrast" onclick="deleteShop('\${s.shop_id}')" style="padding: 2px 6px; font-size: 11px;">删</button>
 </div>
 </div>
 \`).join('');
 }

 async function addShop() {
 const input = document.getElementById('shop-input');
 const val = input.value.trim();
 if (!val) return;
 const res = await fetchApi('/shops', {
 method: 'POST',
 body: JSON.stringify({ url: val })
 });
 if (res && res.ok) {
 input.value = '';
 await loadShops();
 } else {
 alert(res?.error || '添加失败');
 }
 }

 async function deleteShop(shopId) {
 if (!confirm('确定删除该店铺的监控吗？')) return;
 await fetchApi('/shops/' + encodeURIComponent(shopId), { method: 'DELETE' });
 await loadShops();
 }

 async function loadProducts() {
 document.getElementById('content-title').textContent = '已采集商品列表';
 const data = await fetchApi('/products');
 renderProductsTable(data?.products || []);
 }

 async function loadShopProducts(shopId, name) {
 document.getElementById('content-title').textContent = '店铺商品: ' + name;
 const data = await fetchApi('/shops/' + encodeURIComponent(shopId) + '/products');
 renderProductsTable(data?.products || []);
 }

 async function triggerFullScan() {
 const btn = event.target;
 btn.disabled = true;
 btn.textContent = '扫描中...';
 try {
 const res = await fetch('/api/v1/products', { method: 'POST' });
 const data = await res.json();
 alert(data.message || '扫描完成');
 await loadProducts();
 } finally {
 btn.disabled = false;
 btn.textContent = '全量扫描';
 }
 }

 function renderProductsTable(products) {
 const tbody = document.getElementById('products-tbody');
 if (!products || products.length === 0) {
 tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--pico-muted-color);">暂无商品数据</td></tr>';
 return;
 }
 tbody.innerHTML = products.map(p => {
 const soldDelta = p.sold_delta != null ? (p.sold_delta > 0 ? \`<span class="positive-delta">+\${p.sold_delta}</span>\` : p.sold_delta) : '-';
 const stockDelta = p.stock_delta != null ? (p.stock_delta < 0 ? \`<span class="negative-delta">\${p.stock_delta}</span>\` : (p.stock_delta > 0 ? \`+\${p.stock_delta}\` : '0')) : '-';
 const img = p.image_url ? \`<img class="product-thumb" src="\${p.image_url}" alt="" />\` : '<div class="product-thumb" style="background:#eee;"></div>';
 const price = p.price ? 'Rp ' + Number(p.price).toLocaleString() : '-';

 return \`
 <tr>
 <td>\${img}</td>
 <td>
 <div style="font-weight: 500; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="\${p.name || ''}">\${p.name || p.product_id}</div>
 <div style="font-size: 11px; color: var(--pico-muted-color);">ID: \${p.product_id} | \${p.shop_name || p.shop_id || ''}</div>
 </td>
 <td>\${price}</td>
 <td>\${p.sold_count ?? '-'} (\${soldDelta})</td>
 <td>\${p.stock ?? '-'} (\${stockDelta})</td>
 <td>⭐ \${p.rating ?? '-'} (\${p.review_count ?? 0})</td>
 <td>
 <a href="/product/\${p.product_id}" target="_blank" class="outline" style="padding: 2px 8px; font-size: 12px; text-decoration: none;">详情</a>
 </td>
 </tr>
 \`;
 }).join('');
 }

 init();
 </script>
</body>
</html>`;
}

function getShopDetailHtml(): string {
 return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
 <meta charset="UTF-8" />
 <meta name="viewport" content="width=device-width, initial-scale=1.0" />
 <title>店铺详情 - IDN TikTok Spider</title>
 <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
 <style>
 :root { --pico-font-size: 90%; }
 .container { max-width: 1100px; padding: 20px; }
 .card { padding: 16px; margin-bottom: 20px; border: 1px solid var(--pico-muted-border-color); border-radius: 8px; }
 .product-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 4px; }
 .positive-delta { color: #198754; font-weight: bold; }
 .negative-delta { color: #dc3545; font-weight: bold; }
 .back-btn { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--pico-primary); text-decoration: none; font-size: 13px; margin-bottom: 12px; }
 .back-btn:hover { text-decoration: underline; }
 </style>
</head>
<body>
 <main class="container">
 <a href="/dashboard" class="back-btn">← 返回控制台</a>

 <div class="card">
 <div id="shop-header">加载中...</div>
 <div style="margin-top: 12px;">
 <button class="outline secondary" onclick="rescanShop()" style="padding: 6px 12px; font-size: 12px;">重新扫描全店</button>
 </div>
 </div>

 <div class="card">
 <h4>店铺商品</h4>
 <table id="products-table">
 <thead>
 <tr>
 <th>图片</th>
 <th>商品名称</th>
 <th>价格 (IDR)</th>
 <th>已售 / 变动</th>
 <th>库存 / 变动</th>
 <th>评分 / 评论</th>
 <th>操作</th>
 </tr>
 </thead>
 <tbody id="products-tbody">
 <tr><td colspan="7">正在加载...</td></tr>
 </tbody>
 </table>
 </div>

 <script>
 const API_BASE = '/api/v1';
 const pathParts = window.location.pathname.split('/');
 const shopId = pathParts[pathParts.length - 1];

 async function fetchApi(path, options = {}) {
 const res = await fetch(API_BASE + path, {
 headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
 ...options
 });
 if (res.status === 401) { alert('未认证'); return null; }
 return res.json();
 }

 async function loadShop() {
 const res = await fetchApi('/shops/' + encodeURIComponent(shopId));
 const shop = res?.shop || {};
 document.getElementById('shop-header').innerHTML = \`
 <div>
 <h3>\${shop.shop_name || shop.shop_id}</h3>
 <p style="font-size: 12px; color: var(--pico-muted-color);">ID: \${shop.shop_id} | 域名: \${shop.domain || '-'}</p>
 <p><strong>商品数量:</strong> \${shop.active_products ?? '-'} | <strong>扫描间隔:</strong> \${shop.scan_interval_hours ?? 24} 小时</p>
 <p style="font-size: 12px; color: var(--pico-muted-color);">上次扫描: \${shop.last_scan_at ? new Date(shop.last_scan_at).toLocaleString() : '未扫描'} | 创建: \${shop.created_at ? new Date(shop.created_at).toLocaleDateString() : '-'}</p>
 </div>
 \`;
 }

 async function loadProducts() {
 const data = await fetchApi('/shops/' + encodeURIComponent(shopId) + '/products');
 const tbody = document.getElementById('products-tbody');
 const products = data?.products || [];
 if (products.length === 0) {
 tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--pico-muted-color);">该店铺暂无商品数据</td></tr>';
 return;
 }
 tbody.innerHTML = products.map(p => {
 const soldDelta = p.sold_delta != null ? (p.sold_delta > 0 ? \`<span class="positive-delta">+\${p.sold_delta}</span>\` : p.sold_delta) : '-';
 const stockDelta = p.stock_delta != null ? (p.stock_delta < 0 ? \`<span class="negative-delta">\${p.stock_delta}</span>\` : (p.stock_delta > 0 ? \`+\${p.stock_delta}\` : '0')) : '-';
 const img = p.image_url ? \`<img class="product-thumb" src="\${p.image_url}" alt="" />\` : '<div class="product-thumb" style="background:#eee;"></div>';
 const price = p.price ? 'Rp ' + Number(p.price).toLocaleString() : '-';
 return \`
 <tr>
 <td>\${img}</td>
 <td>
 <div style="font-weight: 500; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="\${p.name || ''}">\${p.name || p.product_id}</div>
 <div style="font-size: 11px; color: var(--pico-muted-color);">ID: \${p.product_id}</div>
 </td>
 <td>\${price}</td>
 <td>\${p.sold_count ?? '-'} (\${soldDelta})</td>
 <td>\${p.stock ?? '-'} (\${stockDelta})</td>
 <td>⭐ \${p.rating ?? '-'} (\${p.review_count ?? 0})</td>
 <td>
 <a href="/product/\${p.product_id}" target="_blank" class="outline" style="padding: 2px 8px; font-size: 12px; text-decoration: none;">详情</a>
 </td>
 </tr>
 \`;
 }).join('');
 }

 async function rescanShop() {
 const btn = event.target;
 btn.disabled = true;
 btn.textContent = '扫描中...';
 try {
 await fetchApi('/shops/' + encodeURIComponent(shopId) + '/rescan', { method: 'POST' });
 await loadShop();
 await loadProducts();
 alert('全店重新扫描完成');
 } finally {
 btn.disabled = false;
 btn.textContent = '重新扫描全店';
 }
 }

 loadShop();
 loadProducts();
 </script>
 </main>
</body>
</html>`;
}

function getProductDetailHtml(): string {
 return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
 <meta charset="UTF-8" />
 <meta name="viewport" content="width=device-width, initial-scale=1.0" />
 <title>商品详情 - IDN TikTok Spider</title>
 <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
 <style>
 :root { --pico-font-size: 90%; }
 .container { max-width: 1100px; padding: 20px; }
 .product-thumb-large { width: 120px; height: 120px; object-fit: cover; border-radius: 8px; border: 1px solid var(--pico-muted-border-color); }
 .card { padding: 16px; margin-bottom: 20px; border: 1px solid var(--pico-muted-border-color); border-radius: 8px; }
 .back-btn { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--pico-primary); text-decoration: none; font-size: 13px; margin-bottom: 12px; }
 .back-btn:hover { text-decoration: underline; }
 .tabs { display: flex; gap: 8px; margin-bottom: 12px; border-bottom: 1px solid var(--pico-muted-border-color); padding-bottom: 8px; }
 .tab-btn { background: transparent; border: 1px solid var(--pico-muted-border-color); padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
 .tab-btn.active { background: var(--pico-primary); color: white; border-color: var(--pico-primary); }
 .tab-content { display: none; }
 .tab-content.active { display: block; }
 .review-item { border-bottom: 1px dashed var(--pico-muted-border-color); padding: 10px 0; }
 .review-meta { font-size: 12px; color: var(--pico-muted-color); margin-bottom: 4px; }
 .positive-delta { color: #198754; font-weight: bold; }
 .negative-delta { color: #dc3545; font-weight: bold; }
 .sku-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--pico-muted-border-color); font-size: 13px; }
 </style>
</head>
<body>
 <main class="container">
 <a href="/dashboard" class="back-btn">← 返回控制台</a>

 <div class="card">
 <div id="product-header">加载中...</div>
 </div>

 <div class="card">
 <div class="tabs">
 <button class="tab-btn active" onclick="switchTab('overview')">概览</button>
 <button class="tab-btn" onclick="switchTab('skus')">SKU 库存</button>
 <button class="tab-btn" onclick="switchTab('reviews')">评论</button>
 </div>

 <div id="tab-overview" class="tab-content active"></div>
 <div id="tab-skus" class="tab-content"></div>
 <div id="tab-reviews" class="tab-content"></div>
 </div>

 <script>
 const API_BASE = '/api/v1';
 const pid = new URLSearchParams(window.location.search).get('id') || window.location.pathname.split('/product/')[1];

 async function fetchApi(path, options = {}) {
 const res = await fetch(API_BASE + path, {
 headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
 ...options
 });
 if (res.status === 401) { alert('未认证'); return null; }
 return res.json();
 }

 function formatPrice(n) {
 if (n == null) return '-';
 return 'Rp ' + Number(n).toLocaleString();
 }

 async function loadProduct() {
 const pRes = await fetchApi('/products/' + encodeURIComponent(pid));
 if (!pRes) return;

 const p = pRes.product || {};
 document.getElementById('product-header').innerHTML = \`
 <div style="display: flex; gap: 16px; align-items: flex-start;">
 \${p.image_url ? \`<img class="product-thumb-large" src="\${p.image_url}" alt="" />\` : ''}
 <div style="flex: 1;">
 <h3>\${p.name || p.product_id}</h3>
 <p style="color: var(--pico-muted-color); font-size: 12px; margin: 4px 0;">
 ID: \${p.product_id} | \${p.shop_name || p.shop_id || ''}
 </p>
 <p><strong>价格:</strong> \${formatPrice(p.price)}</p>
 <p><strong>累计销量:</strong> \${p.sold_count ?? '-'} (变动: \${p.sold_delta != null ? (p.sold_delta > 0 ? '+' + p.sold_delta : p.sold_delta) : '-'})</p>
 <p><strong>当前库存:</strong> \${p.stock ?? '-'} (变动: \${p.stock_delta != null ? (p.stock_delta > 0 ? '+' + p.stock_delta : p.stock_delta) : '-'})</p>
 <p><strong>评分:</strong> ⭐ \${p.rating ?? '-'} (共 \${p.review_count ?? 0} 条评价)</p>
 <p><strong>浏览量:</strong> \${p.view_count ?? '-'}</p>
 <p style="font-size: 12px; color: var(--pico-muted-color);">采集时间: \${p.captured_at ? new Date(p.captured_at).toLocaleString() : '-'}</p>
 </div>
 </div>
 \`;
 }

 async function loadSkus() {
 const res = await fetchApi('/products/' + encodeURIComponent(pid) + '/skus');
 const container = document.getElementById('tab-skus');
 const skus = res?.skus || [];
 if (skus.length === 0) {
 container.innerHTML = '<p style="color:var(--pico-muted-color);font-size:13px;">该商品无多规格数据</p>';
 return;
 }
 container.innerHTML = skus.map(s => \`
 <div class="sku-row">
 <div>
 <strong>\${s.sku_id}</strong>
 <div style="font-size: 11px; color: var(--pico-muted-color);">\${s.option_names ? JSON.stringify(s.option_names).replace(/\"/g, '') : ''}</div>
 </div>
 <div style="text-align: right;">
 <div>\${formatPrice(s.price)}</div>
 <div style="font-size: 12px;">库存: \${s.stock ?? '-'} (\${s.stock_delta != null ? (s.stock_delta > 0 ? '+' + s.stock_delta : s.stock_delta) : '-'})</div>
 </div>
 </div>
 \`).join('');
 }

 async function loadReviews() {
 const res = await fetchApi('/products/' + encodeURIComponent(pid) + '/reviews');
 const container = document.getElementById('tab-reviews');
 const reviews = res?.reviews || [];
 if (reviews.length === 0) {
 container.innerHTML = '<p style="color:var(--pico-muted-color);font-size:13px;">暂无评论</p>';
 return;
 }
 container.innerHTML = reviews.map(r => \`
 <div class="review-item">
 <div class="review-meta">
 <strong>\${r.user_name || '匿名用户'}</strong> ⭐ \${r.rating ?? ''} \${r.review_time_text || ''}
 </div>
 <p style="margin: 4px 0; font-size: 13px;">\${r.message || '(无文字评价)'}</p>
 </div>
 \`).join('');
 }

 function switchTab(name) {
 document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
 document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
 event.target.classList.add('active');
 document.getElementById('tab-' + name).classList.add('active');
 }

 loadProduct();
 loadSkus();
 loadReviews();
 </script>
 </main>
</body>
</html>`;
}

export default app;
