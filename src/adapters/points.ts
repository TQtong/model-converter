import { background } from '../core/background'
import { basename, extension } from '../core/files'
import type { AdapterContext, ModelDocument, PointData, SourceFile } from '../core/types'
import { stem } from '../core/files'

export async function writePoints(model: ModelDocument, context: AdapterContext) {
  const format = context.options.target
  const data = await background<Uint8Array>(
    'write-points',
    {
      points: model.points,
      format,
      binary: context.options.binary,
      gaussian: model.kind === 'gaussian',
    },
    context.signal,
    context.progress,
  )
  return [{ name: `${stem(model.name)}.${format}`, data }]
}

export async function readPoints(
  source: SourceFile,
  context: AdapterContext,
): Promise<ModelDocument> {
  const format = extension(source.path)
  const buffer = await source.file.arrayBuffer()
  const warnings: string[] = []
  let points: PointData
  if (format === 'spz') {
    context.progress({ stage: '解码 SPZ 高斯数据' })
    points = await background<PointData>(
      'read-spz',
      { buffer, name: source.path },
      context.signal,
      context.progress,
    )
    warnings.push(
      'SPZ 经 Spark 扩展精度解码，保留已解码的高斯属性与最高三阶球谐；源量化与解码编码产生的精度损失无法恢复。',
    )
  } else
    points = await background<PointData>(
      'read-points',
      { format, buffer },
      context.signal,
      context.progress,
    )
  if (format === 'las' || format === 'laz')
    warnings.push(
      'LAS/LAZ 当前提取坐标、颜色、强度和分类；GPS 时间、回波、波形及未解析 VLR 不在原生输出中保留。',
    )
  return {
    kind: ['splat', 'spz'].includes(format) ? 'gaussian' : 'pointcloud',
    name: basename(source.path),
    points,
    metadata: {
      source: source.path,
      format,
      unit: 'unknown',
      upAxis: ['las', 'laz'].includes(format) ? 'Z' : 'Y',
      properties: {},
      warnings,
    },
  }
}
