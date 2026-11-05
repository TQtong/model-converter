import { expect, test } from '@playwright/test'

test('无名称节点的 UUID 动画绑定在独立场景副本中保留', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js')
    const { convertModel, loadModel } = await import('/src/core/convert.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const root = new T.Group(),
      mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial())
    root.add(mesh)
    const clip = new T.AnimationClip('Unnamed', 1, [
      new T.VectorKeyframeTrack(`${mesh.uuid}.position`, [0, 1], [0, 0, 0, 2, 0, 0]),
    ])
    const model = {
      kind: 'scene',
      name: 'unnamed.glb',
      metadata: {
        source: 'generated',
        format: 'glb',
        unit: 'm',
        upAxis: 'Y',
        properties: {},
        warnings: [],
      },
      scene: { root, animations: [clip] },
    }
    const context = {
      files: [],
      signal: new AbortController().signal,
      progress: () => {},
      options: { ...defaultOptions },
    }
    const result = await convertModel(model, context)
    const file = result.files[0],
      source = { path: file.name, file: new File([file.data], file.name) }
    const restored = await loadModel(source, { ...context, files: [source] })
    return {
      clips: restored.scene.animations.length,
      tracks: restored.scene.animations[0]?.tracks.length,
    }
  })
  expect(result).toEqual({ clips: 1, tracks: 1 })
})
