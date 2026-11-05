import { ModelError, type PointData } from './types'

export function parseXyz(text: string): PointData {
  const positions: number[] = [], colors: number[] = []
  let colored: boolean | undefined
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const values = line.trim().split(/[\s,;]+/).map(Number)
    if (values.length !== 3 && values.length !== 6) throw new ModelError('CORRUPT', `XYZ 第 ${index + 1} 行应包含 3 个坐标或 3 个坐标加 RGB。`)
    if (values.some(value => !Number.isFinite(value))) throw new ModelError('CORRUPT', `XYZ 第 ${index + 1} 行含有无效数值。`)
    if (colored !== undefined && colored !== (values.length === 6)) throw new ModelError('CORRUPT', 'XYZ 各行的颜色列数量不一致。')
    colored = values.length === 6
    positions.push(...values.slice(0, 3))
    if (colored) colors.push(...values.slice(3).map(value => value / 255))
  }
  if (!positions.length) throw new ModelError('EMPTY', 'XYZ 没有可读取的点。')
  return { positions: new Float64Array(positions), colors: colored ? new Float32Array(colors) : undefined, attributes: {} }
}

/** PCD 压缩数据使用 LZF，输出为按字段分组的布局。 */
function decompressLzf(input: Uint8Array, length: number): Uint8Array<ArrayBuffer> {
  if (length > 1024 ** 3) throw new ModelError('SIZE', 'PCD 解压后超过 1 GiB。')
  const output = new Uint8Array(length)
  let source = 0, target = 0
  while (source < input.length) {
    const control = input[source++]
    if (control < 32) {
      const count = control + 1
      if (source + count > input.length || target + count > length) throw new ModelError('CORRUPT', 'PCD LZF 字面块损坏。')
      output.set(input.subarray(source, source + count), target); source += count; target += count
    } else {
      let count = control >> 5
      let reference = target - ((control & 31) << 8) - 1
      if (count === 7) count += input[source++]
      reference -= input[source++]; count += 2
      if (source > input.length || reference < 0 || reference >= target || target + count > length) throw new ModelError('CORRUPT', 'PCD LZF 引用越界。')
      while (count--) output[target++] = output[reference++]
    }
  }
  if (target !== length) throw new ModelError('CORRUPT', 'PCD 解压长度与头部不符。')
  return output
}

export function parsePcd(buffer: ArrayBuffer): PointData {
  const bytes = new Uint8Array(buffer)
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)))
  const match = /^DATA\s+(ascii|binary|binary_compressed)\s*\r?\n/im.exec(head)
  if (!match) throw new ModelError('CORRUPT', 'PCD 缺少有效 DATA 声明。')
  const offset = new TextEncoder().encode(head.slice(0, match.index + match[0].length)).length
  const header = head.slice(0, match.index)
  const field = (key: string) => new RegExp(`^${key}\\s+(.+)$`, 'im').exec(header)?.[1].trim().split(/\s+/) ?? []
  const names = field('FIELDS'), sizes = field('SIZE').map(Number), types = field('TYPE'), counts = field('COUNT').length ? field('COUNT').map(Number) : names.map(() => 1)
  const count = Number(field('POINTS')[0] ?? Number(field('WIDTH')[0]) * Number(field('HEIGHT')[0]))
  if (!Number.isSafeInteger(count) || count < 1 || count > 30000000 || !['x', 'y', 'z'].every(name => names.includes(name))) throw new ModelError('CORRUPT', 'PCD 点数或字段无效。')
  if (names.length !== sizes.length || names.length !== types.length || names.length !== counts.length || sizes.some(size => ![1, 2, 4, 8].includes(size)) || counts.some(n => !Number.isInteger(n) || n < 1 || n > 1024)) throw new ModelError('CORRUPT', 'PCD 字段类型或长度无效。')
  const stride = sizes.reduce((sum, size, i) => sum + size * counts[i], 0)
  if (stride * count > 1024 ** 3) throw new ModelError('SIZE', 'PCD 数据超过 1 GiB。')
  let body = bytes.subarray(offset)
  const compressed = match[1] === 'binary_compressed'
  if (compressed) {
    if (body.length < 8) throw new ModelError('CORRUPT', 'PCD 压缩头部被截断。')
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
    if (view.getUint32(4, true) !== stride * count || view.getUint32(0, true) + 8 !== body.length) throw new ModelError('CORRUPT', 'PCD 压缩长度异常。')
    body = decompressLzf(body.subarray(8), stride * count)
  }
  const ascii = match[1] === 'ascii'
  const tokens = ascii ? new TextDecoder().decode(body).trim().split(/\s+/) : []
  if (!ascii && body.length < stride * count) throw new ModelError('CORRUPT', 'PCD 二进制数据被截断。')
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  let fieldOffset = 0, tokenOffset = 0
  const attributes: Record<string, Float64Array> = {}
  const tokenStride = counts.reduce((sum, n) => sum + n, 0)
  for (let f = 0; f < names.length; f++) {
    const size = sizes[f], components = counts[f]
    for (let component = 0; component < components; component++) {
      const name = components === 1 ? names[f] : `${names[f]}_${component}`
      const values = attributes[name] = new Float64Array(count)
      for (let i = 0; i < count; i++) {
        const position = compressed ? fieldOffset * count + (i * components + component) * size : i * stride + fieldOffset + component * size
        if (ascii) values[i] = Number(tokens[i * tokenStride + tokenOffset + component])
        else {
          const method = types[f] === 'F' ? (size === 8 ? 'getFloat64' : 'getFloat32') : `get${types[f] === 'I' ? 'Int' : 'Uint'}${size * 8}`
          const getter = view[method as keyof DataView]
          if (typeof getter !== 'function') throw new ModelError('VERSION', '不支持的 PCD 数据类型。')
          values[i] = (getter as (offset: number, little: boolean) => number).call(view, position, true)
        }
        if (!Number.isFinite(values[i]) && !['rgb', 'rgba'].includes(name)) throw new ModelError('CORRUPT', 'PCD 含有无效数值。')
      }
    }
    fieldOffset += size * components; tokenOffset += components
  }
  const positions = new Float64Array(count * 3), normals = attributes.normal_x ? new Float32Array(count * 3) : undefined
  const colors = attributes.rgb || attributes.rgba ? new Float32Array(count * 3) : undefined
  const packed = new DataView(new ArrayBuffer(4))
  for (let i = 0; i < count; i++) {
    positions.set([attributes.x[i], attributes.y[i], attributes.z[i]], i * 3)
    if (normals) normals.set([attributes.normal_x[i], attributes.normal_y[i], attributes.normal_z[i]], i * 3)
    if (colors) {
      const name = attributes.rgb ? 'rgb' : 'rgba'
      const number = attributes[name][i]
      packed.setFloat32(0, number, true)
      const rgb = types[names.indexOf(name)] === 'F' ? packed.getUint32(0, true) : number
      colors.set([(rgb >> 16 & 255) / 255, (rgb >> 8 & 255) / 255, (rgb & 255) / 255], i * 3)
    }
  }
  return { positions, colors, normals, attributes }
}

