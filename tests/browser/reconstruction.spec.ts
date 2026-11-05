import { expect, test } from '@playwright/test'

test('点云和高斯的每条网格重建路线均可回读，PLY 内容类型不混淆', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { loadModel, convertModel } = await import('/src/core/convert.ts')
    const { routesFor } = await import('/src/adapters/registry.ts')
    const { writePointPly } = await import('/src/core/ply.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const { modelStatistics } = await import('/src/core/scene.ts')
    const positions: number[] = []
    for (let i = 0; i < 200; i++) {
      const y = 1 - (2 * (i + 0.5)) / 200,
        radius = Math.sqrt(1 - y * y),
        angle = i * 2.399963229728653
      positions.push(radius * Math.cos(angle), y, radius * Math.sin(angle))
    }
    const gaussian = {
      positions: new Float64Array([0, 0, 0]),
      attributes: Object.fromEntries(
        [
          'scale_0',
          'scale_1',
          'scale_2',
          'rot_0',
          'rot_1',
          'rot_2',
          'rot_3',
          'opacity',
          'f_dc_0',
          'f_dc_1',
          'f_dc_2',
        ].map((key) => [key, new Float64Array([key === 'rot_0' ? 1 : 0])]),
      ),
    }
    const points = { positions: new Float64Array(positions), attributes: {} }
    const results = []
    for (const [index, data] of [points, gaussian].entries()) {
      const source = {
        path: `test${index}.ply`,
        file: new File([writePointPly(data, true, index === 1)], `test${index}.ply`),
      }
      const context = {
        files: [source],
        signal: new AbortController().signal,
        progress: () => {},
        options: { ...defaultOptions, resolution: 16 },
      }
      const model = await loadModel(source, context),
        routes = routesFor(model)
      if (new Set(routes.map((route) => route.id)).size !== routes.length)
        throw new Error('存在同名不可选择路线')
      for (const route of routes.filter((route) => route.kind === 'scene')) {
        try {
          const output = await convertModel(model, {
            ...context,
            options: { ...context.options, target: route.id },
          })
          const files = output.files.map((file) => ({
            path: file.name,
            file: new File([file.data], file.name),
          }))
          const target = route.id === 'mesh-ply' ? 'ply' : route.id
          const main = files.find((file) => file.path.endsWith('.' + target))!
          const restored = await loadModel(main, { ...context, files })
          if (
            !(modelStatistics(restored).triangles > 0) ||
            !output.report.resultStatistics.triangles
          )
            throw new Error('缺少真实重建网格或结果统计')
          results.push({ kind: model.kind, target, success: true })
        } catch (error) {
          results.push({
            kind: model.kind,
            target: route.id,
            success: false,
            error: (error as Error).message,
          })
        }
      }
    }
    return results
  })
  console.log('实验重建', results)
  expect(results.filter((result) => !result.success)).toEqual([])
})
