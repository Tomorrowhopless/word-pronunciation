export function createModelClient() {
  let worker, serial = 0;
  const pending = new Map();
  function reset(error) {
    worker?.terminate(); worker = null;
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error); }
    pending.clear();
  }
  function request(action, values = {}) {
    if (!worker) {
      worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
      const currentWorker = worker;
      worker.onmessage = ({ data }) => {
        const task = pending.get(data.id); if (!task) return;
        pending.delete(data.id); clearTimeout(task.timer);
        if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
      };
      worker.onerror = () => { if (worker === currentWorker) reset(new Error('模型服务无法启动，请刷新页面后重试。')); };
      worker.onmessageerror = () => { if (worker === currentWorker) reset(new Error('模型响应无法读取，请重试。')); };
    }
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reset(new Error('模型加载超时，请检查网络后重试。')), 300000);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, action, ...values }); }
      catch { reset(new Error('模型请求无法发送，请重试。')); }
    });
  }
  return { request, close: () => reset(new Error('页面已关闭。')) };
}
