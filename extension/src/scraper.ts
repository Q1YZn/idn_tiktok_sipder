import { ScrapedProduct, ParsedVariants, RatingBreakdown } from '../../shared/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 抓取 HTML（带超时与重试） */
export async function fetchHtml(
  url: string,
  { retries = 2, timeoutMs = 30000 }: { retries?: number; timeoutMs?: number } = {}
): Promise<string> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
        },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** 从 HTML 中提取 window.__cache 的 JSON 对象（Apollo 缓存，花括号配平，健壮） */
export function extractCache(html: string): Record<string, any> {
  const marker = 'window.__cache=';
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error('未找到 window.__cache');
  const brace = html.indexOf('{', idx + marker.length);
  if (brace === -1) throw new Error('未找到 JSON 起始');

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = brace; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(brace, i + 1));
    }
  }
  throw new Error('JSON 未闭合');
}

/** 按 __typename 收集所有实体 */
function collectByType(node: any): Record<string, any[]> {
  const byType: Record<string, any[]> = {};
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.__typename === 'string') {
      (byType[o.__typename] ||= []).push(o);
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(node);
  return byType;
}

function toNum(v: any): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 解析 SKU variant 数据 */
export function parseVariants(cache: any): ParsedVariants | null {
  const byType = collectByType(cache);
  const snapshotVariant = byType['pdpContentSnapshotVariant']?.[0];
  const variantData = byType['pdpDataProductVariant']?.[0];
  if (!snapshotVariant || !snapshotVariant.isVariant || !variantData) return null;

  const children = byType['pdpProductVariantChildren'] || [];
  const stocks = byType['pdpProductVariantStock'] || [];
  const options = byType['pdpProductVariantOption'] || [];
  const outputs = byType['pdpProductVariantOutput'] || [];

  const groups = outputs.map((o: any) => ({
    id: o.variantID,
    name: o.name,
    identifier: o.identifier,
  }));

  const optionMap = new Map(options.map((o: any) => [o.productVariantOptionID, o]));

  const skus = children.map((child: any, i: number) => {
    const optNames = (child.optionName?.json || []).map((id: any) => {
      const opt = optionMap.get(String(id));
      return opt?.value || String(id);
    });

    const stockEntity = stocks[i];
    return {
      productID: child.productID,
      ttsPID: child.ttsPID,
      ttsSKUID: child.ttsSKUID,
      name: child.productName,
      url: child.productURL,
      price: toNum(child.price),
      priceFmt: child.priceFmt || null,
      slashPriceFmt: child.slashPriceFmt || null,
      discount: child.discPercentage || null,
      isCOD: child.isCOD,
      optionNames: optNames,
      stock: toNum(stockEntity?.stock),
      maxOrder: toNum(stockEntity?.maximumOrder),
      minOrder: toNum(stockEntity?.minimumOrder),
      isBuyable: stockEntity?.isBuyable,
    };
  });

  return {
    parentID: variantData.parentID,
    isVariant: true,
    totalStockFmt: variantData.totalStockFmt || null,
    groups,
    skus,
  };
}

/** 解析单个商品（含 variant/SKU 数据） */
export function parseProduct(cache: any): ScrapedProduct | null {
  const byType = collectByType(cache);
  const basic = byType.pdpBasicInfo?.[0];
  if (!basic) return null;

  const tx = byType.pdpTxStats?.[0];
  const stats = byType.pdpStats?.[0];
  const content = byType.pdpDataProductContent?.[0];
  const price = byType.pdpContentSnapshotPrice?.[0];
  const stock = byType.pdpContentSnapshotStock?.[0];
  const variants = parseVariants(cache);

  const imageUrlSet = new Set<string>();
  for (const m of byType.pdpContentSnapshotMedia || []) {
    if (m?.type === 'image' && m.URLOriginal) imageUrlSet.add(m.URLOriginal);
  }
  const images = [...imageUrlSet];

  const ratingBreakdown: RatingBreakdown[] = (byType.productrevRatingDetail || [])
    .map((d: any) => ({ rate: toNum(d.rate), totalReviews: toNum(d.totalReviews) }))
    .filter((d: any) => d.rate !== null && d.totalReviews !== null)
    .sort((a: any, b: any) => (a.rate ?? 0) - (b.rate ?? 0));
  const reviewPositivePct = byType.productrevProductRating?.[0]?.positivePercentageFmt ?? null;

  return {
    productID: basic.productID,
    ttsPID: basic.ttsPID,
    shopID: basic.shopID,
    shopName: basic.shopName,
    name: content?.name ?? null,
    url: basic.url,
    price: toNum(price?.value),
    priceFmt: price?.priceFmt ?? null,
    slashPriceFmt: price?.slashPriceFmt ?? null,
    discount: price?.discPercentage ?? null,
    stock: toNum(stock?.value),
    soldCount: toNum(tx?.countSold),
    soldCountFmt: tx?.itemSoldFmt ?? null,
    viewCount: toNum(stats?.countView),
    reviewCount: toNum(stats?.countReview),
    rating: toNum(stats?.rating),
    countTalk: toNum(stats?.countTalk),
    imageMain: basic.defaultMediaURL ?? null,
    images,
    ratingBreakdown,
    reviewPositivePct,
    isVariant: variants?.isVariant ?? false,
    variants: variants ?? undefined,
    capturedAt: new Date().toISOString(),
  };
}

/** 抓取单个商品详情 */
export async function scrapeProduct(url: string): Promise<ScrapedProduct> {
  const html = await fetchHtml(url);
  const cache = extractCache(html);
  const p = parseProduct(cache);
  if (!p) throw new Error('未解析到商品数据（可能触发风控）');
  return p;
}
