import type { ContentKind, FormatAdapter, ModelDocument, SourceFile } from '../core/types'
import { extension } from '../core/files'
import { readMesh } from './mesh'
import { readPoints } from './points'
import { readCad, readIfc } from './cad'
import { readDotBim } from './dotbim'
import { readRhino } from './rhino'
import { readFcstd } from './fcstd'
import { readTileContent, readTiles } from './tiles'

const adapters = new Map<string, FormatAdapter>()
export function registerAdapter(adapter: FormatAdapter) {
  if (adapters.has(adapter.id)) throw new Error(`重复适配器：${adapter.id}`)
  adapters.set(adapter.id, adapter)
}
for (const id of [
  'obj',
  'fbx',
  'glb',
  'gltf',
  'stl',
  'ply',
  'off',
  '3ds',
  'dae',
  '3mf',
  'amf',
  'wrl',
])
  registerAdapter({
    id,
    label: id.toUpperCase(),
    extensions: [id],
    kind: id === 'ply' ? ['scene', 'pointcloud', 'gaussian'] : ['scene'],
    import: true,
    export: ['obj', 'fbx', 'glb', 'gltf', 'stl', 'ply', 'off'].includes(id),
    experimental: id === 'fbx',
    limitations:
      id === 'fbx'
        ? '导出为实验性，生成后需回读验证。'
        : ['glb', 'gltf'].includes(id)
          ? '支持场景、材质、蒙皮和关键帧动画；特定扩展依赖读取器支持。'
          : '静态路线；不同格式对材质、层级、动画支持不同。',
    read: readMesh,
  })
for (const id of ['xyz', 'pcd', 'las', 'laz', 'splat', 'spz'])
  registerAdapter({
    id,
    label: id.toUpperCase(),
    extensions: [id],
    kind: ['splat', 'spz'].includes(id) ? ['gaussian'] : ['pointcloud'],
    import: true,
    export: ['xyz', 'pcd', 'splat'].includes(id),
    limitations: ['las', 'laz'].includes(id)
      ? 'LAS 1.0–1.3，点记录 0–3；不支持 LAS 1.4 和波形。'
      : id === 'spz'
        ? 'Spark 扩展精度解码，提取已解码的高斯属性与最高三阶球谐。'
        : '属性按目标字段能力保存，详见报告。',
    read: readPoints,
  })
registerAdapter({
  id: 'cad',
  label: 'STEP / IGES / BREP',
  extensions: ['step', 'stp', 'iges', 'igs', 'brep', 'brp'],
  kind: ['scene'],
  import: true,
  export: false,
  limitations: '仅导入与曲面离散化，不提供原生 CAD 输出。',
  read: readCad,
})
registerAdapter({
  id: 'ifc',
  label: 'IFC',
  extensions: ['ifc'],
  kind: ['scene'],
  import: true,
  export: false,
  limitations: '构件几何与可提取属性，不提供 IFC 回写。',
  read: readIfc,
})
registerAdapter({
  id: 'bim',
  label: 'DotBIM',
  extensions: ['bim'],
  kind: ['scene'],
  import: true,
  export: false,
  limitations: '轻量 BIM，属性单独保存。',
  read: readDotBim,
})
registerAdapter({
  id: 'fcstd',
  label: 'FreeCAD',
  extensions: ['fcstd'],
  kind: ['scene'],
  import: true,
  export: false,
  limitations: '读取已保存 BREP，不重新计算历史或执行宏。',
  read: readFcstd,
})
registerAdapter({
  id: '3dm',
  label: 'Rhino 3DM',
  extensions: ['3dm'],
  kind: ['scene'],
  import: true,
  export: true,
  limitations: '读取渲染网格；输出为网格对象，工程属性附带保存。',
  read: readRhino,
})
registerAdapter({
  id: 'tiles',
  label: '3D Tiles',
  extensions: ['json'],
  kind: ['tiles'],
  import: true,
  export: true,
  limitations: '显式层级 GLB/B3DM/PNTS；不支持隐式瓦片和完整 LOD 生成。',
  read: readTiles,
})
for (const id of ['b3dm', 'pnts'])
  registerAdapter({
    id,
    label: id.toUpperCase(),
    extensions: [id],
    kind: id === 'pnts' ? ['pointcloud'] : ['scene'],
    import: true,
    export: false,
    limitations: '3D Tiles 1.0 内容，读取瓦片自身定位。',
    read: readTileContent,
  })

export const formatAdapters = [...adapters.values()]
export function findAdapter(path: string): FormatAdapter | undefined {
  return formatAdapters.find((adapter) => adapter.extensions.includes(extension(path)))
}

