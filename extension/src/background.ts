import { getWorkerUrl } from './config';
import { scrapeProduct } from './scraper';
import { scrapeReviews } from './review-scraper';
import { classifyUrl } from './resolve';
import { Shop, ScrapedProduct } from '../../shared/types';

const ALARM_NAME = 'daily-scan';

// 1. 安装/启动时注册每日定时任务
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] 插件已安装，初始化定时任务...');
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: 1440,
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[Background] 触发定时采集任务:', new Date().toISOString());
    await runFullScan();
  }
});

// 2. 消息监听（Popup 手动触发或添加链接）
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'TRIGGER_SCAN') {
    runFullScan()
      .then((res) => sendResponse({ ok: true, message: `全量扫描完成，共扫描 ${res.scannedShops} 个店铺，采集 ${res.scannedProducts} 个商品！` }))
      .catch((err) => sendResponse({ ok: false, message: err.message }));
    return true;
  }

  if (message.action === 'RESOLVE_AND_SCRAPE') {
    resolveAndScrapeShopFromUrl(message.url)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === 'SHOP_ADDED') {
    sendResponse({ ok: true });
    return false;
  }
});

/**
 * 核心：以店铺为单位进行监控与全量采集（支持输入商品链接/短链接自动反查所属店铺）
 */
async function resolveAndScrapeShopFromUrl(rawUrl: string): Promise<{ type: string; data?: any; message: string }> {
  const workerUrl = await getWorkerUrl();
  console.log('[Background] 正在解析链接并获取所属店铺:', rawUrl);

  const initialInfo = classifyUrl(rawUrl);

  // 1. 如果直接是店铺链接（如 tokopedia.com/squish-c）
  if (initialInfo.type === 'shop') {
    const shopSlug = initialInfo.shopSlug!;
    const shopUrl = `https://www.tokopedia.com/${shopSlug}/product`;

    const res = await fetch(`${workerUrl}/api/v1/shops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl, shop_id: shopSlug, shop_name: shopSlug }),
    });
    const shopJson = await res.json();
    const shop = shopJson.shop || { shop_id: shopSlug, shop_name: shopSlug, url: shopUrl };

    const productCount = await scanShop(shop, workerUrl);

    return {
      type: 'shop',
      data: shop,
      message: `✅ 店铺 [${shop.shop_name || shopSlug}] 已加入监控，已扫描全店并成功入库 ${productCount} 个商品及评论！`,
    };
  }

  // 2. 如果是短链或商品链接，先通过 Tab 获取真实 URL
  let finalUrl = rawUrl;
  let tabId: number | undefined;

  try {
    const tab = await chrome.tabs.create({ url: rawUrl, active: false });
    tabId = tab.id;
    if (tabId) {
      finalUrl = await waitForTabRedirect(tabId);
    }
  } catch (err) {
    console.warn('[Background] 重定向等待失败:', err);
  } finally {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch {}
    }
  }

  console.log('[Background] 链接解析真实目标 URL:', finalUrl);
  const info = classifyUrl(finalUrl);

  if (info.type === 'shop') {
    const shopSlug = info.shopSlug!;
    const res = await fetch(`${workerUrl}/api/v1/shops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: finalUrl, shop_id: shopSlug, shop_name: shopSlug }),
    });
    const shopJson = await res.json();
    const shop = shopJson.shop || { shop_id: shopSlug, shop_name: shopSlug, url: finalUrl };
    const productCount = await scanShop(shop, workerUrl);

    return {
      type: 'shop',
      data: shop,
      message: `✅ 店铺 [${shopSlug}] 已加入监控并抓取到 ${productCount} 个商品！`,
    };
  }

  // 3. 从商品中反查所属店铺，并执行全店采集与监控！
  try {
    const product: ScrapedProduct = await scrapeProduct(finalUrl);

    // 上报该单商品
    await fetch(`${workerUrl}/api/v1/products/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(product),
    });

    // 抓取该商品评论
    if (product.productID) {
      try {
        const { reviews } = await scrapeReviews(product.productID, { limit: 10, maxPages: 2 });
        if (reviews.length > 0) {
          await fetch(
            `${workerUrl}/api/v1/products/${encodeURIComponent(product.productID)}/reviews/submit`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reviews }),
            }
          );
        }
      } catch (revErr) {
        console.warn('[Background] 抓取评论异常:', revErr);
      }
    }

    // 关键：识别该商品所属的店铺 ID / 商家 slug，并加入全店监控
    let targetShopSlug = product.shopID || product.shopName;

    // 若未解析出，从 URL 中提取店铺段（如 tokopedia.com/squish-c/product-123 -> squish-c）
    if (!targetShopSlug) {
      try {
        const u = new URL(finalUrl);
        const segs = u.pathname.split('/').filter(Boolean);
        if (segs.length >= 2 && segs[0] !== 'view' && segs[0] !== 'pdp') {
          targetShopSlug = segs[0];
        }
      } catch {}
    }

    let shopProductCount = 1;
    if (targetShopSlug) {
      console.log(`[Background] 成功从商品反查到所属店铺: ${targetShopSlug}，启动整店全量扫描...`);
      const shopRes = await fetch(`${workerUrl}/api/v1/shops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `https://www.tokopedia.com/${targetShopSlug}`,
          shop_id: targetShopSlug,
          shop_name: product.shopName || targetShopSlug,
        }),
      });
      const shopJson = await shopRes.json();
      const shop = shopJson.shop || { shop_id: targetShopSlug, shop_name: product.shopName || targetShopSlug };

      // 扫描该店铺全量商品
      shopProductCount = await scanShop(shop, workerUrl);

      return {
        type: 'shop',
        data: shop,
        message: `🎯 成功从商品反查出所属店铺 [${shop.shop_name || targetShopSlug}]！已添加整店监控并抓取该店全部 ${shopProductCount} 个商品！`,
      };
    }

    return {
      type: 'product',
      data: product,
      message: `商品 [${product.name || product.productID}] 采集成功！已入库。`,
    };
  } catch (err: any) {
    throw new Error(`商品与所属店铺解析失败: ${err.message}`);
  }
}

