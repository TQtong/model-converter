import { Group, Matrix4, Vector3 } from 'three'
import { basename, extension, resolveResource } from '../core/files'
import {
  ModelError,
  type AdapterContext,
  type ModelDocument,
  type PointData,
  type SourceFile,
} from '../core/types'
import { readMesh } from './mesh'

export function parseTileContainer(buffer: ArrayBuffer, expected: 'b3dm' | 'pnts') {
  const view = new DataView(buffer),
    decoder = new TextDecoder()
  if (
    buffer.byteLength < 28 ||
    decoder.decode(new Uint8Array(buffer, 0, 4)) !== expected ||
    view.getUint32(4, true) !== 1 ||
    view.getUint32(8, true) !== buffer.byteLength
  )
    throw new ModelError('CORRUPT', `${expected.toUpperCase()} 头部或版本无效。`)
  const lengths = [12, 16, 20, 24].map((offset) => view.getUint32(offset, true))
  if (28 + lengths.reduce((sum, n) => sum + n, 0) > buffer.byteLength)
    throw new ModelError('CORRUPT', '瓦片内部区段越界。')
  const json = (offset: number, length: number) =>
    length
      ? JSON.parse(
          decoder
            .decode(new Uint8Array(buffer, offset, length))
            .replace(/\0+$/, '')
            .trim(),
        )
      : {}
  const feature = json(28, lengths[0]),
    binary = buffer.slice(28 + lengths[0], 28 + lengths[0] + lengths[1])
  const batch = json(28 + lengths[0] + lengths[1], lengths[2])
  return {
    feature,
    binary,
    batch,
    batchBinary: buffer.slice(
      28 + lengths[0] + lengths[1] + lengths[2],
      28 + lengths.reduce((s, n) => s + n, 0),
    ),
    content: buffer.slice(28 + lengths.reduce((sum, n) => sum + n, 0)),
  }
}

export function parsePnts(buffer: ArrayBuffer): {
  points: PointData
  rtc: number[]
  properties: unknown
} {
  const { feature: f, binary, batch, batchBinary } = parseTileContainer(buffer, 'pnts')
  const count = f.POINTS_LENGTH
  if (!Number.isSafeInteger(count) || count < 0 || count > 30000000)
    throw new ModelError('CORRUPT', 'PNTS 点数异常。')
  const view = new DataView(binary),
    positions = new Float64Array(count * 3)
  const colors =
    f.RGB || f.RGBA || f.RGB565 || f.CONSTANT_RGBA ? new Float32Array(count * 3) : undefined
  const normals = f.NORMAL ? new Float32Array(count * 3) : undefined
  if (!f.POSITION && !f.POSITION_QUANTIZED)
    throw new ModelError('VERSION', 'PNTS 没有支持的位置属性。')
  if (f.POSITION_QUANTIZED && (!f.QUANTIZED_VOLUME_SCALE || !f.QUANTIZED_VOLUME_OFFSET))
    throw new ModelError('CORRUPT', 'PNTS 量化坐标缺少体积定义。')
  for (let i = 0; i < count; i++)
    for (let axis = 0; axis < 3; axis++) {
      positions[i * 3 + axis] = f.POSITION
        ? view.getFloat32(f.POSITION.byteOffset + (i * 3 + axis) * 4, true)
        : (view.getUint16(f.POSITION_QUANTIZED.byteOffset + (i * 3 + axis) * 2, true) / 65535) *
            f.QUANTIZED_VOLUME_SCALE[axis] +
          f.QUANTIZED_VOLUME_OFFSET[axis]
      if (colors) {
        if (f.RGB || f.RGBA)
          colors[i * 3 + axis] =
            view.getUint8((f.RGB ?? f.RGBA).byteOffset + i * (f.RGB ? 3 : 4) + axis) / 255
        else if (f.RGB565) {
          const value = view.getUint16(f.RGB565.byteOffset + i * 2, true)
          colors[i * 3 + axis] =
            axis === 0
              ? (value >> 11) / 31
              : axis === 1
                ? ((value >> 5) & 63) / 63
                : (value & 31) / 31
        } else colors[i * 3 + axis] = f.CONSTANT_RGBA[axis] / 255
      }
      if (normals)
        normals[i * 3 + axis] = view.getFloat32(f.NORMAL.byteOffset + (i * 3 + axis) * 4, true)
    }
  return {
    points: { positions, colors, normals, attributes: {} },
    rtc: f.RTC_CENTER ?? [0, 0, 0],
    properties: { feature: f, batch, batchBinary: Array.from(new Uint8Array(batchBinary)) },
  }
}

