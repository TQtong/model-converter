import { Group, LoadingManager, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three'
import { basename, extension, resolveResource, stem } from '../core/files'
import { meshDocument } from '../core/scene'
import { parsePly } from '../core/ply'
import { ModelError, type AdapterContext, type ModelDocument, type SourceFile } from '../core/types'

/** 所有加载器只能解析已导入的 File；绝不回退到模型内的网络 URL。 */
export function localManager(
  source: SourceFile,
  context: AdapterContext,
  trustedUrls: string[] = [],
) {
  const urls: string[] = []
  const manager = new LoadingManager()
  let pending = false
  let complete: (() => void) | undefined
  let failed: string | undefined
  manager.onStart = () => {
    pending = true
  }
  manager.onLoad = () => {
    pending = false
    complete?.()
  }
  manager.onError = (uri) => {
    failed = uri
  }
  manager.setURLModifier((uri) => {
    context.signal.throwIfAborted()
    if (trustedUrls.includes(uri)) return uri
    if (uri.startsWith('blob:') || uri.startsWith('data:')) return uri
    const entry = resolveResource(context.files, source.path, uri)
    const url = URL.createObjectURL(entry.file)
    urls.push(url)
    return url
  })
  return {
    manager,
    ready: async () => {
      if (pending)
        await new Promise<void>((resolve) => {
          complete = resolve
        })
      if (failed) throw new ModelError('TEXTURE', `本地资源加载失败：${failed}`)
    },
    release: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  }
}

export async function readMesh(
  source: SourceFile,
  context: AdapterContext,
): Promise<ModelDocument> {
  const format = extension(source.path)
  const buffer = await source.file.arrayBuffer()
  context.signal.throwIfAborted()
  context.progress({ stage: '解析模型与配套资源' })
  const { manager, ready, release } = localManager(source, context)
  const root = new Group()
  let animations: NonNullable<ModelDocument['scene']>['animations'] = []
  const warnings: string[] = []
  try {
    switch (format) {
      case 'glb':
      case 'gltf': {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
        const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js')
        const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js')
        const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}engines/draco/`)
        try {
          const gltf = await new GLTFLoader(manager)
            .setDRACOLoader(draco)
            .setMeshoptDecoder(MeshoptDecoder)
            .parseAsync(buffer, '')
          root.add(gltf.scene)
          animations = gltf.animations
        } finally {
          draco.dispose()
        }
        break
      }
      case 'obj': {
        const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js')
        const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js')
        const text = new TextDecoder().decode(buffer)
        const loader = new OBJLoader(manager)
        const libraries = [...text.matchAll(/^\s*mtllib\s+(.+)$/gm)]
        if (libraries.length > 1)
          warnings.push('OBJ 引用了多个材质库；当前材质读取以第一个库为准。')
        if (libraries[0]) {
          try {
            const materialFile = resolveResource(context.files, source.path, libraries[0][1].trim())
            const {
              manager: mtlManager,
              ready: readyMtl,
              release: releaseMtl,
            } = localManager(materialFile, context)
            try {
              const materials = new MTLLoader(mtlManager).parse(await materialFile.file.text(), '')
              materials.preload()
              loader.setMaterials(materials)
              await readyMtl()
            } finally {
              releaseMtl()
            }
          } catch (error) {
            warnings.push((error as Error).message)
          }
        }
        root.add(loader.parse(text))
        break
      }
      case 'fbx': {
        const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
        const object = new FBXLoader(manager).parse(buffer, '')
        root.add(object)
        animations = object.animations
        break
      }
      case 'stl': {
        const { STLLoader } = await import('three/addons/loaders/STLLoader.js')
        const geometry = new STLLoader().parse(buffer)
        root.add(new Mesh(geometry, new MeshStandardMaterial({ color: 0x9cb9c9, roughness: 0.65 })))
        break
      }
      case 'ply': {
        const ply = parsePly(buffer)
        if (ply.gaussian || !ply.indices.length)
          return {
            kind: ply.gaussian ? 'gaussian' : 'pointcloud',
            name: basename(source.path),
            points: ply.points,
            metadata: {
              source: source.path,
              format,
              unit: 'unknown',
              upAxis: 'Y',
              properties: { comments: ply.comments },
              warnings: [],
            },
          }
        const model = meshDocument(
          basename(source.path),
          format,
          ply.points.positions,
          ply.indices,
          ply.points.colors,
        )
        model.metadata.properties = {
          plyVertexAttributes: ply.points.attributes,
          comments: ply.comments,
        }
        return model
      }
      case '3ds': {
        const { TDSLoader } = await import('three/addons/loaders/TDSLoader.js')
        root.add(new TDSLoader(manager).parse(buffer, ''))
        break
      }
      case 'dae': {
        const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js')
        const result = new ColladaLoader(manager).parse(new TextDecoder().decode(buffer), '')
        if (!result) throw new ModelError('CORRUPT', 'DAE 文档解析失败。')
        root.add(result.scene)
        animations = result.scene.animations
        break
      }
      case '3mf': {
        const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js')
        root.add(new ThreeMFLoader(manager).parse(buffer))
        break
      }
      case 'amf': {
        const { AMFLoader } = await import('three/addons/loaders/AMFLoader.js')
        root.add(new AMFLoader(manager).parse(buffer))
        break
      }
      case 'wrl': {
        const { VRMLLoader } = await import('three/addons/loaders/VRMLLoader.js')
        root.add(new VRMLLoader(manager).parse(new TextDecoder().decode(buffer), ''))
        break
      }
      case 'off': {
        const lines = new TextDecoder()
          .decode(buffer)
          .replace(/#[^\r\n]*/g, '')
          .trim()
          .split(/\s+/)
        if (lines.shift() !== 'OFF')
          throw new ModelError('VERSION', '当前 OFF 读取器支持标准 OFF，不支持 COFF/NOFF。')
        const vertices = Number(lines.shift()),
          faces = Number(lines.shift())
        lines.shift()
        if (
          !Number.isSafeInteger(vertices) ||
          vertices < 3 ||
          vertices > 20000000 ||
          !Number.isSafeInteger(faces) ||
          faces < 0
        )
          throw new ModelError('CORRUPT', 'OFF 顶点或面数无效。')
        const positions = new Float64Array(vertices * 3),
          indices: number[] = []
        for (let i = 0; i < positions.length; i++) {
          positions[i] = Number(lines.shift())
          if (!Number.isFinite(positions[i])) throw new ModelError('CORRUPT', 'OFF 顶点损坏。')
        }
        for (let i = 0; i < faces; i++) {
          const count = Number(lines.shift())
          if (!Number.isInteger(count) || count < 3 || count > vertices)
            throw new ModelError('CORRUPT', 'OFF 面长度无效。')
          const face = Array.from({ length: count }, () => Number(lines.shift()))
          if (face.some((index) => !Number.isInteger(index) || index < 0 || index >= vertices))
            throw new ModelError('CORRUPT', 'OFF 索引越界。')
          for (let j = 1; j < count - 1; j++) indices.push(face[0], face[j], face[j + 1])
        }
        return meshDocument(basename(source.path), format, positions, indices)
      }
      default:
        throw new ModelError('FORMAT', `尚未注册 ${format} 读取器。`)
    }
    await ready()
    context.signal.throwIfAborted()
    root.name = stem(source.path)
    root.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.material)
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const standard = material as MeshStandardMaterial
          if (standard.map) standard.map.colorSpace = SRGBColorSpace
        }
    })
    return {
      kind: 'scene',
      name: basename(source.path),
      scene: { root, animations },
      metadata: {
        source: source.path,
        format,
        unit: ['glb', 'gltf'].includes(format) ? 'm' : 'unknown',
        upAxis: 'Y',
        properties: {},
        warnings,
      },
    }
  } finally {
    release()
  }
}
