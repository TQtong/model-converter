import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('IFC 构件属性、空间层级与 DotBIM 对象关联可导出', async ({ page }) => {
  const ifc = await readFile('tests/fixtures/wall.ifc', 'utf8')
  await page.goto('/')
  const results = await page.evaluate(async (ifc) => {
    const { loadModel, convertModel } = await import('/src/core/convert.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const { modelStatistics } = await import('/src/core/scene.ts')
    const bim = JSON.stringify({
      schema_version: '1.1.0',
      meshes: [{ mesh_id: 0, coordinates: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }],
      elements: [
        {
          mesh_id: 0,
          guid: 'wall',
          type: 'Wall',
          vector: { x: 10, y: 20, z: 30 },
          rotation: { qx: 0, qy: 0, qz: 0, qw: 1 },
          color: { r: 255, g: 0, b: 0, a: 255 },
          info: { Name: '测试墙', FireRating: 'A' },
        },
      ],
    })
    const results = []
    for (const [name, data] of [
      ['wall.ifc', ifc],
      ['wall.bim', bim],
    ]) {
      try {
        const source = { path: name, file: new File([data], name) }
        const context = {
          files: [source],
          signal: new AbortController().signal,
          progress: () => {},
          options: { ...defaultOptions },
        }
        const model = await loadModel(source, context),
          result = await convertModel(model, context)
        const metadata = new TextDecoder().decode(result.metadataFile.data)
        if (
          !metadata.includes('FireRating') ||
          (!metadata.includes('TestWall') && !metadata.includes('测试墙'))
        )
          throw new Error('对象关联属性未写入')
        results.push({ name, success: true, ...modelStatistics(model) })
      } catch (error) {
        results.push({ name, success: false, error: (error as Error).message })
      }
    }
    return results
  }, ifc)
  console.log('BIM 样例', results)
  expect(results.filter((item) => !item.success)).toEqual([])
})

test('3DS DAE 3MF AMF WRL 导入有真实几何并可转出 GLB', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { loadModel, convertModel } = await import('/src/core/convert.ts')
    const { defaultOptions } = await import('/src/core/types.ts')
    const { modelStatistics } = await import('/src/core/scene.ts')
    const { zipSync, strToU8 } = await import('/node_modules/fflate/esm/browser.js')
    const vertices = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]
    const amf = `<amf unit="millimeter" version="1.1"><object id="0"><mesh><vertices>${vertices.map((p) => `<vertex><coordinates><x>${p[0]}</x><y>${p[1]}</y><z>${p[2]}</z></coordinates></vertex>`).join('')}</vertices><volume><triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle></volume></mesh></object></amf>`
    const model3mf = `<?xml version="1.0"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${vertices.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`
    const mf = zipSync({
      '_rels/.rels': strToU8(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
      ),
      '3D/3dmodel.model': strToU8(model3mf),
    })
    const dae = `<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><unit meter="1" name="meter"/><up_axis>Y_UP</up_axis></asset><library_geometries><geometry id="triangle"><mesh><source id="p"><float_array id="pa" count="9">0 0 0 1 0 0 0 1 0</float_array><technique_common><accessor source="#pa" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="v"><input semantic="POSITION" source="#p"/></vertices><triangles count="1"><input semantic="VERTEX" source="#v" offset="0"/><p>0 1 2</p></triangles></mesh></geometry></library_geometries><library_visual_scenes><visual_scene id="Scene"><node id="node" name="node"><instance_geometry url="#triangle"/></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#Scene"/></scene></COLLADA>`
    const wrl =
      '#VRML V2.0 utf8\nShape { appearance Appearance { material Material { diffuseColor 0 1 0 } } geometry IndexedFaceSet { coord Coordinate { point [0 0 0, 1 0 0, 0 1 0] } coordIndex [0,1,2,-1] } }'
    function chunk(id: number, ...parts: Uint8Array[]) {
      const data = new Uint8Array(6 + parts.reduce((n, p) => n + p.length, 0)),
        view = new DataView(data.buffer)
      view.setUint16(0, id, true)
      view.setUint32(2, data.length, true)
      let offset = 6
      for (const part of parts) {
        data.set(part, offset)
        offset += part.length
      }
      return data
    }
    const v = new Uint8Array(38),
      vv = new DataView(v.buffer)
    vv.setUint16(0, 3, true)
    vertices.flat().forEach((n, i) => vv.setFloat32(2 + i * 4, n, true))
    const f = new Uint8Array(10),
      fv = new DataView(f.buffer)
    fv.setUint16(0, 1, true)
    fv.setUint16(2, 0, true)
    fv.setUint16(4, 1, true)
    fv.setUint16(6, 2, true)
    const tds = chunk(
      0x4d4d,
      chunk(
        0x3d3d,
        chunk(
          0x4000,
          new TextEncoder().encode('Triangle\0'),
          chunk(0x4100, chunk(0x4110, v), chunk(0x4120, f)),
        ),
      ),
    )
    const results = []
    for (const [name, data] of [
      ['sample.amf', amf],
      ['sample.3mf', mf],
      ['sample.dae', dae],
      ['sample.wrl', wrl],
      ['sample.3ds', tds],
    ] as const) {
      try {
        const source = { path: name, file: new File([data], name) },
          context = {
            files: [source],
            signal: new AbortController().signal,
            progress: () => {},
            options: { ...defaultOptions },
          }
        const model = await loadModel(source, context),
          output = await convertModel(model, context)
        if (!(modelStatistics(model).triangles > 0) || output.files[0].data.length < 20)
          throw new Error('无几何输出')
        results.push({ name, success: true })
      } catch (error) {
        results.push({ name, success: false, error: (error as Error).message })
      }
    }
    return results
  })
  console.log('广覆盖网格', results)
  expect(results.filter((item) => !item.success)).toEqual([])
})
