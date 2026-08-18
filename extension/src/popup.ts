import { getWorkerUrl, setWorkerUrl } from './config';

function showStatus(text: string, type: 'success' | 'error' | 'info') {
  const statusEl = document.getElementById('status')!;
  statusEl.textContent = text;
  statusEl.className = `status-${type}`;
}

async function init() {
  const workerUrl = await getWorkerUrl();
  const workerInput = document.getElementById('worker-url-input') as HTMLInputElement;
  const dashboardLink = document.getElementById('dashboard-link') as HTMLAnchorElement;

  if (workerInput) workerInput.value = workerUrl;
  if (dashboardLink) dashboardLink.href = `${workerUrl}/dashboard`;

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
      showStatus('Worker API 节点已更新', 'success');
    }
  });

  // Add shop / scrape link button
  document.getElementById('add-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('shop-url') as HTMLInputElement;
    const url = input.value.trim();
    if (!url) {
      showStatus('请输入店铺链接或短链接', 'error');
      return;
    }

    const btn = document.getElementById('add-btn') as HTMLButtonElement;
    btn.disabled = true;
    showStatus('正在解析链接并采集数据...', 'info');

    chrome.runtime.sendMessage({ action: 'RESOLVE_AND_SCRAPE', url }, (resp) => {
      btn.disabled = false;
      if (chrome.runtime.lastError) {
        showStatus(`请求失败: ${chrome.runtime.lastError.message}`, 'error');
      } else if (resp?.ok) {
        showStatus(resp.result.message, 'success');
        input.value = '';
      } else {
        showStatus(`采集失败: ${resp?.error || '未知错误'}`, 'error');
      }
    });
  });

  // Manual trigger scan
  document.getElementById('scan-now-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('scan-now-btn') as HTMLButtonElement;
    btn.disabled = true;
    showStatus('已触发后台全量扫描...', 'info');

    chrome.runtime.sendMessage({ action: 'TRIGGER_SCAN' }, (resp) => {
      btn.disabled = false;
      if (chrome.runtime.lastError) {
        showStatus(`触发失败: ${chrome.runtime.lastError.message}`, 'error');
      } else if (resp?.ok) {
        showStatus('扫描任务正在后台执行中，可在 Dashboard 查看进度', 'success');
      } else {
        showStatus(`扫描返回: ${resp?.message || '无响应'}`, 'info');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
