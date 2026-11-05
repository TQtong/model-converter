import { expect, it } from 'vitest'
import { parsePcd, parseSplat, parseXyz, writePcd, writeSplat } from './points'

it('XYZ 与 PCD 回读保留大坐标、颜色及附加字段', () => {
  const points = parseXyz('# 中文说明\n6378137.123456789 2 3 255 128 0\n1 2 3 0 255 0')
  points.attributes.intensity = new Float64Array([12, 34])
  const result = parsePcd(writePcd(points).buffer as ArrayBuffer)
  expect(result.positions).toEqual(points.positions)
  expect(result.attributes.intensity).toEqual(points.attributes.intensity)
  expect(result.colors![0]).toBe(1)
  expect(() => parseXyz('0 1 invalid')).toThrow()
})

it('SPLAT 二进制读取与写入使用真实高斯尺度、旋转和透明度', () => {
  const points = parseXyz('1 2 3')
  for (const name of [
    'scale_0',
    'scale_1',
    'scale_2',
    'rot_0',
    'rot_1',
    'rot_2',
    'rot_3',
    'f_dc_0',
    'f_dc_1',
    'f_dc_2',
    'opacity',
  ])
    points.attributes[name] = new Float64Array([name === 'rot_0' ? 1 : 0])
  const result = parseSplat(writeSplat(points).buffer as ArrayBuffer)
  expect(result.positions).toEqual(points.positions)
  expect(result.attributes.scale_0[0]).toBe(0)
  expect(result.attributes.opacity[0]).toBeCloseTo(0, 1)
  expect(() => parseSplat(new ArrayBuffer(31))).toThrow()
})
