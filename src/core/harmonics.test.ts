import { expect, it } from 'vitest'
import { rotateHarmonics, shBasis } from './harmonics'

it('三阶球谐旋转保持方向相关颜色且正反旋转恢复原始系数', () => {
  const attrs = Object.fromEntries(
    Array.from({ length: 45 }, (_, i) => [
      `f_rest_${i}`,
      new Float64Array([Math.sin(i + 1) * 0.1]),
    ]),
  )
  const original = Object.values(attrs).map((value) => value[0])
  const angle = Math.PI / 2,
    direction = [0.3, 0.4, Math.sqrt(0.75)]
  const before = shBasis(direction[0], direction[1], direction[2]).reduce(
    (sum, value, i) => sum + value * original[i],
    0,
  )
  rotateHarmonics(attrs, angle, 1)
  const after = shBasis(direction[0], -direction[2], direction[1]).reduce(
    (sum, value, i) => sum + value * attrs[`f_rest_${i}`][0],
    0,
  )
  expect(after).toBeCloseTo(before, 12)
  rotateHarmonics(attrs, -angle, 1)
  Object.values(attrs).forEach((value, i) => expect(value[0]).toBeCloseTo(original[i], 12))
})
