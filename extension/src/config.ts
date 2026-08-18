export const DEFAULT_WORKER_URL = 'https://idn-tiktok-spider.toufu8249.workers.dev';

/**
 * 获取当前配置的 Worker API Base URL
 */
export async function getWorkerUrl(): Promise<string> {
  const data = await chrome.storage.sync.get('workerUrl');
  return data.workerUrl || DEFAULT_WORKER_URL;
}

/**
 * 更新 Worker API Base URL
 */
export async function setWorkerUrl(url: string): Promise<void> {
  const cleanUrl = url.replace(/\/+$/, '');
  await chrome.storage.sync.set({ workerUrl: cleanUrl });
}
