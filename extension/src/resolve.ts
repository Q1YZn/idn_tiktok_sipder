export interface ClassifyResult {
  type: 'product' | 'shop' | 'short_link' | 'invalid';
  url: string;
  shopSlug?: string;
  productId?: string;
}

/**
 * 链接解析：判断链接类型（短链/商品/店铺），归一化
 */
export function classifyUrl(raw: string): ClassifyResult {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { type: 'invalid', url: raw };
  }

  const hostname = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);

  // 1. TikTok / Tokopedia 分享短链: vt.tokopedia.com/t/... 或 vt.tiktok.com/t/...
  if (hostname.includes('vt.tokopedia.com') || hostname.includes('vt.tiktok.com')) {
    return { type: 'short_link', url: u.href };
  }

  // 2. 官方 PDP 商品页: shop-id.tokopedia.com/view/product/{id} 或 /pdp/{slug}/{id}
  if (
    hostname.includes('shop-id.tokopedia.com') ||
    path.includes('/pdp/') ||
    path.includes('/view/product/')
  ) {
    const pid = segments[segments.length - 1];
    return { type: 'product', url: u.href, productId: pid };
  }

  // 3. 常规商品页: /{shop}/{slug}-{ttsPID}（2 段及以上）
  if (segments.length >= 2) {
    return { type: 'product', url: u.href };
  }

  // 4. 常规店铺页: /{shop-slug}（1 段）
  if (segments.length === 1) {
    return { type: 'shop', url: u.href, shopSlug: segments[0] };
  }

  return { type: 'invalid', url: u.href };
}
