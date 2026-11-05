import { Zip, ZipPassThrough } from 'fflate'
import { jsonBytes } from './convert'
import type { ConversionReport, OutputFile } from './types'

export async function packageResult(
  files: OutputFile[],
  report: ConversionReport,
  metadata: OutputFile,
): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let failure: Error | undefined
  const zip = new Zip((error, chunk) => {
    if (error) failure = error
    else chunks.push(new Uint8Array(chunk))
  })
  // 模型数据通常已经压缩；以流式存储模式避免额外的压缩堆和长时间 UI 阻塞。
  for (const file of [
    ...files,
    metadata,
    { name: 'conversion-report.json', data: jsonBytes(report) },
  ]) {
    const entry = new ZipPassThrough(file.name)
    zip.add(entry)
    for (let offset = 0; offset < file.data.length; offset += 4 * 1024 ** 2) {
      entry.push(
        file.data.subarray(offset, offset + 4 * 1024 ** 2),
        offset + 4 * 1024 ** 2 >= file.data.length,
      )
      if (failure) throw failure
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  zip.end()
  if (failure) throw failure
  return new Blob(chunks, { type: 'application/zip' })
}

const downloadUrls = new Set<string>()
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a')
  downloadUrls.add(url)
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    downloadUrls.delete(url)
  }, 30000)
}
export function releaseDownloads() {
  downloadUrls.forEach((url) => URL.revokeObjectURL(url))
  downloadUrls.clear()
}
