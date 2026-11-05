import { parsePly, writePointPly } from '../core/ply'
import { parsePcd, parseSplat, parseXyz, writePcd, writeSplat } from '../core/points'
import { ModelError, type PointData, type Progress } from '../core/types'

async function execute(operation: string, payload: any, progress: (value: Progress) => void): Promise<unknown> {
  if (operation === 'read-points') {
    const { format, buffer } = payload as { format: string; buffer: ArrayBuffer }
    if (format === 'ply') return parsePly(buffer)
    if (format === 'pcd') return parsePcd(buffer)
    if (format === 'xyz') return parseXyz(new TextDecoder().decode(buffer))
    if (format === 'splat') return parseSplat(buffer)
    if (format === 'las' || format === 'laz') {
      const bytes = new Uint8Array(buffer)
      if (bytes.length < 227 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'LASF') throw new ModelError('CORRUPT', 'LAS/LAZ 文件头无效。')
      if (bytes[24] !== 1 || bytes[25] > 3) throw new ModelError('VERSION', `LAS ${bytes[24]}.${bytes[25]} 尚未支持，当前仅接受 1.0–1.3。`)
      if ((bytes[104] & 63) > 3) throw new ModelError('VERSION', '当前 LAS 引擎仅验证了点记录格式 0–3，不支持波形格式 4/5。')
      const { parse } = await import('@loaders.gl/core')
      const { LASLoader } = await import('@loaders.gl/las')
      const data = await parse(buffer, LASLoader, { worker: false, las: { fp64: true, skip: 1 } })
      const positions = new Float64Array(data.attributes.POSITION.value)
      const color = data.attributes.COLOR_0?.value
      const colors = color ? new Float32Array(positions.length) : undefined
      if (colors) for (let i = 0; i < positions.length / 3; i++) for (let j = 0; j < 3; j++) colors[i * 3 + j] = color![i * 4 + j] / 255
      const attributes: PointData['attributes'] = {}
      for (const key of ['intensity', 'classification']) if (data.attributes[key]) attributes[key] = new Float64Array(data.attributes[key].value)
      return { positions, colors, attributes, lasHeader: data.loaderData }
    }
  }
  if (operation === 'write-points') {
    const { points, format, binary, gaussian } = payload as { points: PointData; format: string; binary: boolean; gaussian: boolean }
    if (format === 'ply') return writePointPly(points, binary, gaussian)
    if (format === 'pcd') return writePcd(points)
    if (format === 'splat') return writeSplat(points)
    if (format === 'xyz') {
      const lines: string[] = []
      for (let i = 0; i < points.positions.length; i += 3) {
        let line = `${points.positions[i]} ${points.positions[i + 1]} ${points.positions[i + 2]}`
        if (points.colors) line += ` ${[0, 1, 2].map(j => Math.round(Math.max(0, Math.min(1, points.colors![i + j])) * 255)).join(' ')}`
        lines.push(line)
      }
      return new TextEncoder().encode(lines.join('\n') + '\n')
    }
  }
  if (operation === 'cad') {
    progress({ stage: '加载 OCCT 单线程曲面引擎' })
    const { default: initialize } = await import('occt-import-js')
    const engine = await initialize({ locateFile: () => payload.wasmUrl })
    progress({ stage: '离散化 CAD 曲面（引擎不提供精确百分比）' })
    const method = ['step', 'stp'].includes(payload.format) ? 'ReadStepFile' : ['iges', 'igs'].includes(payload.format) ? 'ReadIgesFile' : 'ReadBrepFile'
    const result = engine[method](new Uint8Array(payload.buffer), { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: payload.tolerance, angularDeflection: 0.5 })
    if (!result.success) throw new ModelError('CAD', 'CAD 读取失败，请检查文件是否损坏、版本和曲面定义。')
    return result
  }
  throw new ModelError('OPERATION', `未实现的后台操作：${operation}`)
}

self.onmessage = async event => {
  const { id, operation, payload } = event.data
  try {
    const value = await execute(operation, payload, value => self.postMessage({ id, type: 'progress', value }))
    self.postMessage({ id, type: 'result', value })
  } catch (error) {
    const failure = error as Error & { code?: string }
    self.postMessage({ id, type: 'error', message: failure.message, code: failure.code ?? 'ENGINE' })
  }
}
