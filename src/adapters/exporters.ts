import { Color, Matrix3, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { Texture } from 'three'
import { background } from '../core/background'
import { safePath, stem } from '../core/files'
import { disposeModel, flattenScene, modelBounds, modelStatistics } from '../core/scene'
import { ModelError, type AdapterContext, type ModelDocument, type OutputFile } from '../core/types'
import { engineUrl } from './cad'
import { readMesh } from './mesh'
import { writeRhino } from './rhino'

const encode = (text: string) => new TextEncoder().encode(text)

async function texturePng(texture: Texture): Promise<Uint8Array> {
  const image = texture.image as CanvasImageSource & { width: number; height: number }
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('贴图编码失败')), 'image/png'))
  canvas.width = 0; canvas.height = 0
  return new Uint8Array(await blob.arrayBuffer())
}

async function writeObj(model: ModelDocument, context: AdapterContext): Promise<OutputFile[]> {
  const name = stem(model.name), lines = [`# Model Converter\nmtllib ${name}.mtl`], materials: string[] = [], files: OutputFile[] = []
  let vertexOffset = 1, uvOffset = 1, normalOffset = 1, meshIndex = 0
  const point = new Vector3(), normal = new Vector3(), normalMatrix = new Matrix3()
  const materialNames = new Map<string, string>(), textureNames = new Map<string, string>()
  const meshes: Mesh[] = []
  model.scene!.root.updateMatrixWorld(true)
  model.scene!.root.traverse(object => { if ((object as Mesh).isMesh) meshes.push(object as Mesh) })
  for (const mesh of meshes) {
    context.signal.throwIfAborted()
    context.progress({ stage: '写入 OBJ 网格与材质', fraction: meshIndex++ / meshes.length })
    const geometry = mesh.geometry, positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv')
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of meshMaterials) {
      if (materialNames.has(m.uuid)) continue
      const matName = `material_${materialNames.size + 1}`
      materialNames.set(m.uuid, matName)
      const material = m as MeshStandardMaterial, color = (material.color ?? new Color(1, 1, 1)).clone().convertLinearToSRGB()
      materials.push(`newmtl ${matName}\nKd ${color.r} ${color.g} ${color.b}\nd ${material.opacity ?? 1}\nNs ${Math.round((1 - (material.roughness ?? 0.5)) * 1000)}\nillum 2`)
      for (const [slot, command] of [['map', 'map_Kd'], ['normalMap', 'norm'], ['alphaMap', 'map_d'], ['emissiveMap', 'map_Ke']] as const) {
        const texture = material[slot]
        if (!texture) continue
        let textureName = textureNames.get(texture.uuid)
        if (!textureName) { textureName = `textures/texture_${textureNames.size + 1}.png`; files.push({ name: textureName, data: await texturePng(texture) }); textureNames.set(texture.uuid, textureName) }
        materials.push(`${command} ${textureName}`)
      }
      materials.push('')
    }
    lines.push(`o ${(mesh.name || `Mesh_${meshIndex}`).replace(/[\r\n]/g, '_')}`)
    normalMatrix.getNormalMatrix(mesh.matrixWorld)
    for (let i = 0; i < positions.count; i++) { point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld); lines.push(`v ${point.x} ${point.y} ${point.z}`) }
    if (uv) for (let i = 0; i < uv.count; i++) lines.push(`vt ${uv.getX(i)} ${uv.getY(i)}`)
    if (normals) for (let i = 0; i < normals.count; i++) { normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize(); lines.push(`vn ${normal.x} ${normal.y} ${normal.z}`) }
    const index = geometry.index, count = index?.count ?? positions.count
    let lastMaterial = ''
    const mirrored = mesh.matrixWorld.determinant() < 0
    for (let i = 0; i < count; i += 3) {
      const group = geometry.groups.find(group => i >= group.start && i < group.start + group.count)
      const matName = materialNames.get(meshMaterials[group?.materialIndex ?? 0]?.uuid) ?? materialNames.get(meshMaterials[0].uuid)!
      if (matName !== lastMaterial) { lines.push(`usemtl ${matName}`); lastMaterial = matName }
      const corners = mirrored ? [0, 2, 1] : [0, 1, 2]
      lines.push('f ' + corners.map(j => {
        const vertex = index ? index.getX(i + j) : i + j
        return `${vertex + vertexOffset}${uv || normals ? '/' : ''}${uv ? vertex + uvOffset : ''}${normals ? '/' + (vertex + normalOffset) : ''}`
      }).join(' '))
    }
    vertexOffset += positions.count; if (uv) uvOffset += uv.count; if (normals) normalOffset += normals.count
  }
  return [{ name: `${name}.obj`, data: encode(lines.join('\n') + '\n') }, { name: `${name}.mtl`, data: encode(materials.join('\n')) }, ...files]
}

