import { ModelError, type PointData } from './types'

const decoder = new TextDecoder()
const types: Record<string, [number, string]> = {
  char: [1, 'Int8'],
  int8: [1, 'Int8'],
  uchar: [1, 'Uint8'],
  uint8: [1, 'Uint8'],
  short: [2, 'Int16'],
  int16: [2, 'Int16'],
  ushort: [2, 'Uint16'],
  uint16: [2, 'Uint16'],
  int: [4, 'Int32'],
  int32: [4, 'Int32'],
  uint: [4, 'Uint32'],
  uint32: [4, 'Uint32'],
  float: [4, 'Float32'],
  float32: [4, 'Float32'],
  double: [8, 'Float64'],
  float64: [8, 'Float64'],
}
interface Property {
  name: string
  type: string
  countType?: string
}
interface Element {
  name: string
  count: number
  properties: Property[]
}
export interface ParsedPly {
  points: PointData
  indices: Uint32Array
  gaussian: boolean
  comments: string[]
  warnings: string[]
}

/** 按头部声明读取所有顶点标量，不丢弃高阶球谐或工程附加属性。 */
export function parsePly(buffer: ArrayBuffer): ParsedPly {
  const bytes = new Uint8Array(buffer)
  let end = -1
  for (let i = 0; i < Math.min(bytes.length, 1024 * 1024) - 10; i++) {
    if (bytes[i] === 101 && decoder.decode(bytes.subarray(i, i + 10)) === 'end_header') {
      end = i + 10
      if (bytes[end] === 13) end++
      if (bytes[end] === 10) end++
      break
    }
  }
  if (end < 0) throw new ModelError('CORRUPT', 'PLY 缺少有效头部或头部超过 1 MiB。')
  const lines = decoder.decode(bytes.subarray(0, end)).split(/\r?\n/)
  if (lines[0].trim() !== 'ply') throw new ModelError('CORRUPT', '文件内容不是 PLY。')
  const format = lines.find((line) => line.startsWith('format '))?.split(/\s+/)[1]
  if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(format ?? ''))
    throw new ModelError('VERSION', '不支持此 PLY 编码。')
  const elements: Element[] = []
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === 'element') {
      const count = Number(parts[2])
      if (!Number.isSafeInteger(count) || count < 0 || count > 50000000)
        throw new ModelError('SIZE', 'PLY 元素数量无效或超过安全上限。')
      elements.push({ name: parts[1], count, properties: [] })
    }
    if (parts[0] === 'property') {
      const property =
        parts[1] === 'list'
          ? { name: parts[4], type: parts[3], countType: parts[2] }
          : { name: parts[2], type: parts[1] }
      if (
        !types[property.type] ||
        (property.countType && !types[property.countType]) ||
        !elements.length
      )
        throw new ModelError('CORRUPT', 'PLY 属性类型无效。')
      elements.at(-1)!.properties.push(property)
    }
  }
  const vertex = elements.find((element) => element.name === 'vertex')
  if (
    !vertex ||
    !['x', 'y', 'z'].every((name) => vertex.properties.some((property) => property.name === name))
  )
    throw new ModelError('CORRUPT', 'PLY 缺少顶点坐标。')
  const attributes: Record<string, Float64Array> = {}
  for (const property of vertex.properties)
    if (!property.countType) attributes[property.name] = new Float64Array(vertex.count)
  // ASCII 采用逐 token 游标，避免对大文件生成数百万个字符串数组元素。
  const body = format === 'ascii' ? decoder.decode(bytes.subarray(end)) : ''
  let cursor = 0
  let offset = end
  const view = new DataView(buffer)
  function read(type: string): number {
    let value: number
    if (format === 'ascii') {
      while (cursor < body.length && /\s/.test(body[cursor])) cursor++
      const start = cursor
      while (cursor < body.length && !/\s/.test(body[cursor])) cursor++
      if (start === cursor) throw new ModelError('CORRUPT', 'PLY 数据被截断。')
      value = Number(body.slice(start, cursor))
    } else {
      const [size, method] = types[type]
      if (offset + size > view.byteLength) throw new ModelError('CORRUPT', 'PLY 二进制数据被截断。')
      value = (
        view[`get${method}` as keyof DataView] as (offset: number, little: boolean) => number
      ).call(view, offset, format === 'binary_little_endian')
      offset += size
    }
    if (!Number.isFinite(value)) throw new ModelError('CORRUPT', 'PLY 含有非有限数值。')
    return value
  }
  const faces: number[] = []
  let polygonFaces = 0
  for (const element of elements)
    for (let row = 0; row < element.count; row++) {
      for (const property of element.properties) {
        if (property.countType) {
          const count = read(property.countType)
          if (!Number.isSafeInteger(count) || count < 0 || count > 1000000)
            throw new ModelError('CORRUPT', 'PLY 列表长度异常。')
          const face: number[] = []
          for (let j = 0; j < count; j++) {
            const value = read(property.type)
            if (
              element.name === 'face' &&
              ['vertex_indices', 'vertex_index'].includes(property.name)
            ) {
              if (!Number.isInteger(value) || value < 0 || value >= vertex.count)
                throw new ModelError('CORRUPT', 'PLY 面索引越界。')
              face.push(value)
            }
          }
          for (let j = 1; j < face.length - 1; j++) faces.push(face[0], face[j], face[j + 1])
          if (face.length > 3) polygonFaces++
        } else {
          const value = read(property.type)
          if (element.name === 'vertex') attributes[property.name][row] = value
        }
      }
    }
  const positions = new Float64Array(vertex.count * 3)
  let colors: Float32Array | undefined
  let normals: Float32Array | undefined
  if (['red', 'green', 'blue'].every((key) => attributes[key]))
    colors = new Float32Array(positions.length)
  if (['nx', 'ny', 'nz'].every((key) => attributes[key]))
    normals = new Float32Array(positions.length)
  for (let i = 0; i < vertex.count; i++) {
    positions.set([attributes.x[i], attributes.y[i], attributes.z[i]], i * 3)
    if (colors)
      colors.set(
        [attributes.red[i] / 255, attributes.green[i] / 255, attributes.blue[i] / 255],
        i * 3,
      )
    if (normals) normals.set([attributes.nx[i], attributes.ny[i], attributes.nz[i]], i * 3)
  }
  const gaussian = [
    'scale_0',
    'scale_1',
    'scale_2',
    'rot_0',
    'rot_1',
    'rot_2',
    'rot_3',
    'opacity',
    'f_dc_0',
    'f_dc_1',
    'f_dc_2',
  ].every((key) => attributes[key])
  return {
    points: { positions, colors, normals, attributes },
    indices: new Uint32Array(faces),
    gaussian,
    comments: lines.filter((line) => line.startsWith('comment ')).map((line) => line.slice(8)),
    warnings: [
      ...(polygonFaces
        ? [
            `PLY 的 ${polygonFaces} 个多边形已按扇形三角化；凹多边形建议在源软件中预先三角化并检查结果。`,
          ]
        : []),
      ...(elements.some((element) => !['vertex', 'face'].includes(element.name)) ||
      vertex.properties.some((property) => property.countType) ||
      elements
        .find((element) => element.name === 'face')
        ?.properties.some((property) => !['vertex_indices', 'vertex_index'].includes(property.name))
        ? [
            'PLY 非顶点/面的附加元素、顶点列表及面附加属性未提取；已读取的顶点标量会保存在数据或元信息中。',
          ]
        : []),
    ],
  }
}

