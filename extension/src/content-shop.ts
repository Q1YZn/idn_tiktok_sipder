// Content script: 店铺页滚动提取商品链接 (移植自 shop_scraper.mjs)

export interface ExtractResult {
  shopSlug: string;
  challenge: boolean;
  products: Array<{ href: string; text: string }>;
}

async function extractShopProducts(maxScroll: number = 20): Promise<ExtractResult> {
  const path = window.location.pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  const slug = segments[0] || '';
  const selector = `a[href*="/${slug}/"]`;

  // 轮询等待商品出现
  let started = Date.now();
  while (Date.now() - started < 10000) {
    const count = document.querySelectorAll(selector).length;
    if (count >= 3) break;
    await new Promise((r) => setTimeout(r, 600));
  }

  const productMap = new Map<string, string>();
  let prev = -1;
  let stable = 0;

  for (let i = 0; i < maxScroll; i++) {
    window.scrollBy(0, 1500);
    await new Promise((r) => setTimeout(r, 1000));

    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(selector));
    for (const a of anchors) {
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

    if (productMap.size === prev) {
      if (++stable >= 2) break;
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
        return (
          seg.length >= 2 &&
          !['product', 'review', 'about', 'policy', 'shipping', 'info', 'feed'].includes(
            seg[1].toLowerCase()
          )
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

// 监听 Background 发送的提取指令
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'EXTRACT_SHOP_PRODUCTS') {
    extractShopProducts(message.maxScroll || 20)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // 异步响应
  }
});
