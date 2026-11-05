import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('CAD/FreeCAD 实际样例在 Worker 中离散化并输出 GLB', async ({ page }) => {
  const paths = [
    'cube-10x10mm/Cube 10x10.stp',
    'cube-10x10mm/Cube 10x10.igs',
    'cax-if-brep/as1_pe_203.brep',
    'cube-fcstd/cube.FCStd',
  ]
  const inputs = await Promise.all(
    paths.map(async (path) => ({
      name: path.split('/').pop()!,
      bytes: Array.from(await readFile(`node_modules/occt-import-js/test/testfiles/${path}`)),
    })),
  )
  await page.goto('/')
  const results = await page.evaluate(async (inputs) => {
    const { loadModel, convertModel } = await import('/src/core/convert.ts')
    const { modelStatistics, disposeModel } = await import('/src/core/scene.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const results = []
    for (const input of inputs) {
      try {
        const source = {
          path: input.name,
          file: new File([new Uint8Array(input.bytes)], input.name),
        }
        const context = {
          files: [source],
          signal: new AbortController().signal,
          progress: () => {},
          options: { ...defaultOptions },
        }
        const model = await loadModel(source, context),
          stats = modelStatistics(model)
        const converted = await convertModel(model, context)
        if (!stats.triangles || !converted.files[0].data.length) throw new Error('样例没有几何')
        results.push({
          name: input.name,
          success: true,
          triangles: stats.triangles,
          unit: model.metadata.unit,
        })
        disposeModel(model)
      } catch (error) {
        results.push({ name: input.name, success: false, error: (error as Error).message })
      }
    }
    return results
  }, inputs)
  console.log('CAD 样例', results)
  expect(results.filter((result) => !result.success)).toEqual([])
})

test('纹理、UV、层级和蒙皮关键帧经 GLB/glTF 回读保留，采样读取贴图颜色', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js')
    const { convertModel, loadModel } = await import('/src/core/convert.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 2, 2)
    const texture = new T.CanvasTexture(canvas)
    texture.colorSpace = T.SRGBColorSpace
    const geometry = new T.BoxGeometry(1, 1, 1),
      vertices = geometry.getAttribute('position').count
    geometry.setAttribute(
      'skinIndex',
      new T.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4),
    )
    const weights = new Float32Array(vertices * 4)
    for (let i = 0; i < vertices; i++) weights[i * 4] = 1
    geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4))
    const mesh = new T.SkinnedMesh(geometry, new T.MeshStandardMaterial({ map: texture }))
    mesh.name = 'AnimatedMesh'
    const bone = new T.Bone()
    bone.name = 'RootBone'
    mesh.add(bone)
    mesh.bind(new T.Skeleton([bone]))
    const group = new T.Group()
    group.name = '装配'
    group.add(mesh)
    const animation = new T.AnimationClip('旋转', 2, [
      new T.QuaternionKeyframeTrack(
        'RootBone.quaternion',
        [0, 2],
        [0, 0, 0, 1, 0, Math.sin(0.3), 0, Math.cos(0.3)],
      ),
    ])
    const model = {
      kind: 'scene',
      name: '动画.glb',
      scene: { root: group, animations: [animation] },
      metadata: {
        source: 'generated',
        format: 'glb',
        unit: 'm',
        upAxis: 'Y',
        properties: {},
        warnings: [],
      },
    }
    const context = {
      files: [],
      signal: new AbortController().signal,
      progress: () => {},
      options: { ...defaultOptions, samples: 1000 },
    }
    const results = []
    for (const target of ['glb', 'gltf', 'fbx', 'obj', 'point-ply']) {
      try {
        const output = await convertModel(model, {
          ...context,
          options: { ...context.options, target },
        })
        const files = output.files.map((file) => ({
          path: file.name,
          file: new File([file.data], file.name),
        }))
        const main = files.find((file) =>
          file.path.endsWith('.' + (target === 'point-ply' ? 'ply' : target)),
        )!
        const reread = await loadModel(main, { ...context, files })
        let skinned = 0,
          textures = 0,
          uv = 0
        reread.scene?.root.traverse((object) => {
          if (object.isSkinnedMesh) skinned++
          if (object.geometry?.getAttribute('uv')) uv++
          if (object.material?.map) textures++
        })
        const colors = reread.points?.colors
        if (
          ['glb', 'gltf', 'fbx'].includes(target) &&
          (!skinned || reread.scene?.animations.length !== 1)
        )
          throw new Error('蒙皮或动画丢失')
        if (['glb', 'gltf', 'fbx'].includes(target)) {
          const clip = reread.scene!.animations[0]
          if (Math.abs(clip.duration - 2) > 0.001) throw new Error('动画时长发生变化')
          const mixer = new T.AnimationMixer(reread.scene!.root)
          mixer.clipAction(clip).play()
          mixer.setTime(1)
          const restoredBone = reread.scene!.root.getObjectByName('RootBone')
          if (!restoredBone || Math.abs(restoredBone.quaternion.y - Math.sin(0.15)) > 0.001)
            throw new Error('动画中间关键姿态不一致')
          mixer.stopAllAction()
          mixer.uncacheRoot(reread.scene!.root)
        }
        if (['glb', 'gltf', 'obj'].includes(target) && (!textures || !uv))
          throw new Error('贴图或 UV 丢失')
        if (target === 'point-ply' && (!colors || colors[0] < 0.99 || colors[1] > 0.01))
          throw new Error('UV 贴图采样颜色错误')
        results.push({ target, success: true, skinned, textures, uv })
      } catch (error) {
        results.push({ target, success: false, error: (error as Error).message })
      }
    }
    return results
  })
  console.log('动画与贴图', result)
  expect(result.filter((item) => !item.success)).toEqual([])
})

