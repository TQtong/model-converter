import { ModelError, type Progress } from './types'
import {
  decodeLAZChunk,
  decodeLAZChunkTable,
  type LAZChunkMetadata,
} from '../vendor/laz/laz-chunk-decoder'

/** 以原始 LAS 记录为桥梁兼容 LASzip v1/v2；算法置于单线程 Worker。 */
export function decompressLaz(
  buffer: ArrayBuffer,
  progress: (value: Progress) => void,
): ArrayBuffer {
  const view = new DataView(buffer),
    bytes = new Uint8Array(buffer)
  const pointOffset = view.getUint32(96, true),
    recordLength = view.getUint16(105, true),
    pointCount = view.getUint32(107, true),
    format = bytes[104] & 63
  if (
    format > 3 ||
    pointCount * recordLength + pointOffset > 1024 ** 3 ||
    pointOffset > buffer.byteLength
  )
    throw new ModelError('SIZE', 'LAZ 解码长度或记录格式超出支持范围。')
  let offset = view.getUint16(94, true),
    compression: DataView | undefined
  const vlrCount = view.getUint32(100, true)
  for (let i = 0; i < vlrCount; i++) {
    if (offset + 54 > pointOffset) throw new ModelError('CORRUPT', 'LAS VLR 记录越界。')
    const length = view.getUint16(offset + 20, true)
    if (offset + 54 + length > pointOffset) throw new ModelError('CORRUPT', 'LAS VLR 数据被截断。')
    const user = new TextDecoder()
      .decode(bytes.subarray(offset + 2, offset + 18))
      .replace(/\0.*$/, '')
    if (user === 'laszip encoded' && view.getUint16(offset + 18, true) === 22204)
      compression = new DataView(buffer, offset + 54, length)
    offset += 54 + length
  }
  if (!compression || compression.byteLength < 34)
    throw new ModelError('CORRUPT', 'LAZ 缺少 LASzip 压缩定义。')
  const compressor = compression.getUint16(0, true),
    coder = compression.getUint16(2, true),
    chunkSize = compression.getUint32(12, true),
    itemCount = compression.getUint16(32, true)
  if (coder !== 0 || ![1, 2].includes(compressor))
    throw new ModelError('VERSION', `不支持的 LASzip 压缩器：${compressor}，编码器：${coder}。`)
  if (34 + itemCount * 6 > compression.byteLength)
    throw new ModelError('CORRUPT', 'LASzip 属性项定义被截断。')
  const metadata: LAZChunkMetadata = {
    pointDataRecordFormat: format,
    pointDataRecordLength: recordLength,
    pointCount,
  }
  for (let i = 0; i < itemCount; i++) {
    const type = compression.getUint16(34 + i * 6, true),
      version = compression.getUint16(38 + i * 6, true)
    if (version !== 1 && version !== 2)
      throw new ModelError('VERSION', `当前 LASzip 旧版属性项仅支持 v1/v2，文件声明 v${version}。`)
    if (type === 6) metadata.point10ItemVersion = version
    else if (type === 7) metadata.gpsTime11ItemVersion = version
    else if (type === 8) metadata.rgb12ItemVersion = version
    else if (type === 0) metadata.byteItemVersion = version
  }
  const output = new Uint8Array(pointOffset + pointCount * recordLength)
  output.set(bytes.subarray(0, pointOffset))
  output[104] = format
  if (compressor === 1) {
    progress({ stage: '解码 LASzip 连续压缩记录' })
    output.set(decodeLAZChunk(bytes.subarray(pointOffset), metadata), pointOffset)
  } else {
    if (pointOffset + 8 > buffer.byteLength) throw new ModelError('CORRUPT', 'LAZ 分块指针缺失。')
    let tableOffset = Number(view.getBigInt64(pointOffset, true))
    if (tableOffset === -1) tableOffset = Number(view.getBigInt64(buffer.byteLength - 8, true))
    if (
      !Number.isSafeInteger(tableOffset) ||
      tableOffset < pointOffset + 8 ||
      tableOffset + 8 > buffer.byteLength
    )
      throw new ModelError('CORRUPT', 'LAZ 分块表定位无效。')
    const version = view.getUint32(tableOffset, true),
      chunkCount = view.getUint32(tableOffset + 4, true)
    if (version !== 0 || chunkCount > pointCount || chunkCount > 1000000)
      throw new ModelError('CORRUPT', 'LAZ 分块表版本或数量无效。')
    const chunks = decodeLAZChunkTable(bytes.subarray(tableOffset + 8), {
      chunkCount,
      pointCount,
      chunkSize,
      variable: chunkSize === 0xffffffff,
    })
    let compressedOffset = pointOffset + 8,
      decodedPoints = 0
    for (const [index, chunk] of chunks.entries()) {
      progress({ stage: '解码 LASzip 分块压缩记录', fraction: index / chunks.length })
      if (
        compressedOffset + chunk.byteLength > tableOffset ||
        decodedPoints + chunk.pointCount > pointCount
      )
        throw new ModelError('CORRUPT', 'LAZ 压缩块越界。')
      output.set(
        decodeLAZChunk(bytes.subarray(compressedOffset, compressedOffset + chunk.byteLength), {
          ...metadata,
          pointCount: chunk.pointCount,
        }),
        pointOffset + decodedPoints * recordLength,
      )
      compressedOffset += chunk.byteLength
      decodedPoints += chunk.pointCount
    }
    if (decodedPoints !== pointCount) throw new ModelError('CORRUPT', 'LAZ 解码点数与头部不符。')
  }
  return output.buffer
}
