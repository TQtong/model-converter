import { expect, test } from '@playwright/test'

test('生产仓库子路径可加载 Worker CAD WASM 并完成转换下载', async ({ page }) => {
  test.skip(!process.env.TEST_BASE_URL?.includes('/model-converter/'), '仅针对生产子路径运行')
  const failed: string[] = [],
    external: string[] = []
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`)
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(process.env.TEST_BASE_URL!))
      external.push(request.url())
  })
  await page.goto('./')
  await page.getByRole('button', { name: '体验示例' }).click()
  await expect(page.locator('.stats')).toContainText('12')
  await page.getByLabel('目标格式', { exact: true }).selectOption('point-ply')
  await page.getByRole('button', { name: '开始转换' }).click()
  await expect(page.getByText('转换完成', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载模型', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('demo.ply')
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles('node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.stp')
  await expect(page.locator('.stats')).toContainText('12')
  await expect(page.getByRole('button', { name: '开始转换' })).toBeEnabled()
  await page.getByRole('button', { name: '开始转换' }).click()
  await expect(page.getByText('转换完成', { exact: true })).toBeVisible()
  expect(failed).toEqual([])
  expect(external).toEqual([])
})