export function writePointPly(
  points: PointData,
  binary: boolean,
  gaussian: boolean,
  indices?: Uint32Array,
): Uint8Array {
  const count = points.positions.length / 3
  const columns: { name: string; type: 'double' | 'uchar'; get: (i: number) => number }[] = [
    'x',
    'y',
    'z',
  ].map((name, axis) => ({ name, type: 'double', get: (i) => points.positions[i * 3 + axis] }))
  if (points.colors && !gaussian)
    ['red', 'green', 'blue'].forEach((name, axis) =>
      columns.push({
        name,
        type: 'uchar',
        get: (i) => Math.round(Math.max(0, Math.min(1, points.colors![i * 3 + axis])) * 255),
      }),
    )
  if (points.normals)
    ['nx', 'ny', 'nz'].forEach((name, axis) =>
      columns.push({ name, type: 'double', get: (i) => points.normals![i * 3 + axis] }),
    )
  for (const [name, values] of Object.entries(points.attributes)) {
    if (columns.some((column) => column.name === name)) continue
    if (!gaussian && /^(?:scale_|rot_|opacity|f_dc_|f_rest_)/.test(name)) continue
    if (!/^[a-zA-Z_][\w]*$/.test(name)) continue
    columns.push({ name, type: 'double', get: (i) => values[i] })
  }
  const faceHeader = indices?.length
    ? `element face ${indices.length / 3}\nproperty list uchar uint vertex_indices\n`
    : ''
  const header = new TextEncoder().encode(
    `ply\nformat ${binary ? 'binary_little_endian' : 'ascii'} 1.0\ncomment Model Converter; original coordinates\nelement vertex ${count}\n${columns.map((column) => `property ${column.type} ${column.name}`).join('\n')}\n${faceHeader}end_header\n`,
  )
  if (!binary)
    return new TextEncoder().encode(
      new TextDecoder().decode(header) +
        Array.from({ length: count }, (_, i) =>
          columns.map((column) => column.get(i)).join(' '),
        ).join('\n') +
        '\n' +
        (indices?.length
          ? Array.from(
              { length: indices.length / 3 },
              (_, i) => `3 ${indices[i * 3]} ${indices[i * 3 + 1]} ${indices[i * 3 + 2]}`,
            ).join('\n') + '\n'
          : ''),
    )
  const stride = columns.reduce((size, column) => size + (column.type === 'double' ? 8 : 1), 0)
  const result = new Uint8Array(header.length + stride * count + ((indices?.length ?? 0) / 3) * 13)
  result.set(header)
  const view = new DataView(result.buffer)
  let offset = header.length
  for (let i = 0; i < count; i++)
    for (const column of columns) {
      if (column.type === 'double') {
        view.setFloat64(offset, column.get(i), true)
        offset += 8
      } else view.setUint8(offset++, column.get(i))
    }
  if (indices)
    for (let i = 0; i < indices.length; i += 3) {
      view.setUint8(offset++, 3)
      for (let j = 0; j < 3; j++) {
        view.setUint32(offset, indices[i + j], true)
        offset += 4
      }
    }
  return result
}
