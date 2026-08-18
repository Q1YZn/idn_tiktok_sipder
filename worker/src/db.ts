import {
  Shop,
  Product,
  Snapshot,
  SkuSnapshot,
  ScrapedProduct,
  NormalizedReview,
  Review,
  DailyStatRow,
  ParsedVariantSku,
} from '../../shared/types';

/**
 * 插入或更新店铺 (Scoped by user_id)
 */
export async function upsertShop(
  db: D1Database,
  userId: string,
  shop: {
    shopID: string;
    shopName?: string | null;
    domain?: string | null;
    url?: string | null;
    activeProducts?: number | null;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO shops (shop_id, user_id, shop_name, domain, url, active_products)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(shop_id) DO UPDATE SET
       user_id=excluded.user_id,
       shop_name=COALESCE(excluded.shop_name, shops.shop_name),
       domain=COALESCE(excluded.domain, shops.domain),
       url=COALESCE(excluded.url, shops.url),
       active_products=COALESCE(excluded.active_products, shops.active_products)`
    )
    .bind(
      shop.shopID,
      userId,
      shop.shopName ?? null,
      shop.domain ?? null,
      shop.url ?? null,
      shop.activeProducts ?? null
    )
    .run();
}

/**
 * 获取单个店铺
 */
export async function getShop(
  db: D1Database,
  userId: string,
  shopId: string
): Promise<Shop | null> {
  const row = await db
    .prepare('SELECT * FROM shops WHERE shop_id = ? AND user_id = ?')
    .bind(shopId, userId)
    .first<Shop>();
  return row ?? null;
}

/**
 * 列出当前用户所有店铺
 */
export async function listShops(
  db: D1Database,
  userId: string
): Promise<Shop[]> {
  const { results } = await db
    .prepare('SELECT * FROM shops WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<Shop>();
  return results || [];
}

/**
 * 删除店铺
 */
export async function deleteShop(
  db: D1Database,
  userId: string,
  shopId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM shops WHERE shop_id = ? AND user_id = ?')
    .bind(shopId, userId)
    .run();
}

/**
 * 更新店铺最后扫描时间
 */
export async function updateShopLastScan(
  db: D1Database,
  userId: string,
  shopId: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE shops SET last_scan_at = ? WHERE shop_id = ? AND user_id = ?')
    .bind(now, shopId, userId)
    .run();
}

/**
 * 插入或更新商品 (Scoped by user_id)
 */
export async function upsertProduct(
  db: D1Database,
  userId: string,
  p: ScrapedProduct
): Promise<void> {
  const shopId = p.shopID || p.shop_id;
  if (shopId) {
    await upsertShop(db, userId, {
      shopID: shopId,
      shopName: p.shopName ?? null,
      domain: null,
      url: null,
    });
  }

  const imageUrl = p.imageMain ?? (p.images && p.images[0]) ?? null;

  await db
    .prepare(
      `INSERT INTO products (product_id, user_id, tts_pid, shop_id, shop_name, name, url, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET
       user_id=excluded.user_id,
       tts_pid=COALESCE(excluded.tts_pid, products.tts_pid),
       shop_id=COALESCE(excluded.shop_id, products.shop_id),
       shop_name=COALESCE(excluded.shop_name, products.shop_name),
       name=COALESCE(excluded.name, products.name),
       url=COALESCE(excluded.url, products.url),
       image_url=COALESCE(excluded.image_url, products.image_url)`
    )
    .bind(
      p.productID,
      userId,
      p.ttsPID ?? null,
      shopId ?? null,
      p.shopName ?? null,
      p.name ?? null,
      p.url ?? null,
      imageUrl
    )
    .run();
}

/**
 * 同步 SKU 列表（upsert + 删除不存在的）
 */
export async function syncSkus(
  db: D1Database,
  productId: string,
  skus: ParsedVariantSku[]
): Promise<void> {
  const { results: existing } = await db
    .prepare('SELECT sku_id FROM product_skus WHERE product_id = ?')
    .bind(productId)
    .all<{ sku_id: string }>();

  const existingIds = new Set((existing || []).map((r) => r.sku_id));
  const newIds = new Set<string>();

  const stmts: D1PreparedStatement[] = [];

  for (const s of skus) {
    const skuId = s.ttsSKUID || s.productID;
    newIds.add(skuId);

    stmts.push(
      db
        .prepare(
          `INSERT INTO product_skus (sku_id, product_id, tts_sku_id, name, option_names, price, discount, stock, max_order, min_order, is_buyable)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(sku_id) DO UPDATE SET
           name=excluded.name, option_names=excluded.option_names, price=excluded.price,
           discount=excluded.discount, stock=excluded.stock, max_order=excluded.max_order,
           min_order=excluded.min_order, is_buyable=excluded.is_buyable`
        )
        .bind(
          skuId,
          productId,
          s.ttsSKUID ?? null,
          s.name ?? null,
          JSON.stringify(s.optionNames || []),
          s.price ?? null,
          s.discount ?? null,
          s.stock ?? null,
          s.maxOrder ?? null,
          s.minOrder ?? null,
          s.isBuyable ? 1 : 0
        )
    );
  }

  const toDelete = [...existingIds].filter((id) => !newIds.has(id));
  for (const id of toDelete) {
    stmts.push(db.prepare('DELETE FROM product_skus WHERE sku_id = ?').bind(id));
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

/**
 * 获取商品最新快照
 */
export async function getLatestSnapshot(
  db: D1Database,
  productId: string
): Promise<Snapshot | null> {
  const row = await db
    .prepare('SELECT * FROM snapshots WHERE product_id = ? ORDER BY captured_at DESC LIMIT 1')
    .bind(productId)
    .first<Snapshot>();
  return row ?? null;
}

/**
 * 插入产品级快照，并计算与上一次快照的差值
 */
export async function insertSnapshot(
  db: D1Database,
  userId: string,
  p: ScrapedProduct
): Promise<{ soldDelta: number | null; reviewDelta: number | null; stockDelta: number | null }> {
  const prev = await getLatestSnapshot(db, p.productID);

  const soldDelta =
    prev && prev.sold_count != null && p.soldCount != null ? p.soldCount - prev.sold_count : null;
  const reviewDelta =
    prev && prev.review_count != null && p.reviewCount != null ? p.reviewCount - prev.review_count : null;
  const stockDelta =
    prev && prev.stock != null && p.stock != null ? p.stock - prev.stock : null;

  const { capturedAt, productID, ...raw } = p;
  const now = capturedAt || new Date().toISOString();

  const insertRes = await db
    .prepare(
      `INSERT INTO snapshots
       (product_id, captured_at, sold_count, review_count, rating, price, stock, sold_delta, review_delta, stock_delta, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      p.productID,
      now,
      p.soldCount ?? null,
      p.reviewCount ?? null,
      p.rating ?? null,
      p.price ?? null,
      p.stock ?? null,
      soldDelta,
      reviewDelta,
      stockDelta,
      JSON.stringify(raw)
    )
    .run();

  const snapshotId = insertRes.meta.last_row_id;

  if (p.variants?.skus?.length) {
    await syncSkus(db, p.productID, p.variants.skus);

    const { results: skuPrevStocks } = await db
      .prepare(
        `SELECT s.sku_id, s.stock FROM sku_snapshots s
         JOIN snapshots snap ON s.snapshot_id = snap.id
         WHERE snap.product_id = ? ORDER BY s.captured_at DESC`
      )
      .bind(p.productID)
      .all<{ sku_id: string; stock: number | null }>();

    const latestStockBySku: Record<string, number | null> = {};
    for (const row of skuPrevStocks || []) {
      if (!(row.sku_id in latestStockBySku)) {
        latestStockBySku[row.sku_id] = row.stock;
      }
    }

    const skuStmts: D1PreparedStatement[] = [];
    for (const sku of p.variants.skus) {
      const skuId = sku.ttsSKUID || sku.productID;
      const prevStock = latestStockBySku[skuId];
      const skuStockDelta = prevStock != null && sku.stock != null ? sku.stock - prevStock : null;

      skuStmts.push(
        db
          .prepare(
            `INSERT INTO sku_snapshots (sku_id, snapshot_id, captured_at, stock, stock_delta)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(skuId, snapshotId, now, sku.stock ?? null, skuStockDelta)
      );
    }

    if (skuStmts.length > 0) {
      await db.batch(skuStmts);
    }
  }

  return { soldDelta, reviewDelta, stockDelta };
}

/**
 * 查询商品的日级统计
 */
export async function getDailyStats(
  db: D1Database,
  userId: string,
  productId: string,
  days: number = 30
): Promise<DailyStatRow[]> {
  const { results } = await db
    .prepare(
      `SELECT date(captured_at) AS date,
       SUM(sold_delta) AS daily_sold,
       SUM(review_delta) AS daily_review,
       SUM(stock_delta) AS daily_stock_delta,
       MAX(sold_count) AS cum_sold,
       MAX(review_count) AS cum_review,
       MAX(rating) AS rating,
       MAX(price) AS price
       FROM snapshots s
       JOIN products p ON s.product_id = p.product_id
       WHERE s.product_id = ? AND p.user_id = ? AND s.captured_at >= datetime('now', ?)
       GROUP BY date(captured_at)
       ORDER BY date ASC`
    )
    .bind(productId, userId, `-${days} days`)
    .all<DailyStatRow>();

  return results || [];
}

/**
 * 列出当前用户所有商品（含最新快照）
 */
export async function listProducts(
  db: D1Database,
  userId: string
): Promise<Product[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, s.sold_count, s.review_count, s.rating, s.price, s.stock, s.captured_at, s.stock_delta
       FROM products p
       LEFT JOIN snapshots s ON s.id = (SELECT id FROM snapshots WHERE product_id = p.product_id ORDER BY captured_at DESC LIMIT 1)
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`
    )
    .bind(userId)
    .all<Product>();

  return results || [];
}

/**
 * 获取单个商品详情（含 raw_json 合并）
 */
export async function getProduct(
  db: D1Database,
  userId: string,
  productId: string
): Promise<Product | null> {
  const product = await db
    .prepare('SELECT * FROM products WHERE product_id = ? AND user_id = ?')
    .bind(productId, userId)
    .first<Product>();

  if (!product) return null;

  const latestSnap = await db
    .prepare('SELECT * FROM snapshots WHERE product_id = ? ORDER BY captured_at DESC LIMIT 1')
    .bind(productId)
    .first<Snapshot>();

  let merged: Product = { ...product };

  if (latestSnap) {
    let raw: Record<string, unknown> = {};
    if (latestSnap.raw_json) {
      try {
        raw = JSON.parse(latestSnap.raw_json);
      } catch {
        // ignore json parse errors
      }
    }

    merged = {
      ...raw,
      ...product,
      sold_count: latestSnap.sold_count,
      review_count: latestSnap.review_count,
      rating: latestSnap.rating,
      price: latestSnap.price,
      stock: latestSnap.stock,
      captured_at: latestSnap.captured_at,
      sold_delta: latestSnap.sold_delta,
      review_delta: latestSnap.review_delta,
      stock_delta: latestSnap.stock_delta,
    };
  }

  return merged;
}

/**
 * 获取指定店铺的所有商品
 */
export async function getShopProducts(
  db: D1Database,
  userId: string,
  shopId: string
): Promise<Product[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, s.sold_count, s.stock, s.captured_at
       FROM products p
       LEFT JOIN snapshots s ON s.id = (SELECT id FROM snapshots WHERE product_id = p.product_id ORDER BY captured_at DESC LIMIT 1)
       WHERE p.shop_id = ? AND p.user_id = ?
       ORDER BY p.created_at DESC`
    )
    .bind(shopId, userId)
    .all<Product>();

  return results || [];
}

/**
 * 获取商品最新 SKU 库存快照
 */
export async function getSkuSnapshots(
  db: D1Database,
  productId: string
): Promise<SkuSnapshot[]> {
  const { results } = await db
    .prepare(
      `SELECT sk.sku_id, sk.captured_at, sk.stock, sk.stock_delta, psku.option_names, psku.price
       FROM sku_snapshots sk
       JOIN product_skus psku ON sk.sku_id = psku.sku_id
       WHERE psku.product_id = ?
       ORDER BY sk.captured_at DESC`
    )
    .bind(productId)
    .all<SkuSnapshot>();

  return results || [];
}

/**
 * 批量插入/更新商品评论
 */
export async function upsertReviews(
  db: D1Database,
  productId: string,
  reviews: NormalizedReview[]
): Promise<number> {
  if (!reviews || reviews.length === 0) return 0;

  const stmts: D1PreparedStatement[] = [];

  for (const r of reviews) {
    const feedbackId = r.feedback_id != null ? String(r.feedback_id) : null;
    const imageUrls = r.image_urls && r.image_urls.length > 0 ? JSON.stringify(r.image_urls) : null;

    stmts.push(
      db
        .prepare(
          `INSERT INTO reviews (product_id, feedback_id, rating, message, variant_name, review_time, review_time_text, user_name, is_anonymous, image_urls)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(product_id, feedback_id) DO UPDATE SET
           rating=excluded.rating, message=excluded.message, variant_name=excluded.variant_name,
           review_time=excluded.review_time, review_time_text=excluded.review_time_text,
           user_name=excluded.user_name, is_anonymous=excluded.is_anonymous, image_urls=excluded.image_urls`
        )
        .bind(
          productId,
          feedbackId,
          r.rating ?? null,
          r.message ?? null,
          r.variant_name ?? null,
          r.review_time ?? null,
          r.review_time_text ?? null,
          r.user_name ?? null,
          r.is_anonymous ? 1 : 0,
          imageUrls
        )
    );
  }

  await db.batch(stmts);
  return stmts.length;
}

/**
 * 查询商品评论列表
 */
export async function listReviews(
  db: D1Database,
  productId: string,
  limit: number = 200
): Promise<Review[]> {
  const { results } = await db
    .prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY review_time DESC LIMIT ?')
    .bind(productId, limit)
    .all<Review>();

  return results || [];
}

/**
 * 统计商品已入库评论数
 */
export async function countReviews(
  db: D1Database,
  productId: string
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM reviews WHERE product_id = ?')
    .bind(productId)
    .first<{ c: number }>();

  return row?.c ?? 0;
}
