import { Box3, Matrix4, Quaternion, Vector3 } from 'three'
import { ModelError, type PointData, type Progress } from './types'

/** 面积加权采样使用平方根重参数化，避免三角形边角出现概率偏差。 */
export function sampleSurface(
  points: PointData,
  indices: Uint32Array,
  count: number,
  gaussian: boolean,
  progress: (value: Progress) => void,
): PointData {
  if (!Number.isSafeInteger(count) || count < 100 || count > 2000000)
    throw new ModelError('PARAMETER', '采样数量应在 100 到 2000000 之间。')
  const cumulative = new Float64Array(indices.length / 3)
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    ab = new Vector3(),
    ac = new Vector3(),
    normal = new Vector3()
  let area = 0
  for (let face = 0; face < cumulative.length; face++) {
    a.fromArray(points.positions, indices[face * 3] * 3)
    b.fromArray(points.positions, indices[face * 3 + 1] * 3)
    c.fromArray(points.positions, indices[face * 3 + 2] * 3)
    area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2
    cumulative[face] = area
  }
  if (!(area > 0)) throw new ModelError('EMPTY', '网格没有可采样的非退化三角面。')
  const result: PointData = {
    positions: new Float64Array(count * 3),
    normals: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    attributes: {},
  }
  if (gaussian)
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
    ])
      result.attributes[key] = new Float64Array(count)
  const scale = Math.sqrt(area / count) * 0.5
  const quaternion = new Quaternion()
  for (let i = 0; i < count; i++) {
    if (i % 10000 === 0) progress({ stage: '按三角面面积采样', fraction: i / count })
    const value = Math.random() * area
    let left = 0,
      right = cumulative.length - 1
    while (left < right) {
      const mid = (left + right) >> 1
      if (cumulative[mid] < value) left = mid + 1
      else right = mid
    }
    const ids = [indices[left * 3], indices[left * 3 + 1], indices[left * 3 + 2]]
    a.fromArray(points.positions, ids[0] * 3)
    b.fromArray(points.positions, ids[1] * 3)
    c.fromArray(points.positions, ids[2] * 3)
    const r = Math.sqrt(Math.random()),
      s = Math.random(),
      weights = [1 - r, r * (1 - s), r * s]
    normal.subVectors(b, a).cross(ac.subVectors(c, a)).normalize()
    for (let axis = 0; axis < 3; axis++) {
      result.positions[i * 3 + axis] = ids.reduce(
        (sum, id, j) => sum + points.positions[id * 3 + axis] * weights[j],
        0,
      )
      result.colors![i * 3 + axis] = points.colors
        ? ids.reduce((sum, id, j) => sum + points.colors![id * 3 + axis] * weights[j], 0)
        : 0.7
      result.normals![i * 3 + axis] = normal.getComponent(axis)
      if (gaussian) {
        result.attributes[`scale_${axis}`][i] = Math.log(
          Math.max(scale * (axis === 2 ? 0.15 : 1), 1e-12),
        )
        result.attributes[`f_dc_${axis}`][i] =
          (result.colors![i * 3 + axis] - 0.5) / 0.28209479177387814
      }
    }
    if (gaussian) {
      quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal)
      for (const [axis, component] of [
        quaternion.w,
        quaternion.x,
        quaternion.y,
        quaternion.z,
      ].entries())
        result.attributes[`rot_${axis}`][i] = component
      result.attributes.opacity[i] = Math.log(0.8 / 0.2)
    }
  }
  return result
}

/** Jacobi 对称特征分解求最小特征向量，用于局部平面法线估计。 */
function smallestEigenvector(covariance: number[]): Vector3 {
  const a = covariance.slice(),
    v = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  for (let iteration = 0; iteration < 12; iteration++) {
    let p = 0,
      q = 1
    for (const [i, j] of [
      [0, 2],
      [1, 2],
    ])
      if (Math.abs(a[i * 3 + j]) > Math.abs(a[p * 3 + q])) {
        p = i
        q = j
      }
    if (Math.abs(a[p * 3 + q]) < 1e-14) break
    const angle = 0.5 * Math.atan2(2 * a[p * 3 + q], a[q * 3 + q] - a[p * 3 + p]),
      c = Math.cos(angle),
      s = Math.sin(angle)
    for (let k = 0; k < 3; k++) {
      const x = a[k * 3 + p],
        y = a[k * 3 + q]
      a[k * 3 + p] = c * x - s * y
      a[k * 3 + q] = s * x + c * y
    }
    for (let k = 0; k < 3; k++) {
      const x = a[p * 3 + k],
        y = a[q * 3 + k]
      a[p * 3 + k] = c * x - s * y
      a[q * 3 + k] = s * x + c * y
      const vx = v[k * 3 + p],
        vy = v[k * 3 + q]
      v[k * 3 + p] = c * vx - s * vy
      v[k * 3 + q] = s * vx + c * vy
    }
  }
  const index = [a[0], a[4], a[8]].indexOf(Math.min(a[0], a[4], a[8]))
  return new Vector3(v[index], v[3 + index], v[6 + index]).normalize()
}

