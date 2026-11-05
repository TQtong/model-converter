import { expect, it } from 'vitest'
import { reconstruct, sampleSurface } from './reconstruction'
import type { PointData } from './types'

it('表面采样落在三角形内且保留颜色，生成沿表面扁平的高斯', () => {
  const points: PointData = {
    positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    colors: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
    attributes: {},
  }
  const result = sampleSurface(points, new Uint32Array([0, 1, 2]), 1000, true, () => {})
  for (let i = 0; i < 1000; i++) {
    expect(result.positions[i * 3] + result.positions[i * 3 + 1]).toBeLessThanOrEqual(1.00000001)
    expect(result.positions[i * 3 + 2]).toBe(0)
    expect(result.colors![i * 3]).toBe(1)
    expect(result.attributes.scale_2[i]).toBeLessThan(result.attributes.scale_0[i])
  }
})

it('已知球面点云距离场产生有限且范围正确的近似表面', () => {
  const p: number[] = [],
    n: number[] = []
  for (let i = 0; i < 1000; i++) {
    const y = 1 - (2 * (i + 0.5)) / 1000,
      r = Math.sqrt(1 - y * y),
      angle = i * 2.399963229728653
    const v = [r * Math.cos(angle), y, r * Math.sin(angle)]
    p.push(...v)
    n.push(...v)
  }
  const result = reconstruct(
    { positions: new Float64Array(p), normals: new Float32Array(n), attributes: {} },
    false,
    16,
    0.25,
    () => {},
  )
  expect(result.positions.length).toBeGreaterThan(100)
  expect([...result.positions].every(Number.isFinite)).toBe(true)
  let error = 0
  for (let i = 0; i < result.positions.length; i += 3)
    error += Math.abs(Math.hypot(...result.positions.slice(i, i + 3)) - 1)
  expect(error / (result.positions.length / 3)).toBeLessThan(0.15)
})