export function writePcd(points: PointData): Uint8Array {
  const n = points.positions.length / 3
  const fields = ['x', 'y', 'z', ...(points.normals ? ['normal_x', 'normal_y', 'normal_z'] : []), ...(points.colors ? ['rgb'] : []), ...Object.keys(points.attributes).filter(key => !['x', 'y', 'z', 'normal_x', 'normal_y', 'normal_z', 'rgb', 'rgba'].includes(key) && !/^(scale_|rot_|f_dc_|f_rest_|opacity)/.test(key))]
  const rows: string[] = []
  for (let i = 0; i < n; i++) rows.push(fields.map(name => {
    const axis = ['x', 'y', 'z'].indexOf(name)
    if (axis >= 0) return points.positions[i * 3 + axis]
    if (name.startsWith('normal_') && points.normals) return points.normals[i * 3 + ['normal_x', 'normal_y', 'normal_z'].indexOf(name)]
    if (name === 'rgb' && points.colors) return (Math.round(points.colors[i * 3] * 255) << 16) | (Math.round(points.colors[i * 3 + 1] * 255) << 8) | Math.round(points.colors[i * 3 + 2] * 255)
    return points.attributes[name][i]
  }).join(' '))
  return new TextEncoder().encode(`# .PCD v0.7\nVERSION 0.7\nFIELDS ${fields.join(' ')}\nSIZE ${fields.map(name => name === 'rgb' ? 4 : 8).join(' ')}\nTYPE ${fields.map(name => name === 'rgb' ? 'U' : 'F').join(' ')}\nCOUNT ${fields.map(() => 1).join(' ')}\nWIDTH ${n}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS ${n}\nDATA ascii\n${rows.join('\n')}\n`)
}

export function parseSplat(buffer: ArrayBuffer): PointData {
  if (!buffer.byteLength || buffer.byteLength % 32) throw new ModelError('CORRUPT', 'SPLAT 长度必须是 32 字节记录的整数倍。')
  const n = buffer.byteLength / 32, view = new DataView(buffer)
  const positions = new Float64Array(n * 3), colors = new Float32Array(n * 3)
  const attributes: PointData['attributes'] = {}
  for (const name of ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity']) attributes[name] = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      const position = view.getFloat32(i * 32 + j * 4, true), scale = view.getFloat32(i * 32 + 12 + j * 4, true)
      if (!Number.isFinite(position) || !Number.isFinite(scale) || scale <= 0) throw new ModelError('CORRUPT', 'SPLAT 坐标或尺度无效。')
      positions[i * 3 + j] = position
      attributes[`scale_${j}`][i] = Math.log(scale)
      colors[i * 3 + j] = view.getUint8(i * 32 + 24 + j) / 255
      attributes[`f_dc_${j}`][i] = (colors[i * 3 + j] - 0.5) / 0.28209479177387814
    }
    const alpha = Math.max(1e-6, Math.min(1 - 1e-6, view.getUint8(i * 32 + 27) / 255))
    attributes.opacity[i] = Math.log(alpha / (1 - alpha))
    for (let j = 0; j < 4; j++) attributes[`rot_${j}`][i] = (view.getUint8(i * 32 + 28 + j) - 128) / 128
  }
  return { positions, colors, attributes }
}

export function writeSplat(points: PointData): Uint8Array {
  const n = points.positions.length / 3, bytes = new Uint8Array(n * 32), view = new DataView(bytes.buffer)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      view.setFloat32(i * 32 + j * 4, points.positions[i * 3 + j], true)
      view.setFloat32(i * 32 + 12 + j * 4, Math.exp(points.attributes[`scale_${j}`][i]), true)
      bytes[i * 32 + 24 + j] = Math.round(Math.max(0, Math.min(1, 0.5 + points.attributes[`f_dc_${j}`][i] * 0.28209479177387814)) * 255)
    }
    bytes[i * 32 + 27] = Math.round(255 / (1 + Math.exp(-points.attributes.opacity[i])))
    const quaternion = [0, 1, 2, 3].map(j => points.attributes[`rot_${j}`][i])
    const length = Math.hypot(...quaternion) || 1
    for (let j = 0; j < 4; j++) bytes[i * 32 + 28 + j] = Math.max(0, Math.min(255, Math.round(quaternion[j] / length * 128 + 128)))
  }
  return bytes
}
