import { Color, Group, Quaternion, Vector3 } from 'three'
import { basename } from '../core/files'
import { meshDocument } from '../core/scene'
import { ModelError, type AdapterContext, type ModelDocument, type SourceFile } from '../core/types'

export async function readDotBim(
  source: SourceFile,
  context: AdapterContext,
): Promise<ModelDocument> {
  const data = JSON.parse(await source.file.text())
  if (!Array.isArray(data.meshes) || !Array.isArray(data.elements))
    throw new ModelError('CORRUPT', 'DotBIM 缺少 meshes 或 elements。')
  const meshes = new Map(data.meshes.map((mesh: any) => [mesh.mesh_id, mesh]))
  const root = new Group()
  for (const element of data.elements) {
    context.signal.throwIfAborted()
    const mesh: any = meshes.get(element.mesh_id)
    if (!mesh) throw new ModelError('CORRUPT', `DotBIM 构件引用了缺失网格：${element.mesh_id}`)
    const document = meshDocument(
      element.guid || String(element.mesh_id),
      'bim',
      mesh.coordinates,
      mesh.indices,
    )
    const object = document.scene!.root.children[0] as any
    object.name = element.info?.Name || element.type || element.guid
    const c = element.color
    if (c) {
      object.material.color = new Color(c.r / 255, c.g / 255, c.b / 255)
      object.material.opacity = c.a / 255
      object.material.transparent = c.a < 255
    }
    if (element.face_colors) {
      object.geometry = object.geometry.toNonIndexed()
      const colors: number[] = []
      for (let i = 0; i < element.face_colors.length; i += 4)
        for (let vertex = 0; vertex < 3; vertex++)
          colors.push(
            element.face_colors[i] / 255,
            element.face_colors[i + 1] / 255,
            element.face_colors[i + 2] / 255,
          )
      const { Float32BufferAttribute } = await import('three')
      object.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      object.material.vertexColors = true
      object.material.color.set(0xffffff)
    }
    const rotation = element.rotation ?? { qx: 0, qy: 0, qz: 0, qw: 1 },
      translation = element.vector ?? { x: 0, y: 0, z: 0 }
    object.quaternion.copy(
      new Quaternion(rotation.qx, rotation.qy, rotation.qz, rotation.qw).normalize(),
    )
    object.position.copy(new Vector3(translation.x, translation.y, translation.z))
    object.userData = {
      guid: element.guid,
      type: element.type,
      info: element.info,
      mesh_id: element.mesh_id,
    }
    root.add(object)
  }
  return {
    kind: 'scene',
    name: basename(source.path),
    scene: { root, animations: [] },
    metadata: {
      source: source.path,
      format: 'bim',
      unit: 'unknown',
      upAxis: 'Z',
      properties: {
        schemaVersion: data.schema_version,
        info: data.info,
        elements: data.elements.map(({ mesh_id, ...element }: any) => ({ mesh_id, ...element })),
      },
      warnings: ['DotBIM 是轻量 BIM，工程属性保存在 metadata.json；不等同于完整 IFC 语义。'],
    },
  }
}
