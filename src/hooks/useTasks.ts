import { useEffect, useRef, useState } from 'react'
import { convertModel, loadModel } from '../core/convert'
import { disposeModel } from '../core/scene'
import { defaultOptions, type ConversionOptions, type ModelDocument, type Progress, type SourceFile } from '../core/types'
import { routesFor } from '../adapters/registry'

export type TaskStatus = 'queued' | 'reading' | 'ready' | 'converting' | 'success' | 'error' | 'cancelled'
export interface Task {
  id: string
  source: SourceFile
  files: SourceFile[]
  status: TaskStatus
  options: ConversionOptions
  progress: Progress
  model?: ModelDocument
  result?: Awaited<ReturnType<typeof convertModel>>
  error?: string
  lastOperation: 'read' | 'convert'
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const tasksRef = useRef<Task[]>([])
  const pending = useRef<{ id: string; operation: 'read' | 'convert' }[]>([])
  const active = useRef<{ id: string; controller: AbortController } | undefined>(undefined)
  const mounted = useRef(true)
  const update = (id: string, patch: Partial<Task>) => {
    tasksRef.current = tasksRef.current.map(task => task.id === id ? { ...task, ...patch } : task)
    if (mounted.current) setTasks([...tasksRef.current])
  }
  async function pump() {
    if (active.current || !mounted.current) return
    const job = pending.current.shift()
    if (!job) return
    const task = tasksRef.current.find(task => task.id === job.id)
    if (!task) { void pump(); return }
    const controller = new AbortController()
    active.current = { id: task.id, controller }
    update(task.id, { status: job.operation === 'read' ? 'reading' : 'converting', error: undefined, lastOperation: job.operation })
    try {
      const context = { files: task.files, signal: controller.signal, options: { ...task.options }, progress: (progress: Progress) => { if (!controller.signal.aborted) update(task.id, { progress }) } }
      if (job.operation === 'read') {
        const model = await loadModel(task.source, context)
        if (controller.signal.aborted) { disposeModel(model); controller.signal.throwIfAborted() }
        const routes = routesFor(model), target = routes.find(route => route.id === (model.kind === 'scene' ? 'glb' : 'ply'))?.id ?? routes[0]?.id ?? ''
        update(task.id, { model, status: 'ready', options: { ...task.options, target }, progress: { stage: '模型已就绪' } })
      } else {
        const result = await convertModel(task.model!, context)
        controller.signal.throwIfAborted()
        update(task.id, { result, status: 'success', progress: { stage: '转换完成', fraction: 1 } })
      }
    } catch (error) {
      update(task.id, { status: controller.signal.aborted ? 'cancelled' : 'error', error: controller.signal.aborted ? undefined : (error as Error).message, progress: { stage: controller.signal.aborted ? '任务已取消' : '处理失败' } })
    } finally { active.current = undefined; void pump() }
  }
  function add(sources: SourceFile[], files: SourceFile[]) {
    const additions = sources.map(source => ({ id: crypto.randomUUID(), source, files, status: 'queued' as const, options: { ...defaultOptions }, progress: { stage: '等待本机任务队列' }, lastOperation: 'read' as const }))
    tasksRef.current.push(...additions); setTasks([...tasksRef.current])
    pending.current.push(...additions.map(task => ({ id: task.id, operation: 'read' as const })))
    void pump()
    return additions[0]?.id
  }
  function convert(id: string) {
    const task = tasksRef.current.find(task => task.id === id)
    if (!task?.model || active.current?.id === id || pending.current.some(job => job.id === id)) return
    pending.current.push({ id, operation: 'convert' })
    update(id, { status: 'queued', lastOperation: 'convert', result: undefined, progress: { stage: '等待本机任务队列' } }); void pump()
  }
  function cancel(id: string) {
    pending.current = pending.current.filter(job => job.id !== id)
    if (active.current?.id === id) active.current.controller.abort()
    else update(id, { status: 'cancelled', progress: { stage: '任务已取消' } })
  }
  function retry(id: string) {
    const task = tasksRef.current.find(task => task.id === id)
    if (!task || active.current?.id === id) return
    if (task.model && task.lastOperation === 'convert') convert(id)
    else { pending.current.push({ id, operation: 'read' }); update(id, { status: 'queued', error: undefined }); void pump() }
  }
  function remove(id: string) {
    cancel(id)
    const task = tasksRef.current.find(task => task.id === id)
    disposeModel(task?.model)
    tasksRef.current = tasksRef.current.filter(task => task.id !== id); setTasks([...tasksRef.current])
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false; active.current?.controller.abort(); pending.current = []
      tasksRef.current.forEach(task => disposeModel(task.model))
    }
  }, [])
  return { tasks, add, convert, cancel, retry, remove, setOptions: (id: string, options: Partial<ConversionOptions>) => {
    const task = tasksRef.current.find(task => task.id === id)
    if (task && !['queued', 'reading', 'converting'].includes(task.status)) update(id, { options: { ...task.options, ...options } })
  } }
}