export async function readTileContent(
  source: SourceFile,
  context: AdapterContext,
  matrix = new Matrix4(),
): Promise<ModelDocument> {
  const format = extension(source.path)
  if (format === 'pnts') {
    const { points, rtc, properties } = parsePnts(await source.file.arrayBuffer()),
      p = new Vector3()
    const transform = matrix
      .clone()
      .multiply(new Matrix4().makeTranslation(...(rtc as [number, number, number])))
    for (let i = 0; i < points.positions.length; i += 3)
      points.positions.set(p.fromArray(points.positions, i).applyMatrix4(transform).toArray(), i)
    return {
      kind: 'pointcloud',
      name: basename(source.path),
      points,
      metadata: {
        source: source.path,
        format,
        unit: 'm',
        upAxis: 'Z',
        properties: { ...(properties as object), tileTransform: transform.toArray() },
        warnings: [],
      },
    }
  }
  let input = source,
    rtc = [0, 0, 0],
    properties: unknown = {}
  if (format === 'b3dm') {
    const parsed = parseTileContainer(await source.file.arrayBuffer(), 'b3dm')
    const glbLength = new DataView(parsed.content).getUint32(8, true)
    input = {
      path: source.path.replace(/b3dm$/i, 'glb'),
      file: new File([parsed.content.slice(0, glbLength)], 'content.glb'),
    }
    rtc = parsed.feature.RTC_CENTER ?? rtc
    properties = {
      feature: parsed.feature,
      batch: parsed.batch,
      batchBinary: Array.from(new Uint8Array(parsed.batchBinary)),
    }
  }
  const model = await readMesh(input, context)
  const wrapper = new Group()
  // 3D Tiles 的内容顺序：glTF 的 Y-up 转 Z-up → RTC 平移 → 父子瓦片矩阵。
  wrapper.matrixAutoUpdate = false
  wrapper.matrix
    .copy(matrix)
    .multiply(new Matrix4().makeTranslation(...(rtc as [number, number, number])))
    .multiply(new Matrix4().makeRotationX(Math.PI / 2))
  wrapper.add(model.scene!.root)
  model.scene!.root = wrapper
  model.metadata.properties = { tileProperties: properties, tileTransform: matrix.toArray() }
  model.metadata.upAxis = 'Z'
  model.metadata.unit = 'm'
  return model
}

export async function readTiles(
  source: SourceFile,
  context: AdapterContext,
): Promise<ModelDocument> {
  const warnings: string[] = [],
    visiting = new Set<string>()
  let visited = 0
  async function tree(
    file: SourceFile,
    parent: Matrix4,
    depth: number,
  ): Promise<{ name: string; model: ModelDocument }[]> {
    if (visiting.has(file.path)) throw new ModelError('TILES', 'tileset 外部引用存在循环。')
    if (depth > 64) throw new ModelError('TILES', '瓦片层级超过 64 层。')
    visiting.add(file.path)
    try {
      const data = JSON.parse(await file.file.text())
      if (!data.root || !data.asset) throw new ModelError('CORRUPT', '不是有效的 tileset.json。')
      return await node(data.root, file, parent, depth)
    } finally {
      visiting.delete(file.path)
    }
  }
  async function node(
    tile: any,
    file: SourceFile,
    parent: Matrix4,
    depth: number,
  ): Promise<{ name: string; model: ModelDocument }[]> {
    context.signal.throwIfAborted()
    if (++visited > 10000 || depth > 64)
      throw new ModelError('SIZE', '瓦片数量或深度超过安全限制。')
    if (tile.implicitTiling || tile.extensions?.['3DTILES_implicit_tiling'])
      throw new ModelError('VERSION', '首版仅支持显式瓦片层级，不支持 implicitTiling。')
    const transform = parent.clone()
    if (tile.transform) {
      if (
        tile.transform.length !== 16 ||
        tile.transform.some((value: number) => !Number.isFinite(value))
      )
        throw new ModelError('CORRUPT', '瓦片矩阵无效。')
      transform.multiply(new Matrix4().fromArray(tile.transform))
    }
    if (tile.children?.length) {
      try {
        const children = []
        for (const child of tile.children)
          children.push(...(await node(child, file, transform, depth + 1)))
        if (children.length) {
          if (tile.refine === 'ADD' && tile.content)
            warnings.push('ADD 分支按首版“最细内容”策略省略父级内容，可能省略父级独有细节。')
          return children
        }
      } catch (error) {
        if (!tile.content || (error as any).code !== 'MISSING_RESOURCE') throw error
        warnings.push(`子级资源缺失，改用完整父级以避免 LOD 重复：${(error as Error).message}`)
      }
    }
    const contents = tile.contents ?? (tile.content ? [tile.content] : [])
    const result = []
    for (const content of contents) {
      const entry = resolveResource(context.files, file.path, content.uri ?? content.url)
      if (extension(entry.path) === 'json')
        result.push(...(await tree(entry, transform, depth + 1)))
      else {
        if (!['glb', 'b3dm', 'pnts'].includes(extension(entry.path)))
          throw new ModelError('VERSION', `瓦片内容暂不支持：${entry.path}`)
        context.progress({ stage: `读取瓦片 ${entry.path}` })
        result.push({ name: entry.path, model: await readTileContent(entry, context, transform) })
      }
    }
    return result
  }
  const tiles = await tree(source, new Matrix4(), 0)
  if (!tiles.length) throw new ModelError('EMPTY', '瓦片集中没有可读取的内容。')
  return {
    kind: 'tiles',
    name: basename(source.path),
    tiles,
    metadata: {
      source: source.path,
      format: 'tiles',
      unit: 'm',
      upAxis: 'Z',
      properties: { selectedTiles: tiles.map((tile) => tile.name) },
      warnings: [...new Set(warnings)],
    },
  }
}
