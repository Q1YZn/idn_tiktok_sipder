// Content script: 店铺页滚动提取商品链接

export interface ExtractResult {
  shopSlug: string;
  challenge: boolean;
  products: Array<{ href: string; text: string }>;
}

export async function extractShopProducts(maxScroll: number = 20): Promise<ExtractResult> {
  const path = window.location.pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  const slug = segments[0] || '';

  // 1. 如果在店铺首页，尝试点击 "Produk" 选项卡进入商品列表
  try {
    const tabElements = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="tab"], div[data-testid*="tab"]'));
    const productTab = tabElements.find((el) => {
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      return txt === 'produk' || txt === 'products' || txt === 'semua produk';
    });
    if (productTab) {
      productTab.click();
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch {}

  const selectors = [
    `a[href*="/${slug}/"]`,
    'a[data-testid*="linkProduct"]',
    'a[data-testid*="product"]',
    'div[data-testid*="product"] a',
    'div[class*="Product"] a',
    'div[class*="pcv3"] a',
    'div[class*="card"] a'
  ];

  // 轮询等待商品卡片出现
  let started = Date.now();
  while (Date.now() - started < 8000) {
    let found = 0;
    for (const sel of selectors) {
      found += document.querySelectorAll(sel).length;
    }
    if (found >= 2) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const productMap = new Map<string, string>();
  let prev = -1;
  let stable = 0;

  for (let i = 0; i < maxScroll; i++) {
    window.scrollBy(0, 1200);
    await new Promise((r) => setTimeout(r, 800));

    for (const sel of selectors) {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(sel));
      for (const a of anchors) {
        if (!a.href || a.href.startsWith('javascript:')) continue;
        const href = a.href;
        if (productMap.has(href)) continue;

        const card =
          a.closest('[data-testid*="product"], [class*="card"], [class*="Product"], [class*="item"]') ||
          a.parentElement;
        const text = ((card as HTMLElement)?.innerText || a.innerText || '')
          .slice(0, 200)
          .replace(/\n+/g, ' | ');
        productMap.set(href, text);
      }
    }

    if (productMap.size === prev) {
      if (++stable >= 3) break;
    } else {
      stable = 0;
    }
    prev = productMap.size;
  }

  const challenge = /captcha|验证|slider|challenge|滑动/i.test(document.body.innerText);

  const filteredProducts = Array.from(productMap.entries())
    .map(([href, text]) => ({ href, text }))
    .filter((p) => {
      try {
        const u = new URL(p.href);
        const seg = u.pathname.split('/').filter(Boolean);
        if (seg.length < 2) return false;
        const secondSeg = seg[1].toLowerCase();
        return !['product', 'review', 'about', 'policy', 'shipping', 'info', 'feed', 'etalase'].includes(
          secondSeg
        );
      } catch {
        return false;
      }
    });

  return {
    shopSlug: slug,
    challenge,
    products: filteredProducts,
  };
}

// 监听 Background 指令
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'EXTRACT_SHOP_PRODUCTS') {
    extractShopProducts(message.maxScroll || 20)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
