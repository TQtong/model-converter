import { useEffect, useRef } from 'react'
import { Check, X } from 'lucide-react'
import { formatAdapters } from '../adapters/registry'

export function HelpDialog({ mode, close }: { mode: 'formats' | 'help'; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="modal wide" onCancel={close} onClick={event => { if (event.target === dialog.current) close() }}><button className="modal-close" aria-label="关闭" onClick={close}><X size={20} /></button><p className="eyebrow">MODEL CONVERTER</p><h2>{mode === 'formats' ? '格式能力与边界' : '从文件到你需要的格式'}</h2>{mode === 'formats' ? <><p>输入与输出能力分别登记。可用目标随模型类型变化；实验路线存在近似或属性降级。</p><div className="format-table"><table><thead><tr><th>格式</th><th>导入</th><th>导出</th><th>说明</th></tr></thead><tbody>{formatAdapters.filter(adapter => !['b3dm', 'pnts'].includes(adapter.id)).map(adapter => <tr key={adapter.id}><th>{adapter.label}</th><td>{adapter.import ? <Check size={14} /> : '—'}</td><td>{adapter.export ? adapter.id === 'fbx' ? '实验性' : <Check size={14} /> : '—'}</td><td>{adapter.limitations}</td></tr>)}</tbody></table></div><p>OSGB、完整 CAD/BIM 原生回写、隐式瓦片和照片训练不属于首版能力。</p></> : <div className="help-content"><ol><li><strong>导入完整资源</strong><p>可以选择多个文件、文件夹或 ZIP。glTF、OBJ 应包含缓冲、材质及贴图，保留原目录。</p></li><li><strong>预览并选择目标</strong><p>检查单位、方向与对象信息；未声明单位的文件需要确认源单位。glTF 场景通道统一使用米。</p></li><li><strong>转换与下载</strong><p>一次运行一个任务，可随时取消、重试。多文件会打包 ZIP；单文件可直接下载，也可下载含报告与属性的完整包。</p></li></ol><p>CAD 默认线性偏差为 0.1 mm，设置在导入前生效。实验重建默认分辨率 32³，最多使用 30 万个点；凹面、稀疏或噪声数据可能产生错误表面。</p><p>单任务及 ZIP 解压后均不超过 1 GiB。256 MiB 以上可能占用较多内存。模型不持久化，刷新后需重新导入。</p><p>缺少资源时请将完整文件重新导入。网站会阻止模型中的外部资源地址，不会自动访问模型引用的远程文件。</p></div>}</dialog>
}
