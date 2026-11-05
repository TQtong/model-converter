import { Group, Matrix4, Quaternion, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { findAdapter, routesFor } from '../adapters/registry'
import { validateOutputNames, writeScene } from '../adapters/exporters'
import { background } from './background'
import { stem } from './files'
import { meshDocument, modelStatistics } from './scene'
import { samplingSurface } from './sampling'
import {
  ModelError,
  type AdapterContext,
  type ConversionReport,
  type ModelDocument,
  type OutputFile,
  type PointData,
  type SourceFile,
  type Unit,
} from './types'

const unitMeters: Record<Exclude<Unit, 'original'>, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  in: 0.0254,
  ft: 0.3048,
}
export const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(
    JSON.stringify(
      value,
      (_key, entry) =>
        ArrayBuffer.isView(entry) ? Array.from(entry as unknown as ArrayLike<number>) : entry,
      2,
    ),
  )

export async function loadModel(
  source: SourceFile,
  context: AdapterContext,
): Promise<ModelDocument> {
  const adapter = findAdapter(source.path)
  if (!adapter?.read)
    throw new ModelError('FORMAT', '此输入格式尚未接入。OSGB 等专项格式不能仅改后缀转换。')
  context.progress({ stage: `读取 ${adapter.label}` })
  const model = await adapter.read(source, context)
  context.signal.throwIfAborted()
  const statistics = modelStatistics(model)
  if (!(statistics.vertices || statistics.points || statistics.tiles))
    throw new ModelError('EMPTY', '模型中没有可转换的几何或点数据。')
  return model
}

/** 所有变换发生在导出副本上，重复导出或预览不会累计缩放与旋转。 */
export async function transformed(
  model: ModelDocument,
  context: AdapterContext,
): Promise<ModelDocument> {
  const result: ModelDocument = {
    ...model,
    metadata: {
      ...model.metadata,
      warnings: [...model.metadata.warnings],
      properties: { ...model.metadata.properties },
    },
  }
  const options = context.options
  const fixedGltfUnits = ['glb', 'gltf', 'fbx', 'tiles'].includes(options.target)
  if (fixedGltfUnits && options.unit !== 'original' && options.unit !== 'm')
    throw new ModelError(
      'UNIT',
      'glTF 场景通道以米为单位。请将目标单位设置为“保留/自动”或“米”。原单位会记录在 metadata.json。',
    )
  const sourceUnit =
    model.metadata.unit in unitMeters
      ? (model.metadata.unit as keyof typeof unitMeters)
      : options.sourceUnit
  const targetUnit = fixedGltfUnits ? 'm' : options.unit
  const scale = targetUnit === 'original' ? 1 : unitMeters[sourceUnit] / unitMeters[targetUnit]
  const axis = options.upAxis === 'original' ? model.metadata.upAxis : options.upAxis
  const angle = axis !== model.metadata.upAxis ? (axis === 'Y' ? -Math.PI / 2 : Math.PI / 2) : 0
  const matrix = new Matrix4().makeRotationX(angle).scale(new Vector3(scale, scale, scale))
  if (model.scene) {
    const wrapper = new Group()
    wrapper.name = 'ConversionRoot'
    wrapper.applyMatrix4(matrix)
    wrapper.add(clone(model.scene.root))
    result.scene = {
      root: wrapper,
      animations: model.scene.animations.map((animation) => animation.clone()),
    }
  }
  if (model.points) {
    const points = model.points
    result.points = {
      positions: new Float64Array(points.positions),
      colors: points.colors,
      normals: points.normals ? new Float32Array(points.normals) : undefined,
      attributes: Object.fromEntries(
        Object.entries(points.attributes).map(([key, values]) => [key, new Float64Array(values)]),
      ),
    }
    const p = new Vector3(),
      q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle),
      rotation = new Quaternion()
    for (let i = 0; i < points.positions.length / 3; i++) {
      if (i && i % 100000 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        context.signal.throwIfAborted()
      }
      result.points.positions.set(
        p
          .fromArray(points.positions, i * 3)
          .applyMatrix4(matrix)
          .toArray(),
        i * 3,
      )
      if (result.points.normals)
        result.points.normals.set(
          p
            .fromArray(points.normals!, i * 3)
            .applyQuaternion(q)
            .toArray(),
          i * 3,
        )
      const attrs = result.points.attributes
      if (model.kind === 'gaussian') {
        for (let j = 0; j < 3; j++) attrs[`scale_${j}`][i] += Math.log(scale)
        rotation
          .set(attrs.rot_1[i], attrs.rot_2[i], attrs.rot_3[i], attrs.rot_0[i])
          .premultiply(q)
          .normalize()
        for (const [j, value] of [rotation.w, rotation.x, rotation.y, rotation.z].entries())
          attrs[`rot_${j}`][i] = value
      }
      for (const [j, name] of ['x', 'y', 'z'].entries())
        if (attrs[name]) attrs[name][i] = result.points.positions[i * 3 + j]
    }
    if (model.kind === 'gaussian' && angle) {
      const attributes = Object.fromEntries(
        Object.entries(result.points.attributes).filter(([key]) => key.startsWith('f_rest_')),
      )
      if (Object.keys(attributes).length) {
        const rotated = await background<PointData['attributes']>(
          'rotate-harmonics',
          { attributes, angle, count: points.positions.length / 3 },
          context.signal,
          context.progress,
          Object.values(attributes).map((array) => array.buffer as ArrayBuffer),
        )
        Object.assign(result.points.attributes, rotated)
      }
    }
  }
  if (scale !== 1 || angle) {
    result.metadata.properties.coordinateChange = {
      scale,
      rotationX: angle,
      sourceUnit: model.metadata.unit,
      sourceAxis: model.metadata.upAxis,
      targetUnit: targetUnit === 'original' ? model.metadata.unit : targetUnit,
      targetAxis: axis,
    }
    result.metadata.warnings.push(
      `已应用坐标变更：缩放 ${scale}，绕 X 旋转 ${(angle * 180) / Math.PI}°。`,
    )
  }
  if (fixedGltfUnits && model.metadata.unit === 'unknown')
    result.metadata.warnings.push(
      `源文件未声明单位，按用户设置的 ${sourceUnit} 换算到米。请核对源单位。`,
    )
  if (targetUnit !== 'original') result.metadata.unit = targetUnit
  result.metadata.upAxis = axis
  return result
}

