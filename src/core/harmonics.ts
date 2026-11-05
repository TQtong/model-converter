import { ModelError, type PointData } from './types'

/** 标准 3DGS 实球谐基函数，顺序与高斯 PLY 的 f_rest_* 一致。 */
export function shBasis(x: number, y: number, z: number): number[] {
  const xx = x * x,
    yy = y * y,
    zz = z * z
  return [
    -0.4886025119029199 * y,
    0.4886025119029199 * z,
    -0.4886025119029199 * x,
    1.0925484305920792 * x * y,
    -1.0925484305920792 * y * z,
    0.31539156525252005 * (2 * zz - xx - yy),
    -1.0925484305920792 * x * z,
    0.5462742152960396 * (xx - yy),
    -0.5900435899266435 * y * (3 * xx - yy),
    2.890611442640554 * x * y * z,
    -0.4570457994644658 * y * (4 * zz - xx - yy),
    0.3731763325901154 * z * (2 * zz - 3 * xx - 3 * yy),
    -0.4570457994644658 * x * (4 * zz - xx - yy),
    1.445305721320277 * z * (xx - yy),
    -0.5900435899266435 * x * (xx - 3 * yy),
  ]
}

const cache = new Map<number, Float64Array>()
function rotationMatrix(angle: number): Float64Array {
  if (cache.has(angle)) return cache.get(angle)!
  const matrix = new Float64Array(15 * 15),
    c = Math.cos(angle),
    s = Math.sin(angle)
  // 4 点 Gauss-Legendre × 16 点方位积分，对最高三阶基函数的乘积足够精确。
  const nodes = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526]
  const weights = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538]
  for (let row = 0; row < nodes.length; row++)
    for (let azimuth = 0; azimuth < 16; azimuth++) {
      const z = nodes[row],
        r = Math.sqrt(1 - z * z),
        phi = (azimuth * Math.PI) / 8
      const x = r * Math.cos(phi),
        y = r * Math.sin(phi)
      const target = shBasis(x, y, z),
        source = shBasis(x, c * y + s * z, -s * y + c * z)
      const weight = (weights[row] * Math.PI) / 8
      for (let i = 0; i < 15; i++)
        for (let j = 0; j < 15; j++) matrix[i * 15 + j] += target[i] * source[j] * weight
    }
  for (let i = 0; i < matrix.length; i++) if (Math.abs(matrix[i]) < 1e-12) matrix[i] = 0
  cache.set(angle, matrix)
  return matrix
}

/** 旋转属性副本中的球谐，保持“位置旋转后，同一世界方向的外观”一致。 */
export function rotateHarmonics(attributes: PointData['attributes'], angle: number, count: number) {
  const keys = Object.keys(attributes).filter((key) => /^f_rest_\d+$/.test(key))
  if (!keys.length || !angle) return
  const dimensions = keys.length / 3
  if (
    ![3, 8, 15].includes(dimensions) ||
    !Array.from({ length: dimensions * 3 }, (_, i) => attributes[`f_rest_${i}`]).every(Boolean)
  )
    throw new ModelError(
      'SH_ROTATION',
      '高阶球谐属性集合不完整，无法正确旋转。请保留方向或补充完整属性。',
    )
  const matrix = rotationMatrix(angle),
    original = new Float64Array(dimensions)
  for (let point = 0; point < count; point++)
    for (let channel = 0; channel < 3; channel++) {
      for (let i = 0; i < dimensions; i++)
        original[i] = attributes[`f_rest_${channel * dimensions + i}`][point]
      for (let i = 0; i < dimensions; i++) {
        let sum = 0
        for (let j = 0; j < dimensions; j++)
          if (matrix[i * 15 + j]) sum += matrix[i * 15 + j] * original[j]
        attributes[`f_rest_${channel * dimensions + i}`][point] = sum
      }
    }
}