test('点云和高斯转换保留原始坐标、标准高斯属性与附加标量', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { loadModel, convertModel } = await import('/src/core/convert.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const { writePointPly } = await import('/src/core/ply.ts')
    const positions = new Float64Array([
      6378137.123456789, 2, 3, 6378138.234567891, 3, 4, 6378139.345678912, 4, 5, 6378140.456789123,
      5, 6,
    ])
    const points = {
      positions,
      colors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]),
      attributes: { intensity: new Float64Array([10, 20, 30, 40]) },
    }
    const output = []
    for (const gaussian of [false, true]) {
      if (gaussian)
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
          'f_rest_0',
        ])
          points.attributes[key] = new Float64Array([0.1, 0.2, 0.3, 0.4])
      const source = {
        path: 'original.ply',
        file: new File([writePointPly(points, true, gaussian)], 'original.ply'),
      }
      const context = {
        files: [source],
        signal: new AbortController().signal,
        progress: () => {},
        options: { ...defaultOptions },
      }
      const model = await loadModel(source, context)
      for (const target of gaussian
        ? ['ply', 'splat', 'point-ply', 'pcd', 'xyz']
        : ['ply', 'pcd', 'xyz']) {
        try {
          const result = await convertModel(model, {
            ...context,
            options: { ...context.options, target },
          })
          const source = {
            path: result.files[0].name,
            file: new File([result.files[0].data], result.files[0].name),
          }
          const reread = await loadModel(source, { ...context, files: [source] })
          if (target !== 'splat' && reread.points?.positions[0] !== positions[0])
            throw new Error('双精度坐标损失')
          if (target === 'ply' && gaussian && reread.points?.attributes.f_rest_0[2] !== 0.3)
            throw new Error('球谐属性丢失')
          if (['ply', 'pcd'].includes(target) && reread.points?.attributes.intensity[1] !== 20)
            throw new Error('强度丢失')
          output.push({ gaussian, target, success: true })
        } catch (error) {
          output.push({ gaussian, target, success: false, error: (error as Error).message })
        }
      }
    }
    return output
  })
  console.log('点云高斯', results)
  expect(results.filter((item) => !item.success)).toEqual([])
})
