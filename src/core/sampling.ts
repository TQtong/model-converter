import { Color, Mesh, MeshStandardMaterial } from 'three'
import type { Object3D, Texture } from 'three'
import { flattenScene } from './scene'
import type { PointData } from './types'

export interface SurfaceTexture {
  width: number
  height: number
  pixels: Uint8ClampedArray
  matrix: number[]
  wrapS: number
  wrapT: number
  flipY: boolean
  srgb: boolean
}
export interface SurfaceSamples {
  points: PointData
  indices: Uint32Array
  uvs: Float32Array
  materialIndices: Int32Array
  materials: { color: number[]; texture: number }[]
  textures: SurfaceTexture[]
}

/** 按对象/材质组提取原始 UV 与纹理像素，预览降采样不参与颜色采样。 */
export function samplingSurface(root: Object3D): SurfaceSamples {
  const { points, indices } = flattenScene(root)
  const uvs = new Float32Array((points.positions.length / 3) * 2),
    materialIndices = new Int32Array(indices.length / 3)
  const materials: SurfaceSamples['materials'] = [],
    textures: SurfaceTexture[] = [],
    textureIds = new Map<string, number>()
  let vertexOffset = 0,
    faceOffset = 0
  function textureIndex(texture?: Texture | null) {
    if (!texture) return -1
    if (textureIds.has(texture.uuid)) return textureIds.get(texture.uuid)!
    const image = texture.image as CanvasImageSource & { width: number; height: number }
    if (!image?.width || !image.height) return -1
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(image, 0, 0)
    texture.updateMatrix()
    const id = textures.length
    textures.push({
      width: image.width,
      height: image.height,
      pixels: context.getImageData(0, 0, image.width, image.height).data,
      matrix: texture.matrix.toArray(),
      wrapS: texture.wrapS,
      wrapT: texture.wrapT,
      flipY: texture.flipY,
      srgb: texture.colorSpace === 'srgb',
    })
    canvas.width = 0
    canvas.height = 0
    textureIds.set(texture.uuid, id)
    return id
  }
  root.traverse((object) => {
    if (!(object as Mesh).isMesh) return
    const mesh = object as Mesh,
      geometry = mesh.geometry,
      position = geometry.getAttribute('position'),
      uv = geometry.getAttribute('uv'),
      vertexColor = geometry.getAttribute('color')
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const ids = meshMaterials.map((m) => {
      const material = m as MeshStandardMaterial
      materials.push({
        color: (material.color ?? new Color(1, 1, 1)).toArray(),
        texture: uv ? textureIndex(material.map) : -1,
      })
      return materials.length - 1
    })
    for (let i = 0; i < position.count; i++) {
      if (uv) uvs.set([uv.getX(i), uv.getY(i)], (vertexOffset + i) * 2)
      points.colors!.set(
        vertexColor ? [vertexColor.getX(i), vertexColor.getY(i), vertexColor.getZ(i)] : [1, 1, 1],
        (vertexOffset + i) * 3,
      )
    }
    const count = geometry.index?.count ?? position.count
    for (let i = 0; i < count; i += 3) {
      const group = geometry.groups.find(
        (group) => i >= group.start && i < group.start + group.count,
      )
      materialIndices[faceOffset++] = ids[group?.materialIndex ?? 0] ?? ids[0]
    }
    vertexOffset += position.count
  })
  return { points, indices, uvs, materialIndices, materials, textures }
}
