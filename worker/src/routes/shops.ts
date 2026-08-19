import { Hono } from 'hono';
import { AppContext } from '../auth';
import {
 listShops,
 getShop,
 upsertShop,
 deleteShop,
 getShopProducts,
 updateShopLastScan,
} from '../db';

export const shopRoutes = new Hono<AppContext>();

/**
 * 列出当前用户所有店铺
 * GET /api/v1/shops
 */
shopRoutes.get('/', async (c) => {
 const userId = c.get('userEmail');
 const shops = await listShops(c.env.DB, userId);
 return c.json({ shops });
});

/**
 * 添加/更新监控店铺
 * POST /api/v1/shops
 */
shopRoutes.post('/', async (c) => {
 const userId = c.get('userEmail');
 const body = await c.req.json().catch(() => ({}));
 const { url, shop_id, shop_name, active_products, scan_interval_hours } = body;

 let shopId = shop_id;
 let shopName = shop_name;
 let domain = 'tokopedia.com';

 if (!shopId && url) {
 try {
 const parsedUrl = new URL(url);
 domain = parsedUrl.hostname;
 const segments = parsedUrl.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
 if (segments.length > 0) {
 shopId = segments[0];
 shopName = shopName || segments[0];
 }
 } catch {
 return c.json({ error: '无效的 URL' }, 400);
 }
 }

 if (!shopId) {
 return c.json({ error: '缺少店铺 ID 或 URL' }, 400);
 }

 await upsertShop(c.env.DB, userId, {
 shopID: shopId,
 shopName: shopName || shopId,
 domain,
 url: url || null,
 activeProducts: active_products ?? null,
 scanIntervalHours: scan_interval_hours ?? 24,
 });

 const shop = await getShop(c.env.DB, userId, shopId);
 return c.json({ ok: true, shop });
});

/**
 * 获取单个店铺详情
 * GET /api/v1/shops/:id
 */
shopRoutes.get('/:id', async (c) => {
 const userId = c.get('userEmail');
 const shopId = c.req.param('id');
 const shop = await getShop(c.env.DB, userId, shopId);
 if (!shop) return c.json({ error: '店铺不存在' }, 404);
 return c.json({ shop });
});

/**
 * 获取指定店铺的所有商品
 * GET /api/v1/shops/:id/products
 */
shopRoutes.get('/:id/products', async (c) => {
 const userId = c.get('userEmail');
 const shopId = c.req.param('id');
 const shop = await getShop(c.env.DB, userId, shopId);
 if (!shop) return c.json({ error: '店铺不存在' }, 404);

 const products = await getShopProducts(c.env.DB, userId, shopId);
 return c.json({ shop, products });
});

/**
 * 删除店铺
 * DELETE /api/v1/shops/:id
 */
shopRoutes.delete('/:id', async (c) => {
 const userId = c.get('userEmail');
 const shopId = c.req.param('id');
 await deleteShop(c.env.DB, userId, shopId);
 return c.json({ ok: true, deleted: shopId });
});

/**
 * 插件上报店铺扫描完成
 * POST /api/v1/shops/:id/scan
 */
shopRoutes.post('/:id/scan', async (c) => {
 const userId = c.get('userEmail');
 const shopId = c.req.param('id');
 const body = await c.req.json().catch(() => ({}));
 const { total_products } = body;

 await updateShopLastScan(c.env.DB, userId, shopId);

 if (typeof total_products === 'number') {
 const existing = await getShop(c.env.DB, userId, shopId);
 if (existing) {
 await upsertShop(c.env.DB, userId, {
 shopID: shopId,
 shopName: existing.shop_name,
 domain: existing.domain,
 url: existing.url,
 activeProducts: total_products,
 scanIntervalHours: existing.scan_interval_hours,
 });
 }
 }

 return c.json({ ok: true, shop_id: shopId, scanned_at: new Date().toISOString() });
});

/**
 * 重新扫描全店
 * POST /api/v1/shops/:id/rescan
 */
shopRoutes.post('/:id/rescan', async (c) => {
 const userId = c.get('userEmail');
 const shopId = c.req.param('id');
 const shop = await getShop(c.env.DB, userId, shopId);
 if (!shop) return c.json({ error: '店铺不存在' }, 404);

 await upsertShop(c.env.DB, userId, {
 shopID: shopId,
 shopName: shop.shop_name,
 domain: shop.domain,
 url: shop.url,
 activeProducts: null,
 scanIntervalHours: shop.scan_interval_hours,
 });
 await updateShopLastScan(c.env.DB, userId, shopId);

 return c.json({ ok: true, message: '全店重新扫描任务已触发', shop_id: shopId });
});

/**
 * 更新店铺配置
 * PATCH /api/v1/shops/:id/config
 */
shopRoutes.patch('/:id/config', async (c) => {
 const userId = c.get('userEmail');
 const shopId = c.req.param('id');
 const shop = await getShop(c.env.DB, userId, shopId);
 if (!shop) return c.json({ error: '店铺不存在' }, 404);

 const body = await c.req.json().catch(() => ({}));
 const { scan_interval_hours, enabled } = body;

 await upsertShop(c.env.DB, userId, {
 shopID: shopId,
 shopName: shop.shop_name,
 domain: shop.domain,
 url: shop.url,
 activeProducts: shop.active_products,
 scanIntervalHours: typeof scan_interval_hours === 'number' ? scan_interval_hours : shop.scan_interval_hours,
 });

 const updated = await getShop(c.env.DB, userId, shopId);
 return c.json({ ok: true, shop: updated });
});

/**
 * 云端任务调度：返回当前用户需要扫描的店铺列表
 * GET /api/v1/tasks/pull
 * Query: ?token=<上次拉取时间戳>
 */
shopRoutes.get('/tasks/pull', async (c) => {
 const userId = c.get('userEmail');
 const since = c.req.query('since') || '1970-01-01T00:00:00Z';

 const { results: shops } = await c.env.DB.prepare(
 `SELECT * FROM shops WHERE user_id = ? AND (last_scan_at IS NULL OR last_scan_at < ?) ORDER BY created_at DESC`
 ).bind(userId, since).all<any>();

 // 为每个店铺计算下次扫描时间
 const now = new Date().toISOString();
 const tasks = shops.map((shop: any) => {
 const lastScan = shop.last_scan_at ? new Date(shop.last_scan_at) : null;
 const intervalMs = (shop.scan_interval_hours || 24) * 3600 * 1000;
 const nextScan = lastScan ? new Date(lastScan.getTime() + intervalMs) : new Date(0);
 const due = new Date(now) >= nextScan;

 return {
 shop_id: shop.shop_id,
 shop_name: shop.shop_name,
 url: shop.url,
 scan_interval_hours: shop.scan_interval_hours || 24,
 last_scan_at: shop.last_scan_at,
 next_scan_at: nextScan.toISOString(),
 due,
 };
 });

 return c.json({ tasks, now });
});