/**
 * 等待 Tab 完成 302 重定向并获取最终 URL
 */
function waitForTabRedirect(tabId: number): Promise<string> {
  return new Promise((resolve) => {
    let resolved = false;

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        if (!resolved && tab.url && !tab.url.startsWith('chrome://')) {
          resolved = true;
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tab.url);
        }
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.get(tabId, (t) => resolve(t?.url || ''));
      }
    }, 15000);
  });
}

/**
 * 执行所有店铺全量扫描
 */
async function runFullScan(): Promise<{ scannedShops: number; scannedProducts: number }> {
  const workerUrl = await getWorkerUrl();

  let shops: Shop[] = [];
  try {
    const res = await fetch(`${workerUrl}/api/v1/shops`);
    if (!res.ok) {
      console.error('[Background] 获取店铺列表失败, HTTP status:', res.status);
      return { scannedShops: 0, scannedProducts: 0 };
    }
    const data = await res.json();
    shops = data.shops || [];
  } catch (e) {
    console.error('[Background] 请求 Worker 店铺列表异常:', e);
    return { scannedShops: 0, scannedProducts: 0 };
  }

  console.log(`[Background] 开始全量扫描当前用户的 ${shops.length} 个店铺...`);
  let totalProducts = 0;

  for (const shop of shops) {
    try {
      const count = await scanShop(shop, workerUrl);
      totalProducts += count;
    } catch (err) {
      console.error(`[Background] 扫描店铺 [${shop.shop_name || shop.shop_id}] 出错:`, err);
    }
    await sleep(2000);
  }

  console.log(`[Background] 本轮全量扫描完成，共扫描 ${shops.length} 个店铺，${totalProducts} 个商品。`);
  return { scannedShops: shops.length, scannedProducts: totalProducts };
}

/**
 * 扫描单个店铺并采集商品列表
 * @returns 抓取到的商品总数
 */