/** JSON 需要检查内容，避免将 metadata.json 或任意配置文件当成主模型。 */
export async function findCandidates(files: SourceFile[]): Promise<SourceFile[]> {
  const candidates: SourceFile[] = []
  for (const file of files) {
    if (!findAdapter(file.path)?.import) continue
    if (extension(file.path) === 'json') {
      if (file.file.size > 16 * 1024 ** 2) continue
      try {
        const data = JSON.parse(await file.file.text())
        if (!data.asset || !data.root) continue
      } catch {
        continue
      }
    }
    candidates.push(file)
  }
  // 资源集合中存在 tileset 时优先列出组织入口；内容仍可以被用户单独选中。
  return candidates.sort(
    (a, b) =>
      Number(extension(b.path) === 'json') - Number(extension(a.path) === 'json') ||
      a.path.localeCompare(b.path, 'zh-CN'),
  )
}

export interface TargetRoute {
  id: string
  label: string
  kind: ContentKind
  experimental: boolean
  description: string
}
const meshTargets = [
  ['glb', 'GLB', '单文件场景；保留 PBR 材质、贴图、层级与支持的动画。'],
  ['gltf', 'glTF', 'JSON 场景，缓冲与图片内嵌；保留支持的动画。'],
  ['obj', 'OBJ + MTL', '静态网格、法线、UV、基础材质与贴图；动画和 PBR 降级。'],
  ['stl', 'STL', '三角面几何；无材质、贴图、层级或动画。'],
  ['ply', 'PLY 网格', '静态顶点、法线、UV、颜色及三角面；无外部贴图或动画。'],
  ['off', 'OFF', '静态顶点与三角面；材质、贴图和动画不保留。'],
  ['3dm', 'Rhino 3DM', '离散网格对象与名称；工程属性附带保存。'],
  ['fbx', 'FBX', '实验性 Assimp 导出；完成后以 FBX 读取器验证几何与动画。'],
  ['tiles', '3D Tiles', '以单级 tileset + GLB 封装网格，写入包围体；不生成 LOD 金字塔。'],
]
export function routesFor(model: ModelDocument): TargetRoute[] {
  if (model.kind === 'tiles') {
    const children = model.tiles ?? []
    const intersection = children[0]
      ? routesFor(children[0].model).filter((route) =>
          children.every((child) => routesFor(child.model).some((other) => other.id === route.id)),
        )
      : []
    return intersection
      .filter((route) => !route.experimental && route.id !== 'tiles')
      .map((route) => ({
        ...route,
        description: `按 ${children.length} 个内容块分别输出。${route.description}`,
      }))
  }
  const routes: TargetRoute[] = []
  if (model.kind === 'scene')
    routes.push(
      ...meshTargets.map(([id, label, description]) => ({
        id,
        label,
        description,
        kind: 'scene' as const,
        experimental: id === 'fbx',
      })),
    )
  if (model.kind === 'pointcloud' || model.kind === 'gaussian')
    routes.push(
      ...[
        ['ply', 'PLY 点云'],
        ['pcd', 'PCD'],
        ['xyz', 'XYZ'],
      ].map(([id, label]) => ({
        id: model.kind === 'gaussian' && id === 'ply' ? 'point-ply' : id,
        label,
        kind: 'pointcloud' as const,
        experimental: model.kind === 'gaussian',
        description:
          model.kind === 'gaussian'
            ? '提取高斯中心与基础颜色，普通点云不能表达高斯形状、透明度和球谐。'
            : '保留原始坐标，按目标能力写入颜色、法线及附加字段。',
      })),
    )
  if (model.kind === 'gaussian')
    routes.push(
      ...[
        { id: 'ply', label: '标准高斯 PLY' },
        { id: 'splat', label: 'SPLAT' },
      ].map((route) => ({
        ...route,
        kind: 'gaussian' as const,
        experimental: false,
        description:
          route.id === 'ply'
            ? '保留已读取的高斯原始标量属性，包含 PLY 中的高阶球谐。'
            : '32 字节记录，坐标/尺度为 float32；颜色、透明度和旋转量化，高阶球谐不保留。',
      })),
    )
  if (model.kind === 'scene')
    routes.push(
      {
        id: 'point-ply',
        label: '表面采样 → 点云 PLY',
        kind: 'pointcloud',
        experimental: true,
        description: '按三角面面积采样，连续表面变成离散点集。',
      },
      {
        id: 'gaussian-ply',
        label: '表面采样 → 高斯 PLY',
        kind: 'gaussian',
        experimental: true,
        description: '面积采样并估计沿表面的尺度方向，生成基础颜色；不恢复真实光照和视角相关外观。',
      },
    )
  if (model.kind !== 'scene')
    routes.push(
      ...meshTargets
        .filter(([id]) => !['fbx', 'tiles'].includes(id))
        .map(([id, label]) => ({
          id,
          label: `近似重建 → ${label}`,
          kind: 'scene' as const,
          experimental: true,
          description:
            model.kind === 'gaussian'
              ? '各向异性高斯密度场等值面；得到近似密度外壳，不保证为真实表面。'
              : '局部法线估计、有符号距离场、等值面；稀疏、遮挡、凹面和噪声可能产生错误表面。',
        })),
    )
  return routes
}