async function convertOne(
  source: ModelDocument,
  context: AdapterContext,
): Promise<{ files: OutputFile[]; model: ModelDocument }> {
  const target = routesFor(source).find((route) => route.id === context.options.target)
  if (!target) throw new ModelError('ROUTE', '当前输入没有此转换路线。')
  let model = await transformed(source, context)
  if (source.kind === 'scene' && target.kind !== 'scene') {
    const surface = samplingSurface(model.scene!.root)
    const { points, indices } = surface
    const sampled = await background<PointData>(
      'sample',
      {
        points,
        indices,
        surface,
        count: context.options.samples,
        gaussian: target.kind === 'gaussian',
      },
      context.signal,
      context.progress,
    )
    model = { ...model, scene: undefined, kind: target.kind, points: sampled }
    model.metadata.warnings.push(
      target.description,
      `表面采样点数：${context.options.samples}。根据原始 UV 读取基础颜色贴图并结合材质/顶点色；不烘焙光照和法线贴图。`,
    )
  } else if (source.kind !== 'scene' && target.kind === 'scene') {
    const reconstruction = await background<{
      positions: Float64Array
      usedPoints: number
      gridCell: number
    }>(
      'reconstruct',
      {
        points: model.points,
        gaussian: model.kind === 'gaussian',
        resolution: context.options.resolution,
        isoLevel: context.options.isoLevel,
      },
      context.signal,
      context.progress,
    )
    const mesh = meshDocument(source.name, source.metadata.format, reconstruction.positions)
    model = { ...mesh, metadata: model.metadata }
    model.metadata.properties.reconstruction = {
      algorithm:
        source.kind === 'gaussian'
          ? 'anisotropic-gaussian-density/marching-tetrahedra'
          : 'local-PCA/signed-distance/marching-tetrahedra',
      usedPoints: reconstruction.usedPoints,
      gridCell: reconstruction.gridCell,
      resolution: context.options.resolution,
    }
    model.metadata.warnings.push(
      target.description,
      `重建使用 ${reconstruction.usedPoints} 个点，体素边长 ${reconstruction.gridCell}；重建不保留动画、UV、贴图和原始对象层级。`,
    )
  }
  if (source.kind === 'gaussian' && target.kind === 'pointcloud')
    model.metadata.warnings.push(target.description)
  if (model.kind === 'gaussian' && !model.points!.colors) {
    model.points!.colors = new Float32Array(model.points!.positions.length)
    for (let i = 0; i < model.points!.positions.length / 3; i++)
      for (let axis = 0; axis < 3; axis++)
        model.points!.colors![i * 3 + axis] = Math.max(
          0,
          Math.min(1, 0.5 + model.points!.attributes[`f_dc_${axis}`][i] * 0.28209479177387814),
        )
  }
  context.progress({ stage: '写入目标格式' })
  let files: OutputFile[]
  if (target.kind === 'scene') {
    files = await writeScene(
      model,
      target.id === 'mesh-ply'
        ? { ...context, options: { ...context.options, target: 'ply' } }
        : context,
    )
    if (!['glb', 'gltf', 'fbx', 'tiles'].includes(target.id))
      model.metadata.warnings.push(
        target.description,
        '静态格式不保留骨骼动画；输出当前基础姿态。目标不能表示的对象层级和工程属性写入 metadata.json。',
      )
    if (target.id === '3dm')
      model.metadata.warnings.push('3DM 当前输出网格对象、名称与基础色；UV、纹理及动画未原生写入。')
    if (target.id === 'fbx' || target.id === 'tiles')
      model.metadata.warnings.push(target.description)
  } else {
    const format = ['ply', 'point-ply', 'gaussian-ply'].includes(target.id) ? 'ply' : target.id
    const data = await background<Uint8Array>(
      'write-points',
      {
        points: model.points,
        format,
        binary: context.options.binary,
        gaussian: target.kind === 'gaussian',
      },
      context.signal,
      context.progress,
    )
    files = [{ name: `${stem(model.name)}.${format}`, data }]
    if (format === 'xyz')
      model.metadata.warnings.push('XYZ 仅写入坐标和 RGB，不保留法线及其他标量属性。')
    if (format === 'splat') model.metadata.warnings.push(target.description)
  }
  validateOutputNames(files)
  return { files, model }
}