async function scanShop(shop: Shop, workerUrl: string): Promise<number> {
  const shopSlug = shop.shop_id;
  const shopUrl = shop.url?.includes('/product') ? shop.url : `https://www.tokopedia.com/${shopSlug}/product`;
  console.log(`[Background] 正在扫描店铺: ${shop.shop_name || shopSlug} (${shopUrl})`);

  let tabId: number | undefined;
  let productLinks: string[] = [];

  try {
    const tab = await chrome.tabs.create({ url: shopUrl, active: false });
    tabId = tab.id;

    if (tabId) {
      productLinks = await extractShopLinksUsingScripting(tabId, shopSlug);
    }
  } catch (err) {
    console.error('[Background] 提取店铺商品链接失败:', err);
  } finally {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch {}
    }
  }

  console.log(`[Background] 店铺 [${shopSlug}] 成功提取到 ${productLinks.length} 个商品链接`);

  // 上报店铺扫描状态
  try {
    await fetch(`${workerUrl}/api/v1/shops/${encodeURIComponent(shopSlug)}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total_products: productLinks.length }),
    });
  } catch (e) {
    console.error('[Background] 上报店铺扫描状态失败:', e);
  }

  // 逐个商品采集
  let scrapedCount = 0;
  for (let i = 0; i < productLinks.length; i++) {
    const purl = productLinks[i];
    console.log(`[Background] [${i + 1}/${productLinks.length}] 正在采集商品: ${purl}`);

    try {
      const product: ScrapedProduct = await scrapeProduct(purl);
      product.shopID = shopSlug;
      product.shopName = shop.shop_name || shopSlug;

      await fetch(`${workerUrl}/api/v1/products/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product),
      });
      scrapedCount++;

      if (product.productID) {
        try {
          const { reviews } = await scrapeReviews(product.productID, { limit: 10, maxPages: 2 });
          if (reviews.length > 0) {
            await fetch(
              `${workerUrl}/api/v1/products/${encodeURIComponent(product.productID)}/reviews/submit`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reviews }),
              }
            );
          }
        } catch (revErr) {
          console.warn(`[Background] 抓取评论失败 [${product.productID}]:`, revErr);
        }
      }
    } catch (prodErr) {
      console.error(`[Background] 抓取商品失败 [${purl}]:`, prodErr);
    }

    await sleep(800 + Math.random() * 800);
  }

  return scrapedCount;
}

/**
 * 在 Tab 内部执行直接 DOM 提取
 */
async function extractShopLinksUsingScripting(tabId: number, shopSlug: string): Promise<string[]> {
  await new Promise<void>((resolve) => {
    const listener = (tid: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (tid === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });

  await sleep(2000);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (slug: string) => {
        const tabEls = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="tab"], div[data-testid*="tab"]'));
        const pTab = tabEls.find((el) => {
          const t = (el.innerText || el.textContent || '').trim().toLowerCase();
          return t === 'produk' || t === 'products' || t === 'semua produk';
        });
        if (pTab) {
          pTab.click();
          await new Promise((r) => setTimeout(r, 1200));
        }

        const productMap = new Set<string>();
        const selectors = [
          `a[href*="/${slug}/"]`,
          'a[data-testid*="linkProduct"]',
          'a[data-testid*="product"]',
          'div[data-testid*="product"] a',
          'div[class*="pcv3"] a',
          'div[class*="card"] a'
        ];

        for (let i = 0; i < 15; i++) {
          window.scrollBy(0, 1200);
          await new Promise((r) => setTimeout(r, 600));

          for (const sel of selectors) {
            for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(sel))) {
              if (a.href && !a.href.startsWith('javascript:')) {
                productMap.add(a.href);
              }
            }
          }
        }

        return Array.from(productMap).filter((href) => {
          try {
            const u = new URL(href);
            const seg = u.pathname.split('/').filter(Boolean);
            if (seg.length < 2) return false;
            const second = seg[1].toLowerCase();
            return !['product', 'review', 'about', 'policy', 'shipping', 'info', 'feed', 'etalase'].includes(second);
          } catch {
            return false;
          }
        });
      },
      args: [shopSlug],
    });

    return (results && results[0]?.result) || [];
  } catch (err) {
    console.error('[Background] 执行 Scripting 失败:', err);
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
