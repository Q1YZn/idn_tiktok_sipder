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
 * Body: { url: string } or { shop_id: string, shop_name?: string, url?: string }
 */
shopRoutes.post('/', async (c) => {
  const userId = c.get('userEmail');
  const body = await c.req.json().catch(() => ({}));
  const { url, shop_id, shop_name, active_products } = body;

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
      });
    }
  }

  return c.json({ ok: true, shop_id: shopId, scanned_at: new Date().toISOString() });
});
