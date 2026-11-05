import { expect, test } from '@playwright/test'

test('中文工作台：示例导入、GLB 转换、完整包下载和移动布局', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '开始转换' })).toBeDisabled()
  await page.getByRole('button', { name: '体验示例' }).click()
  await expect(page.getByText('待转换', { exact: false })).toBeVisible()
  await expect(page.locator('.stats')).toContainText('12')
  await page.getByRole('button', { name: '开始转换' }).click()
  await expect(page.getByText('转换完成', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整包（含报告与属性）', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('demo_glb.zip')
  await file.saveAs(testInfo.outputPath('demo_glb.zip'))
  await page.screenshot({ path: testInfo.outputPath('workbench.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true })
})

test('场景公开导出路线产生可回读文件，点云采样使用 Worker', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { loadModel, convertModel } = await import('/src/core/convert.ts')
    const { modelStatistics, modelBounds, disposeModel } = await import('/src/core/scene.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const { routesFor } = await import('/src/adapters/registry.ts')
    const file = new File(['o 三角形\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'], '中文 模型.obj')
    const source = { path: file.name, file },
      controller = new AbortController()
    const context = {
      files: [source],
      signal: controller.signal,
      progress: () => {},
      options: { ...defaultOptions, samples: 1000 },
    }
    const model = await loadModel(source, context),
      output: Record<string, unknown> = {}
    for (const route of routesFor(model)) {
      try {
        const result = await convertModel(model, {
          ...context,
          options: { ...context.options, target: route.id },
        })
        const files = result.files.map((file) => ({
          path: file.name,
          file: new File([file.data], file.name),
        }))
        const main = files.find((file) =>
          file.path.endsWith(
            route.id === 'point-ply' || route.id === 'gaussian-ply'
              ? '.ply'
              : route.id === 'tiles'
                ? '.json'
                : '.' + route.id,
          ),
        )!
        const reread = await loadModel(main, { ...context, files })
        const stats = modelStatistics(reread),
          bounds = modelBounds(reread)
        if (!(stats.triangles || stats.points || stats.tiles)) throw new Error('结果没有几何数据')
        output[route.id] = {
          success: true,
          statistics: stats,
          bounds: [bounds.min.toArray(), bounds.max.toArray()],
        }
        disposeModel(reread)
      } catch (error) {
        output[route.id] = { success: false, error: (error as Error).message }
      }
    }
    disposeModel(model)
    return output
  })
  console.log(JSON.stringify(results, null, 2))
  expect(Object.entries(results).filter(([, value]) => !(value as any).success)).toEqual([])
})
