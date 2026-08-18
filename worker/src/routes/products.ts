import { Hono } from 'hono';
import { AppContext } from '../auth';
import {
  listProducts,
  getProduct,
  upsertProduct,
  insertSnapshot,
  getDailyStats,
  getSkuSnapshots,
} from '../db';
import { ScrapedProduct } from '../../../shared/types';

export const productRoutes = new Hono<AppContext>();

/**
 * 列出当前用户所有商品
 * GET /api/v1/products
 */
productRoutes.get('/', async (c) => {
  const userId = c.get('userEmail');
  const products = await listProducts(c.env.DB, userId);
  return c.json({ products });
});

/**
 * 接收插件上报的商品数据
 * POST /api/v1/products/submit
 */
productRoutes.post('/submit', async (c) => {
  const userId = c.get('userEmail');
  const body = (await c.req.json().catch(() => null)) as ScrapedProduct | null;

  if (!body || !body.productID) {
    return c.json({ error: '缺少 productID 字段' }, 400);
  }

  try {
    await upsertProduct(c.env.DB, userId, body);
    const delta = await insertSnapshot(c.env.DB, userId, body);

    return c.json({
      ok: true,
      product_id: body.productID,
      delta,
    });
  } catch (err: any) {
    console.error('Failed to submit product:', err);
    return c.json({ error: err.message || '入库失败' }, 500);
  }
});

/**
 * 查询单个商品（含最新快照与 raw_json 合并）
 * GET /api/v1/products/:id
 */
productRoutes.get('/:id', async (c) => {
  const userId = c.get('userEmail');
  const productId = c.req.param('id');
  const product = await getProduct(c.env.DB, userId, productId);

  if (!product) {
    return c.json({ error: '商品不存在' }, 404);
  }

  return c.json({ product });
});

/**
 * 查询商品日级统计
 * GET /api/v1/products/:id/stats
 */
productRoutes.get('/:id/stats', async (c) => {
  const userId = c.get('userEmail');
  const productId = c.req.param('id');
  const daysQuery = c.req.query('days');
  const days = parseInt(daysQuery || '30', 10) || 30;

  const series = await getDailyStats(c.env.DB, userId, productId, days);
  return c.json({ product_id: productId, days, series });
});

/**
 * 查询商品 SKU 库存快照
 * GET /api/v1/products/:id/skus
 */
productRoutes.get('/:id/skus', async (c) => {
  const productId = c.req.param('id');
  const skus = await getSkuSnapshots(c.env.DB, productId);
  return c.json({ product_id: productId, skus });
});
