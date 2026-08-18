export interface ClassifyResult {
  type: 'product' | 'shop' | 'invalid';
  url: string;
  shopSlug?: string;
}

/**
 * 链接解析：判断链接类型（商品/店铺），归一化
 */
export function classifyUrl(raw: string): ClassifyResult {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { type: 'invalid', url: raw };
  }
  const path = u.pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);

  // 官方 pdp 短链 shop-id.tokopedia.com/pdp/{slug}/{id}
  if (u.hostname.includes('shop-id.tokopedia.com') || path.includes('/pdp/')) {
    return { type: 'product', url: u.href };
  }
  // 商品页 /{shop}/{slug}-{ttsPID}（2 段及以上）
  if (segments.length >= 2) {
    return { type: 'product', url: u.href };
  }
  // 店铺页 /{shop-slug}（1 段）
  if (segments.length === 1) {
    return { type: 'shop', url: u.href, shopSlug: segments[0] };
  }
  return { type: 'invalid', url: u.href };
}
