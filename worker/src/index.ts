import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware, AppContext } from './auth';
import { shopRoutes } from './routes/shops';
import { productRoutes } from './routes/products';
import { reviewRoutes } from './routes/reviews';

const app = new Hono<AppContext>();

// CORS 支持 Chrome 插件调用
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

// 健康检查（无需认证）
app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.get('/api/v1/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// 所有 /api/v1/* 路由需认证
app.use('/api/v1/*', authMiddleware);

// 业务路由注册
app.route('/api/v1/shops', shopRoutes);
app.route('/api/v1/products', productRoutes);
app.route('/api/v1', reviewRoutes);

// 用户信息接口
app.get('/api/v1/me', async (c) => {
  const email = c.get('userEmail');
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  return c.json({ user });
});

// Dashboard 静态单页应用 HTML (托管在 Worker 同域，CF Access 认证后直接访问)
app.get('/dashboard', (c) => {
  return c.html(getDashboardHtml());
});

app.get('/', (c) => {
  return c.redirect('/dashboard');
});

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
    .tab-btn { margin-right: 8px; }
    .positive-delta { color: #198754; font-weight: bold; }
    .negative-delta { color: #dc3545; font-weight: bold; }
    pre { max-height: 300px; overflow-y: auto; font-size: 12px; }
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
      <!-- 左侧：店铺管理 -->
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

      <!-- 右侧：商品列表与详情 -->
      <section>
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 id="content-title">已采集商品列表</h4>
            <button class="outline secondary" onclick="loadProducts()" style="padding: 4px 12px; font-size: 12px;">刷新</button>
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

        <!-- 商品详情模态区 -->
        <div id="detail-modal" class="card" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 id="detail-title">商品详情</h4>
            <button class="outline" onclick="closeDetail()" style="padding: 2px 8px;">✕ 关闭</button>
          </div>
          <div id="detail-content"></div>
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
        alert('未认证或登录已过期，请刷新或通过 Cloudflare Access 登录');
        return null;
      }
      return res.json();
    }

    async function init() {
      const me = await fetchApi('/me');
      if (me && me.user) {
        document.getElementById('user-email').textContent = me.user.email;
      } else {
        document.getElementById('user-email').textContent = '已登录';
      }
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
            <button class="outline secondary" onclick="filterShop('\${s.shop_id}', '\${s.shop_name || s.shop_id}')" style="padding: 2px 6px; font-size: 11px; margin-right: 4px;">查看</button>
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

    async function filterShop(shopId, name) {
      document.getElementById('content-title').textContent = '店铺商品: ' + name;
      const data = await fetchApi('/shops/' + encodeURIComponent(shopId) + '/products');
      renderProductsTable(data?.products || []);
    }

    async function loadProducts() {
      document.getElementById('content-title').textContent = '已采集商品列表';
      const data = await fetchApi('/products');
      renderProductsTable(data?.products || []);
    }

    function renderProductsTable(products) {
      const tbody = document.getElementById('products-tbody');
      if (!products || products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--pico-muted-color);">暂无商品数据，插件正在等待定时扫描</td></tr>';
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
              <button class="outline" onclick="showDetail('\${p.product_id}')" style="padding: 2px 8px; font-size: 12px;">详情</button>
            </td>
          </tr>
        \`;
      }).join('');
    }

    async function showDetail(productId) {
      const modal = document.getElementById('detail-modal');
      const content = document.getElementById('detail-content');
      modal.style.display = 'block';
      content.innerHTML = '<p>正在加载详情...</p>';

      const [pRes, revRes, skuRes] = await Promise.all([
        fetchApi('/products/' + encodeURIComponent(productId)),
        fetchApi('/products/' + encodeURIComponent(productId) + '/reviews'),
        fetchApi('/products/' + encodeURIComponent(productId) + '/skus')
      ]);

      const product = pRes?.product || {};
      const reviews = revRes?.reviews || [];
      const skus = skuRes?.skus || [];

      content.innerHTML = \`
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px;">
          <div>
            <h5>\${product.name || product.product_id}</h5>
            <p style="font-size: 12px; color: var(--pico-muted-color);">URL: <a href="\${product.url}" target="_blank">\${product.url || '无'}</a></p>
            <p><strong>价格:</strong> Rp \${product.price ? Number(product.price).toLocaleString() : '-'}</p>
            <p><strong>累计销量:</strong> \${product.sold_count ?? '-'} | <strong>当前库存:</strong> \${product.stock ?? '-'}</p>
            <p><strong>评分:</strong> ⭐ \${product.rating ?? '-'} (共 \${product.review_count ?? 0} 条评价)</p>

            <h6>SKU 库存快照 (\${skus.length})</h6>
            <div style="max-height: 150px; overflow-y: auto; font-size: 12px;">
              \${skus.map(s => \`<div>\${s.sku_id}: 库存 \${s.stock ?? '-'} (变动: \${s.stock_delta ?? 0})</div>\`).join('') || '<p>无多规格数据</p>'}
            </div>
          </div>
          <div>
            <h6>最新评论 (\${reviews.length} 条)</h6>
            <div style="max-height: 300px; overflow-y: auto;">
              \${reviews.map(r => \`
                <div style="border-bottom: 1px dashed var(--pico-muted-border-color); padding: 6px 0; font-size: 12px;">
                  <div><strong>\${r.user_name || '匿名用户'}</strong> ⭐ \${r.rating ?? ''} <span style="color:var(--pico-muted-color);">\${r.review_time_text || ''}</span></div>
                  <p style="margin: 4px 0;">\${r.message || '(无文字评价)'}</p>
                </div>
              \`).join('') || '<p style="font-size:12px;color:var(--pico-muted-color);">暂无已入库评论</p>'}
            </div>
          </div>
        </div>
      \`;
    }

    function closeDetail() {
      document.getElementById('detail-modal').style.display = 'none';
    }

    init();
  </script>
</body>
</html>`;
}

export default app;
