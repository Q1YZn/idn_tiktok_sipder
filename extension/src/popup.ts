import { getWorkerUrl, setWorkerUrl } from './config';

function showStatus(text: string, type: 'success' | 'error' | 'info') {
  const statusEl = document.getElementById('status')!;
  statusEl.innerHTML = text.replace(/\n/g, '<br/>');
  statusEl.className = `status-${type}`;
}

function parseUrls(text: string): string[] {
  return text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

async function checkWorkerHealth(workerUrl: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(`${workerUrl}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function init() {
  const workerUrl = await getWorkerUrl();
  const textarea = document.getElementById('shop-urls') as HTMLTextAreaElement;
  const workerInput = document.getElementById('worker-url-input') as HTMLInputElement;
  const dashboardLink = document.getElementById('dashboard-link') as HTMLAnchorElement;
  const linkCountEl = document.getElementById('link-count') as HTMLElement;

  if (workerInput) workerInput.value = workerUrl;
  if (dashboardLink) dashboardLink.href = `${workerUrl}/dashboard`;

  // Update link count indicator on input
  textarea?.addEventListener('input', () => {
    const urls = parseUrls(textarea.value);
    linkCountEl.textContent = urls.length > 0 ? `已输入 ${urls.length} 条` : '';
  });

  // Settings toggle
  document.getElementById('settings-toggle')?.addEventListener('click', (e) => {
    e.preventDefault();
    const panel = document.getElementById('settings-panel')!;
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // Save worker url
  document.getElementById('save-url-btn')?.addEventListener('click', async () => {
    const newUrl = workerInput.value.trim();
    if (newUrl) {
      await setWorkerUrl(newUrl);
      if (dashboardLink) dashboardLink.href = `${newUrl}/dashboard`;
      showStatus(`Worker API 节点已更新为:\n${newUrl}`, 'success');
    }
  });

  // Add & batch scrape button
  document.getElementById('add-btn')?.addEventListener('click', async () => {
    const urls = parseUrls(textarea.value);
    if (urls.length === 0) {
      showStatus('请在输入框中粘贴至少一条链接（每行一条）', 'error');
      return;
    }

    const currentWorkerUrl = await getWorkerUrl();
    const isHealthy = await checkWorkerHealth(currentWorkerUrl);

    if (!isHealthy) {
      showStatus(
        `⚠️ 无法连接到 Worker 后端服务:\n${currentWorkerUrl}\n\n【排查方法】:\n1. 若为本地测试：请在 worker 目录执行 npm run dev 启动后端，并在下方「设置 API」填入 http://localhost:8787\n2. 若为云端部署：请先完成 wrangler deploy 并配置正确的 Worker 域名。`,
        'error'
      );
      return;
    }

    const btn = document.getElementById('add-btn') as HTMLButtonElement;
    btn.disabled = true;

    let successCount = 0;
    let failCount = 0;
    const logs: string[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      showStatus(
        `正在处理 [${i + 1}/${urls.length}]...\n${url.length > 45 ? url.slice(0, 45) + '...' : url}`,
        'info'
      );

      try {
        const resp: any = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'RESOLVE_AND_SCRAPE', url }, (res) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res || { ok: false, error: '无响应' });
            }
          });
        });

        if (resp.ok) {
          successCount++;
          logs.push(`✅ [${i + 1}] ${resp.result.message}`);
        } else {
          failCount++;
          logs.push(`❌ [${i + 1}] 失败: ${resp.error || '解析错误'}`);
        }
      } catch (err: any) {
        failCount++;
        logs.push(`❌ [${i + 1}] 异常: ${err.message}`);
      }

      if (i < urls.length - 1) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    btn.disabled = false;

    if (failCount === 0) {
      textarea.value = '';
      linkCountEl.textContent = '';
      showStatus(
        `🎉 批量采集完成！共处理 ${urls.length} 条，全部成功入库。\n可点击下方打开 Dashboard 查看明细。`,
        'success'
      );
    } else {
      showStatus(
        `⚠️ 批量处理结束：成功 ${successCount} 条，失败 ${failCount} 条。\n${logs.join('\n')}`,
        'info'
      );
    }
  });

  // Manual trigger full scan
  document.getElementById('scan-now-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('scan-now-btn') as HTMLButtonElement;
    btn.disabled = true;
    showStatus('已触发后台全量扫描...', 'info');

    chrome.runtime.sendMessage({ action: 'TRIGGER_SCAN' }, (resp) => {
      btn.disabled = false;
      if (chrome.runtime.lastError) {
        showStatus(`触发失败: ${chrome.runtime.lastError.message}`, 'error');
      } else if (resp?.ok) {
        showStatus('全量扫描任务正在后台执行中，可在 Dashboard 查看实时进度', 'success');
      } else {
        showStatus(`扫描返回: ${resp?.message || '无响应'}`, 'info');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
