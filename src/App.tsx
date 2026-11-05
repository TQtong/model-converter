import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  CheckCircle2,
  CircleHelp,
  FileBox,
  FileJson,
  Files,
  FolderOpen,
  Globe2,
  HardDrive,
  Layers,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Preview } from './components/Preview'
import { SettingsPanel } from './components/SettingsPanel'
import { Inspector } from './components/Inspector'
import { HelpDialog } from './components/HelpDialog'
import { findCandidates } from './adapters/registry'
import { collectFiles, filesFromDrop, stem } from './core/files'
import { downloadBlob, packageResult, releaseDownloads } from './core/download'
import { jsonBytes } from './core/convert'
import { useTasks } from './hooks/useTasks'
import type { SourceFile } from './core/types'
import './App.css'

const statusLabels = {
  queued: '排队中',
  reading: '正在读取',
  ready: '待转换',
  converting: '转换中',
  success: '已完成',
  error: '失败',
  cancelled: '已取消',
}
const formatSize = (size: number) =>
  size >= 1024 ** 3
    ? `${(size / 1024 ** 3).toFixed(2)} GiB`
    : size >= 1024 ** 2
      ? `${(size / 1024 ** 2).toFixed(1)} MiB`
      : `${Math.max(1, Math.round(size / 1024))} KiB`

