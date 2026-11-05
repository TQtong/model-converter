import { Unzip, UnzipInflate } from 'fflate'
import { ModelError, type SourceFile } from './types'

export const MAX_BYTES = 1024 ** 3
export const MEMORY_WARNING_BYTES = 256 * 1024 ** 2
export const extension = (path: string) => path.split('.').pop()?.toLowerCase() ?? ''
export const basename = (path: string) => path.split('/').pop() ?? path
export const stem = (path: string) => basename(path).replace(/\.[^.]+$/, '')

/** 导入路径不允许绝对地址或越界；保留大小写与中文文件名。 */
export function safePath(path: string): string {
  const cleaned = path.replaceAll('\\', '/').normalize('NFC')
  if (/^(?:\/|[a-z]:|[a-z]+:)/i.test(cleaned) || /[\u0000-\u001f]/.test(cleaned))
    throw new ModelError('PATH', `不安全的文件路径：${path}`)
  const parts: string[] = []
  for (const part of cleaned.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new ModelError('PATH', `文件路径越出导入目录：${path}`)
      parts.pop()
    } else parts.push(part)
  }
  if (!parts.length) throw new ModelError('PATH', '文件路径为空')
  return parts.join('/')
}

export function resolveResource(files: SourceFile[], source: string, uri: string): SourceFile {
  if (/^(?:[a-z]+:|\/\/|\/)/i.test(uri))
    throw new ModelError('EXTERNAL_RESOURCE', `已阻止外部资源请求：${uri}。请将资源一起导入。`)
  let decoded: string
  try {
    decoded = decodeURIComponent(uri.split(/[?#]/)[0])
  } catch {
    throw new ModelError('PATH', `资源路径编码无效：${uri}`)
  }
  const folder = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : ''
  const path = safePath(folder + decoded)
  const exact = files.find((file) => file.path === path)
  if (exact) return exact
  const insensitive = files.filter((file) => file.path.toLowerCase() === path.toLowerCase())
  if (insensitive.length === 1) return insensitive[0]
  throw new ModelError('MISSING_RESOURCE', `缺少配套资源：${path}。请保留目录结构并补充导入。`)
}

export function checkSize(files: SourceFile[]) {
  const total = files.reduce((size, entry) => size + entry.file.size, 0)
  if (total > MAX_BYTES)
    throw new ModelError('SIZE', '单任务导入总量超过 1 GiB 上限。请拆分文件后重试。')
  return total
}

/** 流式解压并在输出每一块时计数，防止 ZIP 炸弹先分配完整缓冲。 */
export async function expandZip(
  file: File,
  prefix = '',
  signal?: AbortSignal,
): Promise<SourceFile[]> {
  const result: SourceFile[] = []
  let total = 0
  let entryCount = 0
  let failure: Error | undefined
  const unzip = new Unzip((entry) => {
    try {
      if (++entryCount > 10000)
        throw new ModelError('ZIP', 'ZIP 文件条目超过 10000 个，请拆分导入。')
      const path = safePath(prefix + entry.name)
      if (entry.name.endsWith('/')) return
      if (entry.originalSize !== undefined && total + entry.originalSize > MAX_BYTES)
        throw new ModelError('SIZE', 'ZIP 解压后超过 1 GiB 上限。')
      const chunks: Uint8Array<ArrayBuffer>[] = []
      entry.ondata = (error, chunk, final) => {
        if (error) {
          failure = error
          return
        }
        total += chunk.length
        if (total > MAX_BYTES) {
          failure = new ModelError('SIZE', 'ZIP 解压后超过 1 GiB 上限。')
          entry.terminate()
          return
        }
        chunks.push(new Uint8Array(chunk))
        if (final) result.push({ path, file: new File(chunks, basename(path)) })
      }
      entry.start()
    } catch (error) {
      failure = error as Error
      entry.terminate()
    }
  })
  unzip.register(UnzipInflate)
  const reader = file.stream().getReader()
  try {
    while (true) {
      signal?.throwIfAborted()
      const { value, done } = await reader.read()
      unzip.push(value ?? new Uint8Array(), done)
      if (failure) throw failure
      if (done) break
      // 给主线程一次绘制和取消机会。
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return result
}

export async function collectFiles(input: File[], signal?: AbortSignal): Promise<SourceFile[]> {
  const originals = input.map((file) => ({
    path: safePath(file.webkitRelativePath || file.name),
    file,
  }))
  checkSize(originals)
  const files: SourceFile[] = []
  for (const entry of originals) {
    signal?.throwIfAborted()
    if (extension(entry.path) === 'zip') {
      files.push(
        ...(await expandZip(
          entry.file,
          entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/') + 1) : '',
          signal,
        )),
      )
    } else files.push(entry)
    checkSize(files)
  }
  const paths = new Set<string>()
  for (const entry of files) {
    if (paths.has(entry.path)) throw new ModelError('DUPLICATE', `导入了重复路径：${entry.path}`)
    paths.add(entry.path)
  }
  return files
}

/** 文件夹拖放递归读取，不能只使用 DataTransfer.files 丢失子目录。 */
export async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const output: File[] = []
  async function walk(entry: FileSystemEntry, prefix = ''): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      )
      Object.defineProperty(file, 'webkitRelativePath', { value: prefix + file.name })
      output.push(file)
    } else {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      while (true) {
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        )
        if (!entries.length) break
        for (const child of entries) await walk(child, prefix + entry.name + '/')
      }
    }
  }
  const entries = Array.from(transfer.items, (item) => item.webkitGetAsEntry()).filter(
    Boolean,
  ) as FileSystemEntry[]
  if (entries.length) for (const entry of entries) await walk(entry)
  else output.push(...Array.from(transfer.files))
  return output
}
