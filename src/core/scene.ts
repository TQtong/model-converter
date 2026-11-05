import {
  Box3,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix3,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three'
import type { Material, Object3D, Texture } from 'three'
import type { ModelDocument, PointData } from './types'

// 原始双精度数据不放入 userData，避免被 glTF 扩展或 metadata 意外重复序列化。
const originalPositions = new WeakMap<BufferGeometry, Float64Array>()
export function readPosition(geometry: BufferGeometry, index: number, target: Vector3): Vector3 {
  const original = originalPositions.get(geometry)
  return original
    ? target.fromArray(original, index * 3)
    : target.fromBufferAttribute(geometry.getAttribute('position'), index)
}

export function meshDocument(
  name: string,
  format: string,
  positions: ArrayLike<number>,
  indices?: ArrayLike<number>,
  colors?: ArrayLike<number>,
): ModelDocument {
  const geometry = new BufferGeometry()
  const original = new Float64Array(positions)
  const origin =
    Math.max(Math.abs(original[0]), Math.abs(original[1]), Math.abs(original[2])) > 100000
      ? new Vector3().fromArray(original)
      : new Vector3()
  if (origin.lengthSq())
    for (let i = 0; i < original.length; i += 3) {
      original[i] -= origin.x
      original[i + 1] -= origin.y
      original[i + 2] -= origin.z
    }
  originalPositions.set(geometry, original)
  geometry.setAttribute('position', new Float32BufferAttribute(original, 3))
  if (indices?.length) geometry.setIndex(Array.from(indices))
  if (colors) geometry.setAttribute('color', new Float32BufferAttribute(Array.from(colors), 3))
  geometry.computeVertexNormals()
  const root = new Group()
  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({
      color: colors ? 0xffffff : 0x97baca,
      vertexColors: !!colors,
      roughness: 0.65,
    }),
  )
  mesh.name = name
  mesh.position.copy(origin)
  root.add(mesh)
  return {
    kind: 'scene',
    name,
    metadata: { source: name, format, unit: 'unknown', upAxis: 'Y', properties: {}, warnings: [] },
    scene: { root, animations: [] },
  }
}

/** 导出静态格式时才应用世界变换并展开三角形；动画原场景保持独立。 */
export function flattenScene(root: Object3D): { points: PointData; indices: Uint32Array } {
  root.updateMatrixWorld(true)
  const positions: number[] = [],
    colors: number[] = [],
    normals: number[] = [],
    indices: number[] = []
  const point = new Vector3(),
    normal = new Vector3(),
    normalMatrix = new Matrix3()
  const uvU: number[] = [],
    uvV: number[] = []
  let hasUv = false
  root.traverse((object) => {
    if (!(object as Mesh).isMesh) return
    const mesh = object as Mesh
    const geometry = mesh.geometry
    const attribute = geometry.getAttribute('position')
    if (!attribute) return
    const uv = geometry.getAttribute('uv')
    const color = geometry.getAttribute('color'),
      n = geometry.getAttribute('normal')
    const material = (
      Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    ) as MeshStandardMaterial
    const baseColor = material.color ?? new Color(1, 1, 1)
    const start = positions.length / 3
    normalMatrix.getNormalMatrix(mesh.matrixWorld)
    for (let i = 0; i < attribute.count; i++) {
      readPosition(geometry, i, point).applyMatrix4(mesh.matrixWorld)
      positions.push(point.x, point.y, point.z)
      uvU.push(uv ? uv.getX(i) : 0)
      uvV.push(uv ? uv.getY(i) : 0)
      if (uv) hasUv = true
      if (n) normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize()
      else normal.set(0, 1, 0)
      normals.push(normal.x, normal.y, normal.z)
      colors.push(
        color ? color.getX(i) : baseColor.r,
        color ? color.getY(i) : baseColor.g,
        color ? color.getZ(i) : baseColor.b,
      )
    }
    const index = geometry.index
    for (let i = 0; i < (index?.count ?? attribute.count); i += 3) {
      const corners = mesh.matrixWorld.determinant() < 0 ? [0, 2, 1] : [0, 1, 2]
      for (const corner of corners)
        indices.push(start + (index ? index.getX(i + corner) : i + corner))
    }
  })
  return {
    points: {
      positions: new Float64Array(positions),
      colors: new Float32Array(colors),
      normals: new Float32Array(normals),
      attributes: hasUv ? { s: new Float64Array(uvU), t: new Float64Array(uvV) } : {},
    },
    indices: new Uint32Array(indices),
  }
}

export function modelStatistics(model: ModelDocument): Record<string, number> {
  if (model.tiles)
    return {
      tiles: model.tiles.length,
      ...model.tiles.reduce(
        (sum, tile) => {
          for (const [key, value] of Object.entries(modelStatistics(tile.model)))
            sum[key] = (sum[key] ?? 0) + value
          return sum
        },
        {} as Record<string, number>,
      ),
    }
  if (model.points)
    return {
      points: model.points.positions.length / 3,
      attributes: Object.keys(model.points.attributes).length,
    }
  let vertices = 0,
    triangles = 0,
    objects = 0,
    materials = 0,
    bones = 0,
    skinnedMeshes = 0
  model.scene?.root.traverse((object) => {
    objects++
    if ((object as any).isBone) bones++
    if ((object as any).isSkinnedMesh) skinnedMeshes++
    if ((object as Mesh).isMesh) {
      const mesh = object as Mesh
      vertices += mesh.geometry.getAttribute('position')?.count ?? 0
      triangles +=
        (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3
      materials += Array.isArray(mesh.material) ? mesh.material.length : 1
    }
  })
  return {
    vertices,
    triangles,
    objects,
    materials,
    animations: model.scene?.animations.length ?? 0,
    bones,
    skinnedMeshes,
  }
}

export function modelBounds(model: ModelDocument): Box3 {
  const box = new Box3()
  if (model.scene) {
    model.scene.root.updateMatrixWorld(true)
    return box.setFromObject(model.scene.root)
  }
  if (model.tiles) {
    for (const tile of model.tiles) box.union(modelBounds(tile.model))
    return box
  }
  const p = model.points?.positions
  if (p)
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(new Vector3(p[i], p[i + 1], p[i + 2]))
  return box
}

/** 统一释放几何、共享材质与纹理，避免连续导入时积累显存。 */
export function disposeModel(model?: ModelDocument) {
  if (!model) return
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>(),
    textures = new Set<Texture>()
  model.scene?.root.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.geometry) geometries.add(mesh.geometry)
    if (mesh.material)
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) =>
        materials.add(material),
      )
  })
  materials.forEach((material) => {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value)
  })
  textures.forEach((texture) => {
    texture.dispose()
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap)
      texture.image.close()
  })
  materials.forEach((material) => material.dispose())
  geometries.forEach((geometry) => geometry.dispose())
  model.tiles?.forEach((tile) => disposeModel(tile.model))
}
