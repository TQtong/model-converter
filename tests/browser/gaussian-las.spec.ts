import { expect, test } from '@playwright/test'

test('SPZ v2/v3 解码保存三阶球谐并回写标准高斯 PLY', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { ExtSplats, writeSpz } =
      await import('/node_modules/@sparkjsdev/spark/dist/spark.module.js')
    const { writePointPly } = await import('/src/core/ply.ts')
    const { loadModel, convertModel } = await import('/src/core/convert.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const points = { positions: new Float64Array([1, 2, 3, 2, 3, 4]), attributes: {} }
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
      points.attributes[key] = new Float64Array([key === 'rot_0' ? 1 : 0, key === 'rot_0' ? 1 : 0])
    for (let i = 0; i < 45; i++) points.attributes[`f_rest_${i}`] = new Float64Array([0.25, -0.25])
    const splats = new ExtSplats({
      fileBytes: writePointPly(points, true, true),
      fileName: 'source.ply',
    })
    await splats.initialized
    const results = []
    for (const version of [2, 3]) {
      try {
        const bytes = (await writeSpz(splats, { version, maxSh: 3 })).fileBytes
        const source = {
          path: `sample-v${version}.spz`,
          file: new File([bytes], `sample-v${version}.spz`),
        }
        const context = {
          files: [source],
          signal: new AbortController().signal,
          progress: () => {},
          options: { ...defaultOptions, target: 'ply' },
        }
        const model = await loadModel(source, context)
        for (let i = 0; i < 45; i++)
          if (Math.abs(model.points.attributes[`f_rest_${i}`]?.[0] - 0.25) > 0.03)
            throw new Error(`球谐系数 ${i} 丢失或解码不符`)
        if (Math.abs(model.points.positions[1] - 2) > 0.001) throw new Error('SPZ 坐标方向错误')
        const output = await convertModel(model, context)
        if (!output.files[0].data.length) throw new Error('没有输出')
        results.push({
          version,
          success: true,
          attributes: Object.keys(model.points.attributes).length,
        })
      } catch (error) {
        results.push({ version, success: false, error: (error as Error).message })
      }
    }
    splats.dispose()
    return results
  })
  console.log('SPZ', results)
  expect(results.filter((item) => !item.success)).toEqual([])
})

test('LAS 1.2 双精度读取强度分类颜色；拒绝 LAS 1.4', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { loadModel } = await import('/src/core/convert.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const buffer = new ArrayBuffer(227 + 34),
      view = new DataView(buffer),
      bytes = new Uint8Array(buffer)
    bytes.set(new TextEncoder().encode('LASF'))
    bytes[24] = 1
    bytes[25] = 2
    view.setUint16(94, 227, true)
    view.setUint32(96, 227, true)
    bytes[104] = 3
    view.setUint16(105, 34, true)
    view.setUint32(107, 1, true)
    for (let axis = 0; axis < 3; axis++) {
      view.setFloat64(131 + axis * 8, 0.001, true)
      view.setFloat64(155 + axis * 8, axis === 0 ? 6378137 : 0, true)
      view.setInt32(227 + axis * 4, 123, true)
    }
    view.setUint16(227 + 12, 42, true)
    bytes[227 + 15] = 2
    view.setUint16(227 + 28, 65535, true)
    const source = { path: 'sample.las', file: new File([buffer], 'sample.las') }
    const context = {
      files: [source],
      signal: new AbortController().signal,
      progress: () => {},
      options: { ...defaultOptions },
    }
    const model = await loadModel(source, context)
    bytes[25] = 4
    let rejected = false
    try {
      await loadModel({ path: 'v1.4.las', file: new File([buffer], 'v1.4.las') }, context)
    } catch (error) {
      rejected = (error as Error).message.includes('1.4')
    }
    return {
      position: model.points.positions[0],
      intensity: model.points.attributes.intensity[0],
      classification: model.points.attributes.classification[0],
      color: model.points.colors[0],
      rejected,
    }
  })
  expect(result).toEqual({
    position: 6378137.123,
    intensity: 42,
    classification: 2,
    color: 1,
    rejected: true,
  })
})