function App() {
  const queue = useTasks()
  const [selected, setSelected] = useState(''),
    [importing, setImporting] = useState(false),
    [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState(''),
    [modal, setModal] = useState<'formats' | 'help'>(),
    [cadTolerance, setCadTolerance] = useState(0.1)
  const [batch, setBatch] = useState<{ files: SourceFile[]; candidates: SourceFile[] }>(),
    [chosen, setChosen] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    importController = useRef<AbortController | undefined>(undefined),
    candidateDialog = useRef<HTMLDialogElement>(null)
  const task = queue.tasks.find((task) => task.id === selected) ?? queue.tasks[0]
  useEffect(
    () => () => {
      importController.current?.abort()
      releaseDownloads()
    },
    [],
  )
  useEffect(() => {
    if (batch) candidateDialog.current?.showModal()
  }, [batch])
  async function importFiles(input: File[]) {
    if (!input.length || importing) return
    const controller = new AbortController()
    importController.current = controller
    setImporting(true)
    setNotice('')
    try {
      if (!Number.isFinite(cadTolerance) || cadTolerance < 0.00001 || cadTolerance > 100)
        throw new Error('CAD 偏差应在 0.00001 至 100 mm 之间。')
      const files = await collectFiles(input, controller.signal),
        candidates = await findCandidates(files)
      if (!candidates.length)
        throw new Error('未检测到已接入的主模型。请检查格式，或将模型与配套文件一起导入。')
      if (candidates.length === 1) setSelected(queue.add(candidates, files, { cadTolerance }))
      else {
        setBatch({ files, candidates })
        setChosen(new Set([candidates[0].path]))
      }
    } catch (error) {
      if (!controller.signal.aborted) setNotice((error as Error).message)
    } finally {
      setImporting(false)
      importController.current = undefined
    }
  }
  async function download(bundle: boolean) {
    if (!task?.result || downloading) return
    setDownloading(true)
    try {
      const { files, report, metadataFile } = task.result
      if (bundle || files.length > 1)
        downloadBlob(
          await packageResult(files, report, metadataFile),
          `${stem(task.source.path)}_${report.target}.zip`,
        )
      else
        downloadBlob(
          new Blob([new Uint8Array(files[0].data)], {
            type: files[0].mime ?? 'application/octet-stream',
          }),
          files[0].name,
        )
    } catch (error) {
      setNotice(`下载打包失败：${(error as Error).message}`)
    } finally {
      setDownloading(false)
    }
  }
  function demo() {
    // 自行生成的 CC0 示例，不依赖远程模型或贴图。
    const obj =
      '# Model Converter CC0 demo\nmtllib demo.mtl\no 示例立方体\nv -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1\nusemtl Mint\nf 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 4 8 7 3\nf 1 5 8 4\nf 2 3 7 6\n'
    void importFiles([
      new File([obj], 'demo.obj'),
      new File(['newmtl Mint\nKd 0.35 0.72 0.63\nNs 100'], 'demo.mtl'),
    ])
  }
  return (
    <div
      className="app-shell"
      onDragOver={(event) => {
        event.preventDefault()
        if (event.dataTransfer.types.includes('Files')) setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        void filesFromDrop(event.dataTransfer)
          .then(importFiles)
          .catch((error) => setNotice(error.message))
      }}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          void importFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        {...{ webkitdirectory: '' }}
        onChange={(event) => {
          void importFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      <header className="topbar">
        <a className="brand" href="./">
          <span className="brand-symbol">
            <Box size={23} strokeWidth={1.6} />
          </span>
          <span>
            Model<span className="brand-light">Converter</span>
            <small>三维模型转换器</small>
          </span>
        </a>
        <nav>
          <span className="nav-active">转换工作台</span>
          <button onClick={() => setModal('formats')}>格式支持</button>
          <button onClick={() => setModal('help')}>
            使用说明 <CircleHelp size={14} />
          </button>
        </nav>
        <span className="local-badge">
          <span /> 浏览器本地处理
        </span>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <p className="eyebrow">A BETTER WAY TO CONVERT</p>
            <h1>
              一个工作台，连接多种三维格式<span>。</span>
            </h1>
            <p>导入、预览、转换。让你的三维数据，自由流转。</p>
          </div>
          <div className="heading-note">
            <ShieldCheck size={19} />
            <span>
              文件始终留在你的设备上<small>无需注册 · 免费使用 · 无转换后端</small>
            </span>
          </div>
        </div>
        {notice && (
          <div className="alert" role="alert">
            <CircleHelp size={17} />
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice('')}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="workbench">
          <aside className="input-panel panel">
            <div className="panel-title">
              <span>
                <Files size={17} /> 输入文件
              </span>
              <span className="step-number">01</span>
            </div>
            <button
              className="dropzone"
              onClick={() => fileInput.current?.click()}
              disabled={importing}
            >
              <span className="upload-symbol">
                {importing ? <LoaderCircle className="spin" size={27} /> : <Upload size={27} />}
              </span>
              <strong>{importing ? '正在整理本地文件…' : '拖放模型文件到这里'}</strong>
              <span>模型、贴图，或者整个 ZIP</span>
              <span className="upload-link">
                选择文件 <Plus size={14} />
              </span>
            </button>
            <div className="import-actions">
              <button onClick={() => folderInput.current?.click()} disabled={importing}>
                <FolderOpen size={14} /> 导入文件夹
              </button>
              <button onClick={demo} disabled={importing}>
                <Sparkles size={14} /> 体验示例
              </button>
            </div>
            {importing && (
              <button className="text-button" onClick={() => importController.current?.abort()}>
                取消导入
              </button>
            )}
            <div className="file-hint">
              支持网格、CAD / BIM、点云与高斯等类型。
              <button onClick={() => setModal('formats')}>
                查看格式能力 <ArrowRight size={11} />
              </button>
            </div>
            <details className="import-options">
              <summary>CAD 导入精度</summary>
              <label htmlFor="cad-tolerance">线性偏差（mm）</label>
              <input
                id="cad-tolerance"
                type="number"
                min={0.00001}
                max={100}
                step={0.01}
                value={cadTolerance}
                onChange={(event) => setCadTolerance(Number(event.target.value))}
              />
              <small>在下一次导入时生效，越小越精细。</small>
            </details>
            <div className="queue-heading">
              <h2>
                任务队列 <span>{queue.tasks.length}</span>
              </h2>
              <span>单任务运行</span>
            </div>
            <div className="task-list">
              {queue.tasks.length === 0 ? (
                <div className="queue-empty">
                  <FileBox size={26} />
                  <p>你的模型旅程从这里开始</p>
                  <span>导入文件后，任务将显示在这里</span>
                </div>
              ) : (
                queue.tasks.map((item) => (
                  <div
                    key={item.id}
                    className={`task-item ${task?.id === item.id ? 'selected' : ''}`}
                  >
                    <button className="task-select" onClick={() => setSelected(item.id)}>
                      <span className={`file-icon ${item.status}`}>
                        {['reading', 'converting'].includes(item.status) ? (
                          <LoaderCircle className="spin" size={19} />
                        ) : item.status === 'success' ? (
                          <CheckCircle2 size={19} />
                        ) : (
                          <FileBox size={19} />
                        )}
                      </span>
                      <span>
                        <strong title={item.source.path}>
                          {item.source.path.split('/').pop()}
                        </strong>
                        <small>
                          {formatSize(item.source.file.size)}
                          <i />
                          {statusLabels[item.status]}
                        </small>
                      </span>
                    </button>
                    <button
                      className="remove-task"
                      aria-label={`移除 ${item.source.path}`}
                      onClick={() => {
                        if (item.id === task?.id) setSelected('')
                        queue.remove(item.id)
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
            {queue.tasks.length > 0 && (
              <button
                className="clear-tasks text-button"
                onClick={() => {
                  queue.tasks.forEach((task) => queue.remove(task.id))
                  setSelected('')
                }}
              >
                <Trash2 size={12} /> 清空任务
              </button>
            )}
            <div className="storage-note">
              <HardDrive size={14} />
              <span>
                单任务上限 1 GiB<small>刷新页面后需重新导入文件</small>
              </span>
            </div>
          </aside>
          <div className="center-panel">
            <Preview model={task?.model} />
            <Inspector key={task?.id ?? 'empty'} model={task?.model} />
          </div>
          <SettingsPanel
            task={task}
            downloading={downloading}
            update={(options) => task && queue.setOptions(task.id, options)}
            convert={() => task && queue.convert(task.id)}
            cancel={() => task && queue.cancel(task.id)}
            retry={() => task && queue.retry(task.id)}
            download={(bundle) => void download(bundle)}
          />
        </div>
        {task?.result && (
          <section className="report panel">
            <div>
              <FileJson size={18} />
              <strong>转换报告</strong>
              <span>
                {task.result.report.durationMs / 1000} 秒 ·{' '}
                {task.result.report.target.toUpperCase()}
              </span>
              <button
                onClick={() =>
                  downloadBlob(
                    new Blob([jsonBytes(task.result!.report)], { type: 'application/json' }),
                    'conversion-report.json',
                  )
                }
              >
                <ArrowDownToLine size={14} /> 下载报告
              </button>
            </div>
            {task.result.report.warnings.length ? (
              <ul>
                {task.result.report.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p>已完成格式转换。请回读核对目标模型，成功不代表所有数据无损。</p>
            )}
            <p>关联工程属性存放在完整包的 metadata.json 中，不代表目标格式原生保留全部工程语义。</p>
          </section>
        )}
        <div className="trust-strip">
          <span>
            <LockKeyhole size={17} />
            <strong>本地处理</strong>
            <small>模型文件不上传</small>
          </span>
          <span>
            <Globe2 size={17} />
            <strong>开放使用</strong>
            <small>免费，无需登录</small>
          </span>
          <span>
            <Layers size={17} />
            <strong>多种数据类型</strong>
            <small>网格 · 工程 · 点云 · 高斯</small>
          </span>
          <span>
            <FileJson size={17} />
            <strong>清楚每一次变化</strong>
            <small>附带转换报告</small>
          </span>
        </div>
      </main>
      <footer>
        <span>
          <Box size={14} /> Model Converter <i /> 为三维数据的自由流动而构建
        </span>
        <span>
          纯浏览器运行 <i />{' '}
          <a
            href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`}
            target="_blank"
            rel="noreferrer"
          >
            第三方许可
          </a>
          <i /> MIT License
        </span>
      </footer>
      {dragging && (
        <div className="drag-overlay">
          <Upload size={48} />
          <h2>释放文件，开始新的转换</h2>
          <p>目录结构与配套资源将一同保留</p>
        </div>
      )}
      {batch && (
        <dialog ref={candidateDialog} className="modal" onCancel={() => setBatch(undefined)}>
          <button className="modal-close" aria-label="关闭" onClick={() => setBatch(undefined)}>
            <X size={20} />
          </button>
          <p className="eyebrow">SELECT MAIN FILES</p>
          <h2>检测到多个主模型</h2>
          <p>选择要转换的文件，其他文件作为配套资源保留。瓦片集通常只需选择 tileset.json。</p>
          <div className="candidate-list">
            {batch.candidates.map((file) => (
              <label key={file.path}>
                <input
                  type="checkbox"
                  checked={chosen.has(file.path)}
                  onChange={(event) => {
                    const next = new Set(chosen)
                    if (event.target.checked) next.add(file.path)
                    else next.delete(file.path)
                    setChosen(next)
                  }}
                />
                <FileBox size={18} />
                <span>
                  {file.path}
                  <small>{formatSize(file.file.size)}</small>
                </span>
              </label>
            ))}
          </div>
          <button
            className="primary-button"
            disabled={!chosen.size}
            onClick={() => {
              setSelected(
                queue.add(
                  batch.candidates.filter((file) => chosen.has(file.path)),
                  batch.files,
                  { cadTolerance },
                ),
              )
              setBatch(undefined)
            }}
          >
            加入 {chosen.size} 个任务 <ArrowRight size={16} />
          </button>
        </dialog>
      )}
      {modal && <HelpDialog mode={modal} close={() => setModal(undefined)} />}
    </div>
  )
}
export default App