export function reconstruct(
  points: PointData,
  gaussian: boolean,
  resolution: number,
  isoLevel: number,
  progress: (value: Progress) => void,
) {
  if (!Number.isInteger(resolution) || resolution < 16 || resolution > 96)
    throw new ModelError('PARAMETER', '重建网格分辨率应在 16 到 96 之间。')
  const count = points.positions.length / 3
  if (count < 4) throw new ModelError('EMPTY', '重建至少需要 4 个点。')
  const bounds = new Box3(),
    p = new Vector3()
  for (let i = 0; i < count; i++) bounds.expandByPoint(p.fromArray(points.positions, i * 3))
  const center = bounds.getCenter(new Vector3()),
    extent = bounds.getSize(new Vector3()),
    side = Math.max(extent.x, extent.y, extent.z) * 1.15
  if (!(side > 0)) throw new ModelError('EMPTY', '点的空间范围为零。')
  const origin = center.clone().addScalar(-side / 2),
    cell = side / (resolution - 1),
    radius = cell * 2.5
  const buckets = new Map<string, number[]>(),
    key = (x: number, y: number, z: number) => `${x},${y},${z}`
  // 重建参与点数设上限，避免高密度扫描耗尽浏览器内存；原始点导出不受影响。
  const step = Math.max(1, Math.ceil(count / 300000)),
    samples: number[] = []
  for (let i = 0; i < count; i += step) {
    samples.push(i)
    p.fromArray(points.positions, i * 3)
      .sub(origin)
      .divideScalar(radius)
    const k = key(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
      bucket = buckets.get(k) ?? []
    bucket.push(i)
    buckets.set(k, bucket)
  }
  function neighbors(position: Vector3): number[] {
    const local = position.clone().sub(origin).divideScalar(radius),
      output: number[] = []
    const x = Math.floor(local.x),
      y = Math.floor(local.y),
      z = Math.floor(local.z)
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          output.push(...(buckets.get(key(x + dx, y + dy, z + dz)) ?? []))
    return output
  }
  const normals = points.normals ?? new Float32Array(count * 3)
  const difference = new Vector3(),
    neighbor = new Vector3()
  if (!gaussian && !points.normals)
    for (let row = 0; row < samples.length; row++) {
      if (row % 5000 === 0)
        progress({ stage: '局部协方差法线估计', fraction: row / samples.length })
      const i = samples[row],
        position = new Vector3().fromArray(points.positions, i * 3)
      const near = neighbors(position)
        .map((id) => ({
          id,
          distance: neighbor.fromArray(points.positions, id * 3).distanceToSquared(position),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 16)
      const mean = new Vector3()
      near.forEach((item) => mean.add(neighbor.fromArray(points.positions, item.id * 3)))
      mean.divideScalar(near.length || 1)
      const covariance = Array(9).fill(0)
      for (const item of near) {
        difference.fromArray(points.positions, item.id * 3).sub(mean)
        for (let a = 0; a < 3; a++)
          for (let b = 0; b < 3; b++)
            covariance[a * 3 + b] += difference.getComponent(a) * difference.getComponent(b)
      }
      const normal = smallestEigenvector(covariance)
      if (normal.dot(position.sub(center)) < 0) normal.negate()
      normals.set(normal.toArray(), i * 3)
    }
  const field = new Float32Array(resolution ** 3)
  field.fill(gaussian ? -isoLevel : radius)
  const index = (x: number, y: number, z: number) => (z * resolution + y) * resolution + x
  if (gaussian) {
    const q = new Quaternion(),
      inverse = new Matrix4()
    for (let row = 0; row < samples.length; row++) {
      if (row % 5000 === 0)
        progress({ stage: '累积各向异性高斯密度场', fraction: row / samples.length })
      const i = samples[row],
        a = points.attributes
      const position = new Vector3().fromArray(points.positions, i * 3)
      const scales = new Vector3(
        ...([0, 1, 2].map((j) => Math.exp(a[`scale_${j}`][i])) as [number, number, number]),
      )
      const support = Math.min(side, Math.max(scales.x, scales.y, scales.z) * 3)
      q.set(a.rot_1[i], a.rot_2[i], a.rot_3[i], a.rot_0[i]).normalize()
      inverse.makeRotationFromQuaternion(q).invert()
      const lo = position.clone().addScalar(-support).sub(origin).divideScalar(cell).floor(),
        hi = position.clone().addScalar(support).sub(origin).divideScalar(cell).ceil()
      const alpha = 1 / (1 + Math.exp(-a.opacity[i]))
      for (let z = Math.max(0, lo.z); z <= Math.min(resolution - 1, hi.z); z++)
        for (let y = Math.max(0, lo.y); y <= Math.min(resolution - 1, hi.y); y++)
          for (let x = Math.max(0, lo.x); x <= Math.min(resolution - 1, hi.x); x++) {
            difference
              .set(x * cell + origin.x, y * cell + origin.y, z * cell + origin.z)
              .sub(position)
              .applyMatrix4(inverse)
              .divide(scales)
            const distance = difference.lengthSq()
            if (distance <= 9) field[index(x, y, z)] += alpha * Math.exp(-distance / 2)
          }
    }
  } else {
    for (let z = 0; z < resolution; z++) {
      progress({ stage: '构建点云有符号距离场', fraction: z / resolution })
      for (let y = 0; y < resolution; y++)
        for (let x = 0; x < resolution; x++) {
          p.set(origin.x + x * cell, origin.y + y * cell, origin.z + z * cell)
          let sum = 0,
            weights = 0
          for (const i of neighbors(p)) {
            difference.copy(p).sub(neighbor.fromArray(points.positions, i * 3))
            const distance = difference.lengthSq()
            if (distance > radius * radius) continue
            const weight = Math.exp(-distance / (cell * cell * 2))
            sum += weight * difference.dot(neighbor.fromArray(normals, i * 3))
            weights += weight
          }
          if (weights > 1e-8) field[index(x, y, z)] = sum / weights
        }
    }
  }
  // 将每个立方体划分为一致的六个四面体，边上线性插值得到等值面。
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ]
  const tetrahedra = [
    [0, 5, 1, 6],
    [0, 1, 2, 6],
    [0, 2, 3, 6],
    [0, 3, 7, 6],
    [0, 7, 4, 6],
    [0, 4, 5, 6],
  ]
  const positions: number[] = []
  for (let z = 0; z < resolution - 1; z++) {
    progress({ stage: '提取等值面（三角网格）', fraction: z / (resolution - 1) })
    for (let y = 0; y < resolution - 1; y++)
      for (let x = 0; x < resolution - 1; x++) {
        const values = corners.map(([dx, dy, dz]) => field[index(x + dx, y + dy, z + dz)])
        const vertices = corners.map(
          ([dx, dy, dz]) =>
            new Vector3(
              (x + dx) * cell + origin.x,
              (y + dy) * cell + origin.y,
              (z + dz) * cell + origin.z,
            ),
        )
        const interpolate = (a: number, b: number) =>
          vertices[a].clone().lerp(vertices[b], values[a] / (values[a] - values[b]))
        for (const tetra of tetrahedra) {
          const inside = tetra.filter((i) => values[i] < 0),
            outside = tetra.filter((i) => values[i] >= 0)
          if (!inside.length || !outside.length) continue
          const triangles: Vector3[][] = []
          if (inside.length === 1) triangles.push(outside.map((i) => interpolate(inside[0], i)))
          else if (outside.length === 1)
            triangles.push(inside.map((i) => interpolate(outside[0], i)).reverse())
          else {
            const [a, b] = inside,
              [c, d] = outside,
              ac = interpolate(a, c),
              ad = interpolate(a, d),
              bc = interpolate(b, c),
              bd = interpolate(b, d)
            triangles.push([ac, bc, ad], [ad, bc, bd])
          }
          for (const triangle of triangles) {
            const direction = vertices[outside[0]].clone().sub(vertices[inside[0]])
            const normal = triangle[1]
              .clone()
              .sub(triangle[0])
              .cross(triangle[2].clone().sub(triangle[0]))
            if (normal.dot(direction) * (gaussian ? -1 : 1) < 0) triangle.reverse()
            positions.push(...triangle.flatMap((point) => point.toArray()))
          }
          if (positions.length > 18000000)
            throw new ModelError('SIZE', '等值面超过 200 万个三角形，请降低重建分辨率。')
        }
      }
  }
  if (!positions.length)
    throw new ModelError(
      'RECONSTRUCTION',
      '当前参数未生成等值面。请调整分辨率或密度阈值，并检查采样分布。',
    )
  return { positions: new Float64Array(positions), usedPoints: samples.length, gridCell: cell }
}
