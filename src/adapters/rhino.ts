import { Mesh, MeshStandardMaterial } from 'three'
import { engineUrl } from './cad'
import { localManager } from './mesh'
import { basename, stem } from '../core/files'
import { flattenScene } from '../core/scene'
import type { AdapterContext, ModelDocument, OutputFile, SourceFile } from '../core/types'

export async function readRhino(
  source: SourceFile,
  context: AdapterContext,
): Promise<ModelDocument> {
  const { Rhino3dmLoader } = await import('three/addons/loaders/3DMLoader.js')
  const { manager, ready, release } = localManager(source, context, [
    engineUrl('rhino/rhino3dm.js'),
    engineUrl('rhino/rhino3dm.wasm'),
  ])
  const loader = new Rhino3dmLoader(manager).setLibraryPath(engineUrl('rhino/')).setWorkerLimit(1)
  const cancel = () => loader.dispose()
  context.signal.addEventListener('abort', cancel, { once: true })
  try {
    const buffer = await source.file.arrayBuffer()
    const root = await new Promise<any>((resolve, reject) => {
      context.signal.addEventListener(
        'abort',
        () => reject(new DOMException('任务已取消', 'AbortError')),
        { once: true },
      )
      loader.parse(buffer, resolve, reject)
    })
    await ready()
    context.signal.throwIfAborted()
    return {
      kind: 'scene',
      name: basename(source.path),
      scene: { root, animations: [] },
      metadata: {
        source: source.path,
        format: '3dm',
        unit:
          (
            {
              Millimeters: 'mm',
              Centimeters: 'cm',
              Meters: 'm',
              Inches: 'in',
              Feet: 'ft',
              '2': 'mm',
              '3': 'cm',
              '4': 'm',
              '8': 'in',
              '9': 'ft',
            } as Record<string, string>
          )[
            String(
              root.userData.settings?.modelUnitSystem?.name ??
                root.userData.settings?.modelUnitSystem?.value ??
                root.userData.settings?.modelUnitSystem,
            )
          ] ?? 'unknown',
        upAxis: 'Z',
        properties: { rhino: root.userData },
        warnings: [
          '3DM 读取渲染网格、支持的曲线和对象属性；曲面输出为离散网格，未缓存渲染网格的 NURBS 对象可能无法显示。',
        ],
      },
    }
  } finally {
    loader.dispose()
    release()
    context.signal.removeEventListener('abort', cancel)
  }
}

/** Rhino 输出使用独立网格对象，保留名称与可序列化的对象属性。 */
let rhinoLibrary: Promise<any> | undefined
function loadRhinoLibrary(): Promise<any> {
  rhinoLibrary ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = engineUrl('rhino/rhino3dm.js')
    script.onload = () => resolve((globalThis as any).rhino3dm)
    script.onerror = () => {
      rhinoLibrary = undefined
      script.remove()
      reject(new Error('Rhino 引擎加载失败'))
    }
    document.head.append(script)
  })
  return rhinoLibrary
}
export async function writeRhino(
  model: ModelDocument,
  context: AdapterContext,
): Promise<OutputFile[]> {
  const initialize = await loadRhinoLibrary()
  const rhino = await initialize({ locateFile: (file: string) => engineUrl(`rhino/${file}`) })
  const document = new rhino.File3dm()
  const unitName = (
    { mm: 'Millimeters', cm: 'Centimeters', m: 'Meters', in: 'Inches', ft: 'Feet' } as Record<
      string,
      string
    >
  )[model.metadata.unit]
  document.settings().modelUnitSystem = unitName
    ? rhino.UnitSystem[unitName]
    : rhino.UnitSystem.None
  model.scene!.root.updateMatrixWorld(true)
  try {
    model.scene!.root.traverse((object) => {
      if (!(object as Mesh).isMesh) return
      context.signal.throwIfAborted()
      const mesh = object as Mesh,
        parent = mesh.parent
      // flattenScene 使用当前对象世界矩阵，不修改原始父子关系。
      const { points, indices } = flattenScene(mesh)
      const output = new rhino.Mesh(),
        vertices = output.vertices(),
        faces = output.faces()
      vertices.useDoublePrecisionVertices = true
      for (let i = 0; i < points.positions.length; i += 3)
        vertices.add(points.positions[i], points.positions[i + 1], points.positions[i + 2])
      for (let i = 0; i < indices.length; i += 3)
        faces.addTriFace(indices[i], indices[i + 1], indices[i + 2])
      const attributes = new rhino.ObjectAttributes()
      attributes.name = mesh.name || 'Mesh'
      attributes.setUserString('sourceHierarchy', parent?.name ?? '')
      attributes.setUserString('metadata', JSON.stringify(mesh.userData))
      const material = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as MeshStandardMaterial
      if (material.color) {
        attributes.objectColor = {
          r: Math.round(material.color.r * 255),
          g: Math.round(material.color.g * 255),
          b: Math.round(material.color.b * 255),
          a: Math.round(material.opacity * 255),
        }
        attributes.colorSource = rhino.ObjectColorSource.ColorFromObject
      }
      document.objects().add(output, attributes)
      ;(output as any).delete()
      ;(attributes as any).delete()
    })
    return [{ name: `${stem(model.name)}.3dm`, data: new Uint8Array(document.toByteArray()) }]
  } finally {
    ;(document as any).delete()
  }
}
