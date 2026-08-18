import { Hono } from 'hono';
import { AppContext } from '../auth';
import { listReviews, upsertReviews, countReviews } from '../db';
import { NormalizedReview } from '../../../shared/types';

export const reviewRoutes = new Hono<AppContext>();

/**
 * 查询商品评论列表
 * GET /api/v1/products/:id/reviews
 */
reviewRoutes.get('/products/:id/reviews', async (c) => {
  const productId = c.req.param('id');
  const limitQuery = c.req.query('limit');
  const limit = Math.min(parseInt(limitQuery || '200', 10) || 200, 1000);

  const reviews = await listReviews(c.env.DB, productId, limit);
  const total = await countReviews(c.env.DB, productId);

  return c.json({
    product_id: productId,
    total,
    reviews,
  });
});

/**
 * 接收插件上报的商品评论
 * POST /api/v1/products/:id/reviews/submit
 */
reviewRoutes.post('/products/:id/reviews/submit', async (c) => {
  const productId = c.req.param('id');
  const body = (await c.req.json().catch(() => null)) as {
    reviews?: NormalizedReview[];
  } | null;

  const reviews = body?.reviews || [];
  const inserted = await upsertReviews(c.env.DB, productId, reviews);
  const total = await countReviews(c.env.DB, productId);

  return c.json({
    ok: true,
    product_id: productId,
    inserted,
    total,
  });
});
