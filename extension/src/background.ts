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
    periodInMinutes: 1440, // 每天一次
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
      .then(() => sendResponse({ ok: true, message: '扫描已开始' }))
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
    console.log('[Background] 收到新添加店铺通知:', message.shop);
    sendResponse({ ok: true });
    return false;
  }
});

/**
 * 解析任意链接（含 vt.tokopedia.com 短链、商品链接、店铺链接）并执行采集
 */
async function resolveAndScrapeUrl(rawUrl: string): Promise<{ type: string; data?: any; message: string }> {
  const workerUrl = await getWorkerUrl();
  console.log('[Background] 正在解析链接:', rawUrl);

  // 1. 打开后台静默 Tab 解析重定向真实 URL
  let finalUrl = rawUrl;
  let tabId: number | undefined;

  try {
    const tab = await chrome.tabs.create({ url: rawUrl, active: false });
    tabId = tab.id;

    if (tabId) {
      finalUrl = await waitForTabRedirect(tabId);
    }
  } catch (err) {
    console.warn('[Background] 重定向等待失败，使用原 URL:', err);
  } finally {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // tab may already be closed
      }
    }
  }

  console.log('[Background] 链接解析为最终真实 URL:', finalUrl);
  const info = classifyUrl(finalUrl);

  // 2. 如果是店铺链接，加入监控并扫描整店
  if (info.type === 'shop') {
    const res = await fetch(`${workerUrl}/api/v1/shops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: finalUrl }),
    });
    const shopJson = await res.json();
    if (shopJson.shop) {
      // 异步执行该店铺扫描
      scanShop(shopJson.shop, workerUrl).catch(console.error);
    }
    return {
      type: 'shop',
      data: shopJson.shop,
      message: `已识别为店铺 [${shopJson.shop?.shop_name || info.shopSlug}]，已加入监控并在后台开始整店全量爬取！`,
    };
  }

  // 3. 如果是商品链接（包括 PDP / shop-id / vt 短链解析出的单个商品）
  try {
    const product: ScrapedProduct = await scrapeProduct(finalUrl);

    // 上报商品
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
        console.warn('[Background] 评论抓取异常:', revErr);
      }
    }

    return {
      type: 'product',
      data: product,
      message: `商品 [${product.name || product.productID}] 采集成功！已录入价格、销量、SKU 及评论。`,
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

    // 15 秒超时兜底
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
async function runFullScan(): Promise<void> {
  const workerUrl = await getWorkerUrl();

  let shops: Shop[] = [];
  try {
    const res = await fetch(`${workerUrl}/api/v1/shops`);
    if (!res.ok) {
      console.error('[Background] 获取店铺列表失败, HTTP status:', res.status);
      return;
    }
    const data = await res.json();
    shops = data.shops || [];
  } catch (e) {
    console.error('[Background] 请求 Worker 店铺列表异常:', e);
    return;
  }

  console.log(`[Background] 开始扫描当前用户的 ${shops.length} 个店铺...`);

  for (const shop of shops) {
    try {
      await scanShop(shop, workerUrl);
    } catch (err) {
      console.error(`[Background] 扫描店铺 [${shop.shop_name || shop.shop_id}] 出错:`, err);
    }
    // 店铺间休息 3 秒
    await sleep(3000);
  }

  console.log('[Background] 本轮所有店铺扫描结束。');
}

/**
 * 扫描单个店铺
 */
async function scanShop(shop: Shop, workerUrl: string): Promise<void> {
  const shopUrl = shop.url || `https://www.tokopedia.com/${shop.shop_id}`;
  console.log(`[Background] 正在扫描店铺: ${shop.shop_name || shop.shop_id} (${shopUrl})`);

  let tabId: number | undefined;
  let productLinks: string[] = [];

  try {
    const tab = await chrome.tabs.create({ url: shopUrl, active: false });
    tabId = tab.id;

    if (tabId) {
      productLinks = await extractLinksFromTab(tabId);
    }
  } catch (err) {
    console.error('[Background] 提取店铺商品链接失败:', err);
  } finally {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // tab may already be closed
      }
    }
  }

  console.log(`[Background] 店铺 [${shop.shop_id}] 提取到 ${productLinks.length} 个商品链接`);

  // 上报店铺扫描状态
  try {
    await fetch(`${workerUrl}/api/v1/shops/${encodeURIComponent(shop.shop_id)}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total_products: productLinks.length }),
    });
  } catch (e) {
    console.error('[Background] 上报店铺扫描状态失败:', e);
  }

  // 2. 逐个商品采集详情与评论并上报
  for (let i = 0; i < productLinks.length; i++) {
    const purl = productLinks[i];
    console.log(`[Background] [${i + 1}/${productLinks.length}] 正在采集商品: ${purl}`);

    try {
      const product: ScrapedProduct = await scrapeProduct(purl);
      product.shopID = shop.shop_id;
      product.shopName = shop.shop_name || shop.shop_id;

      const prodRes = await fetch(`${workerUrl}/api/v1/products/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product),
      });

      if (!prodRes.ok) {
        console.warn(`[Background] 上报商品失败 HTTP ${prodRes.status}: ${purl}`);
      }

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
            console.log(`[Background] 商品 [${product.productID}] 上报 ${reviews.length} 条评论`);
          }
        } catch (revErr) {
          console.warn(`[Background] 抓取评论失败 [${product.productID}]:`, revErr);
        }
      }
    } catch (prodErr) {
      console.error(`[Background] 抓取商品失败 [${purl}]:`, prodErr);
    }

    await sleep(1000 + Math.random() * 1000);
  }
}

/**
 * 等待 Tab 加载完毕并通过 Content Script 提取链接
 */
function extractLinksFromTab(tabId: number): Promise<string[]> {
  return new Promise((resolve) => {
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        setTimeout(() => {
          chrome.tabs.sendMessage(
            tabId,
            { action: 'EXTRACT_SHOP_PRODUCTS', maxScroll: 15 },
            (response) => {
              if (chrome.runtime.lastError || !response?.ok) {
                console.warn('[Background] Content script 提取返回异常:', chrome.runtime.lastError);
                resolve([]);
              } else {
                const links = (response.result?.products || []).map((p: any) => p.href);
                resolve(links);
              }
            }
          );
        }, 2000);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve([]);
    }, 35000);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
