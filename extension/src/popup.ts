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

  // Add shop button
  document.getElementById('add-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('shop-url') as HTMLInputElement;
    const url = input.value.trim();
    if (!url) {
      showStatus('请输入店铺链接', 'error');
      return;
    }

    const btn = document.getElementById('add-btn') as HTMLButtonElement;
    btn.disabled = true;
    showStatus('正在添加店铺...', 'info');

    try {
      const currentWorkerUrl = await getWorkerUrl();
      const res = await fetch(`${currentWorkerUrl}/api/v1/shops`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (res.status === 401) {
        showStatus('未登录，请先点击下方链接打开 Dashboard 完成 Google 认证', 'error');
        return;
      }

      const json = await res.json();
      if (res.ok && json.ok) {
        showStatus(`店铺 [${json.shop.shop_name || json.shop.shop_id}] 添加成功！`, 'success');
        input.value = '';
        // 通知 background 更新本地缓存或触发扫描
        chrome.runtime.sendMessage({ action: 'SHOP_ADDED', shop: json.shop });
      } else {
        showStatus(`添加失败: ${json.error || '未知错误'}`, 'error');
      }
    } catch (err: any) {
      showStatus(`请求失败: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Manual trigger scan
  document.getElementById('scan-now-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('scan-now-btn') as HTMLButtonElement;
    btn.disabled = true;
    showStatus('已触发后台扫描...', 'info');

    chrome.runtime.sendMessage({ action: 'TRIGGER_SCAN' }, (resp) => {
      if (chrome.runtime.lastError) {
        showStatus(`触发失败: ${chrome.runtime.lastError.message}`, 'error');
      } else if (resp?.ok) {
        showStatus('扫描任务正在后台执行中，可在 Dashboard 查看进度', 'success');
      } else {
        showStatus(`扫描返回: ${resp?.message || '无响应'}`, 'info');
      }
      btn.disabled = false;
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
