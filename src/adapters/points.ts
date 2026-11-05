import { background } from '../core/background'
import { basename, extension } from '../core/files'
import type { AdapterContext, ModelDocument, PointData, SourceFile } from '../core/types'

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
    const { PackedSplats } = await import('@sparkjsdev/spark')
    const packed = new PackedSplats({ fileBytes: buffer, fileName: source.path })
    try {
      await packed.initialized
      context.signal.throwIfAborted()
      const n = packed.numSplats
      points = {
        positions: new Float64Array(n * 3),
        colors: new Float32Array(n * 3),
        attributes: {},
      }
      for (const key of [
        'scale_0',
        'scale_1',
        'scale_2',
        'rot_0',
        'rot_1',
        'rot_2',
        'rot_3',
        'f_dc_0',
        'f_dc_1',
        'f_dc_2',
        'opacity',
      ])
        points.attributes[key] = new Float64Array(n)
      packed.forEachSplat((i, center, scale, rotation, opacity, color) => {
        points.positions.set(center.toArray(), i * 3)
        points.colors!.set(color.toArray(), i * 3)
        for (let j = 0; j < 3; j++) {
          points.attributes[`scale_${j}`][i] = Math.log(Math.max(1e-20, scale.getComponent(j)))
          points.attributes[`f_dc_${j}`][i] = (color.toArray()[j] - 0.5) / 0.28209479177387814
        }
        for (const [j, value] of [rotation.w, rotation.x, rotation.y, rotation.z].entries())
          points.attributes[`rot_${j}`][i] = value
        const alpha = Math.max(1e-6, Math.min(1 - 1e-6, opacity))
        points.attributes.opacity[i] = Math.log(alpha / (1 - alpha))
      })
      warnings.push(
        'SPZ 经 Spark 解码，包含量化误差；当前适配器提取中心、尺度、旋转、透明度和基础颜色，未提取高阶球谐系数。',
      )
    } finally {
      packed.dispose()
    }
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