export async function writeScene(model: ModelDocument, context: AdapterContext): Promise<OutputFile[]> {
  const { target, binary } = context.options, name = stem(model.name)
  if (target === '3dm') return writeRhino(model, context)
  if (target === 'obj') return writeObj(model, context)
  if (['glb', 'gltf', 'fbx', 'tiles'].includes(target)) {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
    const output = await new GLTFExporter().parseAsync(model.scene!.root, { binary: target !== 'gltf', animations: model.scene!.animations, onlyVisible: false, trs: model.scene!.animations.length > 0 })
    const data = output instanceof ArrayBuffer ? new Uint8Array(output) : encode(JSON.stringify(output))
    if (target === 'fbx') {
      const files = await background<OutputFile[]>('assimp', { files: [{ name: 'scene.glb', data }], target: 'fbx', wasmUrl: engineUrl('assimp/assimpjs.wasm') }, context.signal, context.progress)
      const fbx = files.find(file => file.name.endsWith('.fbx'))
      if (!fbx) throw new ModelError('FBX', 'Assimp 没有输出 FBX 文件。')
      fbx.name = `${name}.fbx`
      context.progress({ stage: '以 FBXLoader 回读验证导出结果' })
      const source = { path: fbx.name, file: new File([new Uint8Array(fbx.data)], fbx.name) }
      const check = await readMesh(source, { ...context, files: [source, ...context.files] })
      const before = modelStatistics(model), after = modelStatistics(check)
      const a = modelBounds(model), b = modelBounds(check)
      const tolerance = Math.max(a.getSize(new Vector3()).length() * 0.001, 1e-5)
      disposeModel(check)
      if (!after.triangles || Math.abs(after.triangles - before.triangles) > 0 || after.animations < before.animations || a.min.distanceTo(b.min) > tolerance || a.max.distanceTo(b.max) > tolerance) throw new ModelError('FBX_VALIDATION', 'FBX 回读的几何范围、三角面数或动画数量与输入不一致，此结果未开放下载。')
      return files
    }
    if (target === 'tiles') {
      const bounds = modelBounds(model), center = bounds.getCenter(new Vector3()), half = bounds.getSize(new Vector3()).multiplyScalar(0.5)
      // 此包中的 GLB 使用 Y-up；tileset 包围体必须采用 Z-up 坐标。
      const box = [center.x, -center.z, center.y, half.x, 0, 0, 0, half.z, 0, 0, 0, half.y]
      const json = { asset: { version: '1.1', generator: 'Model Converter' }, geometricError: 0, root: { boundingVolume: { box }, geometricError: 0, refine: 'REPLACE', content: { uri: `${name}.glb` } } }
      return [{ name: 'tileset.json', data: encode(JSON.stringify(json, null, 2)) }, { name: `${name}.glb`, data }]
    }
    return [{ name: `${name}.${target}`, data, mime: target === 'glb' ? 'model/gltf-binary' : 'model/gltf+json' }]
  }
  if (target === 'stl') {
    const { STLExporter } = await import('three/addons/exporters/STLExporter.js')
    const output = new STLExporter().parse(model.scene!.root, { binary })
    return [{ name: `${name}.stl`, data: typeof output === 'string' ? encode(output) : new Uint8Array(output.buffer, output.byteOffset, output.byteLength) }]
  }
  if (target === 'ply') {
    const { PLYExporter } = await import('three/addons/exporters/PLYExporter.js')
    const output = await new Promise<string | ArrayBuffer>((resolve, reject) => {
      try { const result = new PLYExporter().parse(model.scene!.root, resolve, { binary, littleEndian: true }); if (result === null) reject(new ModelError('EMPTY', 'PLY 没有可导出的网格。')) } catch (error) { reject(error) }
    })
    return [{ name: `${name}.ply`, data: typeof output === 'string' ? encode(output) : new Uint8Array(output) }]
  }
  if (target === 'off') {
    const { points, indices } = flattenScene(model.scene!.root), lines = [`OFF\n${points.positions.length / 3} ${indices.length / 3} 0`]
    for (let i = 0; i < points.positions.length; i += 3) lines.push(`${points.positions[i]} ${points.positions[i + 1]} ${points.positions[i + 2]}`)
    for (let i = 0; i < indices.length; i += 3) lines.push(`3 ${indices[i]} ${indices[i + 1]} ${indices[i + 2]}`)
    return [{ name: `${name}.off`, data: encode(lines.join('\n') + '\n') }]
  }
  throw new ModelError('ROUTE', `没有实现 ${target} 场景导出器。`)
}

export function validateOutputNames(files: OutputFile[]) {
  const names = new Set<string>()
  for (const file of files) {
    file.name = safePath(file.name)
    if (names.has(file.name)) throw new ModelError('OUTPUT', `结果文件名冲突：${file.name}`)
    if (!file.data.byteLength) throw new ModelError('OUTPUT', `输出文件为空：${file.name}`)
    names.add(file.name)
  }
}
