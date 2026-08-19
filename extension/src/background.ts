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
    resolveAndScrapeUrl(message.url)
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
 * 解析任意链接（含短链、单商品、店铺主页）并执行采集
 */
async function resolveAndScrapeUrl(rawUrl: string): Promise<{ type: string; data?: any; message: string }> {
  const workerUrl = await getWorkerUrl();
  console.log('[Background] 正在解析链接:', rawUrl);

  const initialInfo = classifyUrl(rawUrl);

  // 1. 如果输入的是明确的店铺链接（如 tokopedia.com/squish-c）
  if (initialInfo.type === 'shop') {
    const shopSlug = initialInfo.shopSlug!;
    const shopUrl = `https://www.tokopedia.com/${shopSlug}/product`;

    // 1.1 先向 Worker 添加店铺记录
    const res = await fetch(`${workerUrl}/api/v1/shops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl, shop_id: shopSlug, shop_name: shopSlug }),
    });
    const shopJson = await res.json();
    const shop = shopJson.shop || { shop_id: shopSlug, shop_name: shopSlug, url: shopUrl };

    // 1.2 立即触发该店铺全量商品抓取
    const productCount = await scanShop(shop, workerUrl);

    return {
      type: 'shop',
      data: shop,
      message: `店铺 [${shop.shop_name || shopSlug}] 添加成功！已扫描全店并成功采集入库 ${productCount} 个商品及评论。`,
    };
  }

  // 2. 如果是短链接，通过 Tab 获取 302 重定向后的真实目标 URL
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

  console.log('[Background] 链接最终真实 URL:', finalUrl);
  const info = classifyUrl(finalUrl);

  // 3. 重定向后为店铺
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
      message: `店铺 [${shopSlug}] 已加入监控并抓取到 ${productCount} 个商品！`,
    };
  }

  // 4. 重定向后为单个商品
  try {
    const product: ScrapedProduct = await scrapeProduct(finalUrl);

    // 上报商品与快照
    await fetch(`${workerUrl}/api/v1/products/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(product),
    });

    // 抓取并上报评论
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

    return {
      type: 'product',
      data: product,
      message: `商品 [${product.name || product.productID}] 采集成功！已入库规格与评论。`,
    };
  } catch (err: any) {
    throw new Error(`商品数据提取失败: ${err.message}`);
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
  // 直接访问该店铺的商品列表页 /product，确保直接加载商品列表
  const shopUrl = shop.url?.includes('/product') ? shop.url : `https://www.tokopedia.com/${shopSlug}/product`;
  console.log(`[Background] 正在扫描店铺: ${shop.shop_name || shopSlug} (${shopUrl})`);

  let tabId: number | undefined;
  let productLinks: string[] = [];

  try {
    // 创建前台或后台静默 tab
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
  // 等待 Tab 加载完成
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

  // 延时 2 秒等待 React/Vue 水合渲染
  await sleep(2000);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (slug: string) => {
        // 尝试点击 "Produk" tab
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

        // 模拟滚动加载
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

        // 过滤非商品链接
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
