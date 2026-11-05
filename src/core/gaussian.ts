import type { PointData, Progress } from './types'

/** Spark 扩展精度解码后提取全部已解码属性，导出不依赖 GPU 预览缓冲。 */
export async function decodeSpz(
  buffer: ArrayBuffer,
  name: string,
  progress: (value: Progress) => void,
): Promise<PointData> {
  const { ExtSplats, utils } = await import('@sparkjsdev/spark')
  const splats = new ExtSplats({ fileBytes: buffer, fileName: name })
  try {
    await splats.initialized
    const count = splats.numSplats,
      degree = splats.getNumSh(),
      dimensions = (degree + 1) ** 2 - 1
    const points: PointData = {
      positions: new Float64Array(count * 3),
      colors: new Float32Array(count * 3),
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
      points.attributes[key] = new Float64Array(count)
    for (let i = 0; i < dimensions * 3; i++)
      points.attributes[`f_rest_${i}`] = new Float64Array(count)
    splats.forEachSplat((i, center, scale, rotation, opacity, color) => {
      if (i % 20000 === 0) progress({ stage: '提取 SPZ 解码属性与球谐系数', fraction: i / count })
      points.positions.set(center.toArray(), i * 3)
      points.colors!.set(color.toArray(), i * 3)
      for (let axis = 0; axis < 3; axis++) {
        points.attributes[`scale_${axis}`][i] = Math.log(Math.max(1e-30, scale.getComponent(axis)))
        points.attributes[`f_dc_${axis}`][i] = (color.toArray()[axis] - 0.5) / 0.28209479177387814
      }
      for (const [axis, value] of [rotation.w, rotation.x, rotation.y, rotation.z].entries())
        points.attributes[`rot_${axis}`][i] = value
      const alpha = Math.max(1e-8, Math.min(1 - 1e-8, opacity))
      points.attributes.opacity[i] = Math.log(alpha / (1 - alpha))
      // Spark 以每个系数的 RGB 共享指数存储；标准高斯 PLY 以颜色通道分组。
      for (let coefficient = 0; coefficient < dimensions; coefficient++) {
        let word: number
        if (coefficient < 3) word = splats.extra.sh1![i * 4 + coefficient]
        else if (coefficient === 3) word = splats.extra.sh1![i * 4 + 3]
        else if (coefficient < 8) word = splats.extra.sh2![i * 4 + coefficient - 4]
        else if (coefficient < 12) word = splats.extra.sh3a![i * 4 + coefficient - 8]
        else word = splats.extra.sh3b![i * 4 + coefficient - 12]
        const rgb = utils.decodeExtRgb(word)
        for (const [axis, value] of [rgb.r, rgb.g, rgb.b].entries())
          points.attributes[`f_rest_${axis * dimensions + coefficient}`][i] = value
      }
    })
    return points
  } finally {
    splats.dispose()
  }
}
