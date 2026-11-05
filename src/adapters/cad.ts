import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import { background } from '../core/background'
import { basename, extension } from '../core/files'
import type { AdapterContext, ModelDocument, SourceFile } from '../core/types'

export function engineUrl(relative: string): string {
  return new URL(`${import.meta.env.BASE_URL}engines/${relative}`, self.location.href).href
}

export async function readCad(source: SourceFile, context: AdapterContext): Promise<ModelDocument> {
  const format = extension(source.path)
  const result = await background<any>(
    'cad',
    {
      format,
      buffer: await source.file.arrayBuffer(),
      tolerance: context.options.cadTolerance,
      wasmUrl: engineUrl('occt/occt-import-js.wasm'),
    },
    context.signal,
    context.progress,
  )
  function node(data: any): Group {
    const group = new Group()
    group.name = data.name || '装配节点'
    for (const index of data.meshes ?? []) {
      const item = result.meshes[index],
        geometry = new BufferGeometry()
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(item.attributes.position.array, 3),
      )
      if (item.attributes.normal)
        geometry.setAttribute('normal', new Float32BufferAttribute(item.attributes.normal.array, 3))
      geometry.setIndex(item.index.array)
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
      const material = new MeshStandardMaterial({
        color: item.color ? new Color(...item.color) : 0xb3c2ce,
        roughness: 0.65,
      })
      const faceMaterials = [material]
      if (item.brep_faces?.some((face: any) => face.color))
        for (const face of item.brep_faces) {
          let materialIndex = 0
          if (face.color) {
            faceMaterials.push(
              new MeshStandardMaterial({ color: new Color(...face.color), roughness: 0.65 }),
            )
            materialIndex = faceMaterials.length - 1
          }
          geometry.addGroup(face.first * 3, (face.last - face.first + 1) * 3, materialIndex)
        }
      const mesh = new Mesh(geometry, faceMaterials.length > 1 ? faceMaterials : material)
      mesh.name = item.name || `曲面 ${index}`
      // 原 BREP 面与三角形区间的对应关系保存在对象元信息中。
      mesh.userData = { sourceMeshIndex: index, brepFaces: item.brep_faces }
      group.add(mesh)
    }
    for (const child of data.children ?? []) group.add(node(child))
    return group
  }
  return {
    kind: 'scene',
    name: basename(source.path),
    scene: { root: node(result.root), animations: [] },
    metadata: {
      source: source.path,
      format,
      unit: ['brep', 'brp'].includes(format) ? 'unknown' : 'mm',
      upAxis: 'Z',
      properties: { sourceHierarchy: result.root, tolerance: context.options.cadTolerance },
      warnings: [
        `CAD 精确曲面已离散化为三角网格，线性偏差参数 ${context.options.cadTolerance} mm；不保留参数化历史，不提供原生 CAD 回写。`,
        ...(format === 'brep' ? ['BREP 通常不声明单位，请在转换前确认源单位。'] : []),
      ],
    },
  }
}

export async function readIfc(source: SourceFile, context: AdapterContext): Promise<ModelDocument> {
  const result = await background<any>(
    'ifc',
    { buffer: await source.file.arrayBuffer(), wasmPath: engineUrl('ifc/') },
    context.signal,
    context.progress,
  )
  const root = new Group(),
    groups = new Map<number, Group>()
  for (const item of result.meshes) {
    let group = groups.get(item.expressID)
    if (!group) {
      group = new Group()
      group.name = result.properties[item.expressID]?.item?.Name?.value || `IFC #${item.expressID}`
      group.userData = { expressID: item.expressID, ...result.properties[item.expressID] }
      groups.set(item.expressID, group)
    }
    const geometry = new BufferGeometry(),
      positions: number[] = [],
      normals: number[] = []
    for (let i = 0; i < item.vertices.length; i += 6) {
      positions.push(...item.vertices.slice(i, i + 3))
      normals.push(...item.vertices.slice(i + 3, i + 6))
    }
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    geometry.setIndex(Array.from(item.indices))
    const { x, y, z, w } = item.color
    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({
        color: new Color(x, y, z),
        opacity: w,
        transparent: w < 1,
        roughness: 0.7,
      }),
    )
    mesh.applyMatrix4(new Matrix4().fromArray(item.matrix))
    group.add(mesh)
  }
  function spatial(node: any): Group {
    const group = groups.get(node.expressID) ?? new Group()
    groups.delete(node.expressID)
    group.name ||= `${node.type} #${node.expressID}`
    group.userData.expressID = node.expressID
    for (const child of node.children ?? []) group.add(spatial(child))
    return group
  }
  root.add(spatial(result.spatial))
  for (const group of groups.values()) root.add(group)
  return {
    kind: 'scene',
    name: basename(source.path),
    scene: { root, animations: [] },
    metadata: {
      source: source.path,
      format: 'ifc',
      unit: 'm',
      upAxis: 'Y',
      properties: { schema: result.schema, objects: result.properties, spatial: result.spatial },
      warnings: [
        'IFC 几何已离散化，提取了构件基本属性、属性集、类型属性和空间结构；其他关系与原生参数化语义未完整提取。工程属性将在 metadata.json 中关联保存。',
      ],
    },
  }
}
