import { expect, test } from '@playwright/test'

test('瓦片父子矩阵、B3DM RTC、PNTS 精度与最细 LOD 分块输出', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { loadModel, convertModel } = await import('/src/core/convert.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const { modelBounds } = await import('/src/core/scene.ts')
    const T = await import('/node_modules/three/build/three.module.js')
    const context = {
      files: [],
      signal: new AbortController().signal,
      progress: () => {},
      options: { ...defaultOptions, target: 'glb' },
    }
    const source = {
      path: 'triangle.obj',
      file: new File(['v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'], 'triangle.obj'),
    }
    const model = await loadModel(source, { ...context, files: [source] })
    const glb = (await convertModel(model, context)).files[0].data
    function tile(magic: string, feature: object, binary: Uint8Array, content = new Uint8Array()) {
      let json = new TextEncoder().encode(JSON.stringify(feature))
      const aligned = new Uint8Array(Math.ceil((28 + json.length) / 8) * 8 - 28)
      aligned.fill(32)
      aligned.set(json)
      json = aligned
      const data = new Uint8Array(28 + json.length + binary.length + content.length),
        v = new DataView(data.buffer)
      data.set(new TextEncoder().encode(magic))
      v.setUint32(4, 1, true)
      v.setUint32(8, data.length, true)
      v.setUint32(12, json.length, true)
      v.setUint32(16, binary.length, true)
      data.set(json, 28)
      data.set(binary, 28 + json.length)
      data.set(content, 28 + json.length + binary.length)
      return data
    }
    const rtc = [6378137.123456789, 100, 200]
    const binary = new Uint8Array(new Float32Array([0, 0, 0, 1, 1, 1]).buffer)
    const pnts = tile(
      'pnts',
      { POINTS_LENGTH: 2, POSITION: { byteOffset: 0 }, RTC_CENTER: rtc },
      binary,
    )
    const b3dm = tile('b3dm', { BATCH_LENGTH: 0, RTC_CENTER: rtc }, new Uint8Array(), glb)
    const tileset = {
      asset: { version: '1.1' },
      geometricError: 1,
      root: {
        transform: new T.Matrix4().makeTranslation(10, 20, 30).toArray(),
        boundingVolume: { sphere: [0, 0, 0, 1e7] },
        geometricError: 1,
        content: { uri: 'unused.glb' },
        children: [
          {
            transform: new T.Matrix4().makeTranslation(1, 2, 3).toArray(),
            content: { uri: 'models/leaf.b3dm' },
            geometricError: 0,
          },
          { content: { uri: 'models/leaf.pnts' }, geometricError: 0 },
        ],
      },
    }
    const files = [
      { path: 'tileset.json', file: new File([JSON.stringify(tileset)], 'tileset.json') },
      { path: 'models/leaf.b3dm', file: new File([b3dm], 'leaf.b3dm') },
      { path: 'models/leaf.pnts', file: new File([pnts], 'leaf.pnts') },
    ]
    const loaded = await loadModel(files[0], { ...context, files })
    if (loaded.tiles.length !== 2) throw new Error('父子 LOD 被重复导出')
    const pointTile = loaded.tiles.find((t) => t.model.kind === 'pointcloud')
    const pointX = pointTile.model.points.positions[0]
    const meshTile = loaded.tiles.find((t) => t.model.kind === 'scene')
    const box = modelBounds(meshTile.model)
    const output = await convertModel(loaded, {
      ...context,
      files,
      options: { ...defaultOptions, target: 'ply' },
    })
    const exported = []
    for (const file of output.files) {
      const s = { path: file.name, file: new File([file.data], file.name) }
      exported.push(await loadModel(s, { ...context, files: [s] }))
    }
    const exportedMesh = exported.find((t) => t.kind === 'scene')
    return {
      blocks: output.files.length,
      pointX,
      meshX: box.min.x,
      exportX: modelBounds(exportedMesh).min.x,
      matrix: meshTile.model.scene.root.matrix.toArray(),
      metadata: meshTile.model.metadata.properties,
    }
  })
  console.log('瓦片坐标', result)
  expect(result.blocks).toBe(2)
  expect(result.pointX).toBe(6378147.123456789)
  expect(result.meshX).toBe(6378148.123456789)
  expect(result.exportX).toBe(result.meshX)
})

test('阻止远程资源、支持 Worker 取消重建与独立失败重试', async ({ page }) => {
  const remote: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173/'))
      remote.push(request.url())
  })
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { background } = await import('/src/core/background.ts')
    const { loadModel } = await import('/src/core/convert.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const source = {
      path: 'external.gltf',
      file: new File(
        [
          JSON.stringify({
            asset: { version: '2.0' },
            buffers: [{ uri: 'https://example.org/should-never-load.bin', byteLength: 100 }],
            scenes: [{ nodes: [0] }],
            nodes: [{ mesh: 0 }],
            meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
            bufferViews: [{ buffer: 0, byteLength: 36 }],
            accessors: [
              {
                bufferView: 0,
                componentType: 5126,
                count: 3,
                type: 'VEC3',
                max: [1, 1, 1],
                min: [0, 0, 0],
              },
            ],
          }),
        ],
        'external.gltf',
      ),
    }
    let blocked = false
    try {
      await loadModel(source, {
        files: [source],
        signal: new AbortController().signal,
        progress: () => {},
        options: { ...defaultOptions },
      })
    } catch (error) {
      blocked = (error as Error).message.includes('已阻止')
    }
    const controller = new AbortController(),
      promise = background(
        'read-points',
        { format: 'xyz', buffer: new TextEncoder().encode('1 2 3').buffer },
        controller.signal,
        () => {},
      )
    controller.abort()
    let cancelled = false
    try {
      await promise
    } catch (error) {
      cancelled = (error as Error).name === 'AbortError'
    }
    const retry = await background(
      'read-points',
      { format: 'xyz', buffer: new TextEncoder().encode('4 5 6').buffer },
      new AbortController().signal,
      () => {},
    )
    return { blocked, cancelled, retry: retry.positions[0] }
  })
  expect(result).toEqual({ blocked: true, cancelled: true, retry: 4 })
  expect(remote).toEqual([])
})
