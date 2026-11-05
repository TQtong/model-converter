import type { Progress } from './types'

/** 每个计算任务独占单线程 Worker；取消直接终止，连同 WASM 堆一起释放。 */
export function background<T>(operation: string, payload: unknown, signal: AbortSignal, progress: (value: Progress) => void): Promise<T> {
  signal.throwIfAborted()
  const worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module' })
  const id = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', cancel); worker.terminate() }
    const cancel = () => { finish(); reject(new DOMException('任务已取消', 'AbortError')) }
    signal.addEventListener('abort', cancel, { once: true })
    worker.onmessage = event => {
      const response = event.data
      if (response.id !== id) return
      if (response.type === 'progress') progress(response.value)
      else {
        finish()
        if (response.type === 'error') reject(Object.assign(new Error(response.message), { code: response.code }))
        else resolve(response.value)
      }
    }
    worker.onerror = error => { finish(); reject(new Error(`后台引擎失败：${error.message || '内存不足或模块加载失败'}`)) }
    worker.postMessage({ id, operation, payload })
  })
}
