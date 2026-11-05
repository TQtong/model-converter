import { expect, it } from 'vitest'
import { parsePly, writePointPly } from './ply'
import type { PointData } from './types'

it('依据面与高斯属性区分三种 PLY，并验证双精度大坐标回读', () => {
  const points: PointData = {
    positions: new Float64Array([6378137.123456789, 2, 3]),
    colors: new Float32Array([1, 0.5, 0]),
    attributes: { intensity: new Float64Array([42]) },
  }
  for (const binary of [true, false]) {
    const parsed = parsePly(writePointPly(points, binary, false).buffer as ArrayBuffer)
    expect(parsed.points.positions[0]).toBe(points.positions[0])
    expect(parsed.points.attributes.intensity[0]).toBe(42)
    expect(parsed.gaussian).toBe(false)
  }
  for (const key of [
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
    'f_rest_0',
  ])
    points.attributes[key] = new Float64Array([0.1])
  const gaussian = parsePly(writePointPly(points, true, true).buffer as ArrayBuffer)
  expect(gaussian.gaussian).toBe(true)
  expect(gaussian.points.attributes.f_rest_0[0]).toBe(0.1)
  const mesh = parsePly(
    new TextEncoder().encode(
      'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n',
    ).buffer,
  )
  expect([...mesh.indices]).toEqual([0, 1, 2])
})

it('拒绝损坏的 PLY 列表和截断数据', () => {
  expect(() =>
    parsePly(
      new TextEncoder().encode(
        'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0',
      ).buffer,
    ),
  ).toThrow('截断')
})

it('网格 PLY 面索引与双精度坐标在 ASCII 和二进制下回读一致', () => {
  const positions = new Float64Array([
    6378137.123456789, 0, 0, 6378138.123456789, 0, 0, 6378137.123456789, 1, 0,
  ])
  for (const binary of [false, true]) {
    const result = parsePly(
      writePointPly({ positions, attributes: {} }, binary, false, new Uint32Array([0, 1, 2]))
        .buffer as ArrayBuffer,
    )
    expect(result.indices).toEqual(new Uint32Array([0, 1, 2]))
    expect(result.points.positions).toEqual(positions)
  }
})
