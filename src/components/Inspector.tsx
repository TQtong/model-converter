import { useMemo, useState } from 'react'
import { Box, ChevronDown, ChevronRight, FileBox, Layers } from 'lucide-react'
import { Vector3, type Object3D } from 'three'
import { modelBounds, modelStatistics } from '../core/scene'
import type { ModelDocument } from '../core/types'

const labels: Record<string, string> = {
  vertices: '顶点',
  triangles: '三角面',
  points: '点',
  objects: '对象',
  materials: '材质',
  animations: '动画',
  tiles: '瓦片',
  attributes: '属性',
}
function ObjectNode({
  object,
  onSelect,
  depth = 0,
}: {
  object: Object3D
  onSelect: (object: Object3D) => void
  depth?: number
}) {
  const [open, setOpen] = useState(depth < 1)
  return (
    <div>
      <div className="object-row" style={{ paddingLeft: depth * 12 + 8 }}>
        <button
          aria-label={`${open ? '收起' : '展开'}${object.name || object.type}`}
          disabled={!object.children.length}
          onClick={() => setOpen(!open)}
        >
          {object.children.length ? (
            open ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : (
            <span className="tree-dot" />
          )}
        </button>
        <button onClick={() => onSelect(object)}>
          <Box size={13} />
          <span>{object.name || object.type}</span>
        </button>
      </div>
      {open &&
        object.children
          .slice(0, 250)
          .map((child) => (
            <ObjectNode key={child.uuid} object={child} depth={depth + 1} onSelect={onSelect} />
          ))}
      {open && object.children.length > 250 && (
        <small>其余 {object.children.length - 250} 个对象保留于导出数据</small>
      )}
    </div>
  )
}
export function Inspector({ model }: { model?: ModelDocument }) {
  const [tab, setTab] = useState('info'),
    [object, setObject] = useState<Object3D>()
  const stats = useMemo(() => (model ? modelStatistics(model) : {}), [model])
  const size = useMemo(
    () => (model ? modelBounds(model).getSize(new Vector3()) : undefined),
    [model],
  )
  return (
    <section className="model-inspector panel">
      <div className="inspector-tabs" role="tablist" aria-label="模型信息">
        {[
          ['info', '模型信息'],
          ['objects', '对象层级'],
          ['properties', '工程属性'],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
            {key === 'objects' && stats.objects ? <span>{stats.objects}</span> : null}
          </button>
        ))}
        <span>{model?.metadata.format.toUpperCase() ?? '等待导入'}</span>
      </div>
      <div className="inspector-body">
        {!model ? (
          <div className="inspector-empty">
            <Layers size={18} />
            导入模型后，查看几何规模、层级和属性。
          </div>
        ) : tab === 'info' ? (
          <>
            <div className="stats">
              {Object.entries(stats)
                .filter(([, value]) => value > 0)
                .slice(0, 4)
                .map(([key, value]) => (
                  <div key={key}>
                    <span>{labels[key] ?? key}</span>
                    <strong>{Math.round(value).toLocaleString()}</strong>
                  </div>
                ))}
            </div>
            <div className="model-details">
              <span>
                源单位 <b>{model.metadata.unit === 'unknown' ? '未声明' : model.metadata.unit}</b>
              </span>
              <span>
                向上轴 <b>{model.metadata.upAxis}</b>
              </span>
              <span>
                包围盒{' '}
                <b>
                  {size
                    ?.toArray()
                    .map((n) => n.toFixed(3))
                    .join(' × ')}
                </b>
              </span>
            </div>
            {model.metadata.warnings.length > 0 && (
              <p className="source-warning">{model.metadata.warnings.join(' ')}</p>
            )}
          </>
        ) : tab === 'objects' ? (
          model.scene ? (
            <ObjectNode
              object={model.scene.root}
              onSelect={(item) => {
                setObject(item)
                setTab('properties')
              }}
            />
          ) : model.tiles ? (
            <div className="tile-list">
              {model.tiles.map((tile) => (
                <div key={tile.name}>
                  <FileBox size={14} />
                  {tile.name}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">
              此数据是{model.kind === 'gaussian' ? '高斯集合' : '点云'}，不包含网格对象层级。
            </p>
          )
        ) : (
          <div className="properties">
            <div>
              <strong>{object ? object.name || object.type : '源模型元信息'}</strong>
              {object && <button onClick={() => setObject(undefined)}>查看模型属性</button>}
            </div>
            <pre>
              {JSON.stringify(
                object ? object.userData : model.metadata.properties,
                (_key, entry) =>
                  ArrayBuffer.isView(entry)
                    ? `[${entry.constructor.name}，${entry.byteLength} 字节；完整数据保留于完整包]`
                    : entry,
                2,
              ).slice(0, 20000)}
            </pre>
          </div>
        )}
      </div>
    </section>
  )
}