export async function convertModel(source: ModelDocument, context: AdapterContext) {
  const started = performance.now(),
    warnings = [...source.metadata.warnings],
    files: OutputFile[] = []
  const metadata: Record<string, unknown> = { source: source.metadata, objects: [] }
  const resultStatistics: Record<string, number> = {}
  const accumulate = (model: ModelDocument) => {
    for (const [key, value] of Object.entries(modelStatistics(model)))
      resultStatistics[key] = (resultStatistics[key] ?? 0) + value
  }
  if (source.tiles) {
    const blocks: unknown[] = []
    for (const [index, tile] of source.tiles.entries()) {
      context.progress({ stage: `转换分块 ${index + 1}/${source.tiles.length}` })
      const result = await convertOne(tile.model, context)
      accumulate(result.model)
      const folder = `tiles/${String(index + 1).padStart(4, '0')}_${stem(tile.name)}`
      for (const file of result.files) files.push({ ...file, name: `${folder}/${file.name}` })
      warnings.push(...result.model.metadata.warnings)
      blocks.push({ name: tile.name, folder, metadata: result.model.metadata })
    }
    metadata.blocks = blocks
  } else {
    const result = await convertOne(source, context)
    accumulate(result.model)
    files.push(...result.files)
    warnings.push(...result.model.metadata.warnings)
    metadata.result = result.model.metadata
    source.scene?.root.traverse((object) => {
      if (Object.keys(object.userData).length)
        (metadata.objects as unknown[]).push({
          uuid: object.uuid,
          name: object.name,
          parent: object.parent?.uuid,
          properties: object.userData,
        })
    })
  }
  context.signal.throwIfAborted()
  const report: ConversionReport = {
    version: 1,
    source: source.name,
    sourceFormat: source.metadata.format,
    sourceKind: source.kind,
    target: context.options.target,
    createdAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    options: { ...context.options },
    warnings: [...new Set(warnings)],
    statistics: modelStatistics(source),
    resultStatistics,
    files: files.map((file) => file.name),
  }
  validateOutputNames(files)
  return {
    files,
    report,
    metadataFile: { name: 'metadata.json', data: jsonBytes(metadata) } as OutputFile,
  }
}
