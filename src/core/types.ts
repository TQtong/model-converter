import type { Object3D, AnimationClip } from 'three'

export type ContentKind = 'scene' | 'pointcloud' | 'gaussian' | 'tiles'
export type Unit = 'original' | 'm' | 'cm' | 'mm' | 'in' | 'ft'
export interface SourceFile { path: string; file: File }
export interface ModelMetadata {
  source: string
  format: string
  unit: string
  upAxis: 'Y' | 'Z'
  properties: Record<string, unknown>
  warnings: string[]
}
/** 点云和高斯保留双精度原始坐标；预览的局部化不影响导出。 */
export interface PointData {
  positions: Float64Array
  colors?: Float32Array
  normals?: Float32Array
  attributes: Record<string, Float64Array>
}
export interface SceneData { root: Object3D; animations: AnimationClip[] }
export interface ModelDocument {
  kind: ContentKind
  name: string
  metadata: ModelMetadata
  scene?: SceneData
  points?: PointData
  tiles?: { name: string; model: ModelDocument }[]
}
export interface ConversionOptions {
  target: string
  unit: Unit
  sourceUnit: Exclude<Unit, 'original'>
  upAxis: 'original' | 'Y' | 'Z'
  binary: boolean
  samples: number
  resolution: number
  isoLevel: number
  cadTolerance: number
}
export const defaultOptions: ConversionOptions = {
  target: 'glb', unit: 'original', sourceUnit: 'm', upAxis: 'original',
  binary: true, samples: 50000, resolution: 32, isoLevel: 0.25, cadTolerance: 0.1,
}
export interface OutputFile { name: string; data: Uint8Array; mime?: string }
export interface ConversionReport {
  version: 1
  source: string
  sourceFormat: string
  sourceKind: ContentKind
  target: string
  createdAt: string
  durationMs: number
  options: ConversionOptions
  warnings: string[]
  statistics: Record<string, number>
  files: string[]
}
export interface Progress { stage: string; fraction?: number }
export interface AdapterContext {
  files: SourceFile[]
  signal: AbortSignal
  progress: (progress: Progress) => void
  options: ConversionOptions
}
/** 能力按具体适配器登记，避免由扩展名推断任意互转。 */
export interface FormatAdapter {
  id: string
  label: string
  extensions: string[]
  kind: ContentKind[]
  import: boolean
  export: boolean
  experimental?: boolean
  limitations: string
  detect?: (header: Uint8Array, path: string) => boolean
  read?: (source: SourceFile, context: AdapterContext) => Promise<ModelDocument>
  write?: (model: ModelDocument, context: AdapterContext) => Promise<OutputFile[]>
}
export class ModelError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.name = 'ModelError'; this.code = code }
}
