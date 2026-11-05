import { Group } from 'three'
import { basename, expandZip } from '../core/files'
import { readCad } from './cad'
import { ModelError, type AdapterContext, type ModelDocument, type SourceFile } from '../core/types'

/** FreeCAD 工程读取其存档 BREP；不执行文档里的 Python、宏或表达式。 */
export async function readFcstd(source: SourceFile, context: AdapterContext): Promise<ModelDocument> {
  const files = await expandZip(source.file, '', context.signal)
  const documentFile = files.find(file => file.path === 'Document.xml')
  if (!documentFile) throw new ModelError('CORRUPT', 'FCStd 缺少 Document.xml。')
  const xml = new DOMParser().parseFromString(await documentFile.file.text(), 'application/xml')
  if (xml.querySelector('parsererror')) throw new ModelError('CORRUPT', 'FCStd Document.xml 无效。')
  const guiFile = files.find(file => file.path === 'GuiDocument.xml')
  const gui = guiFile ? new DOMParser().parseFromString(await guiFile.file.text(), 'application/xml') : undefined
  const root = new Group(), objects: Record<string, unknown> = {}, groups = new Map<string, Group>(), relationships = new Map<string, string[]>()
  const nodes = Array.from(xml.querySelectorAll('ObjectData > Object'))
  for (const [index, node] of nodes.entries()) {
    context.signal.throwIfAborted()
    const name = node.getAttribute('name') || `Object${index}`
    const properties: Record<string, unknown> = {}
    for (const property of node.querySelectorAll(':scope > Properties > Property')) {
      properties[property.getAttribute('name') || 'unknown'] = Array.from(property.children).map(child => ({ type: child.tagName, attributes: Object.fromEntries(Array.from(child.attributes, attr => [attr.name, attr.value])), content: child.innerHTML }))
    }
    objects[name] = properties
    const viewProvider = Array.from(gui?.querySelectorAll('ViewProvider') ?? []).find(provider => provider.getAttribute('name') === name)
    const visibility = viewProvider?.querySelector('Property[name="Visibility"] Bool')?.getAttribute('value')
    if (visibility === 'false' || visibility === '0') continue
    const group = new Group()
    group.name = node.querySelector('Property[name="Label"] String')?.getAttribute('value') || name
    group.userData = { freeCadObject: name, properties }
    const shape = node.querySelector('Property[name="Shape"] Part')?.getAttribute('file')
    if (shape) {
      const entry = files.find(file => file.path === shape)
      if (!entry) throw new ModelError('MISSING_RESOURCE', `FCStd 缺少 BREP：${shape}`)
      context.progress({ stage: `离散化 FreeCAD 对象 ${index + 1}/${nodes.length}` })
      const model = await readCad({ path: shape.endsWith('.brp') ? shape.slice(0, -4) + '.brep' : shape, file: entry.file }, context)
      group.add(model.scene!.root)
    }
    const children = Array.from(node.querySelectorAll('Property[name="Group"] Link, Property[name="Group"] LinkList > Link')).map(link => link.getAttribute('value')).filter(Boolean) as string[]
    relationships.set(name, children)
    groups.set(name, group)
  }
  for (const [name, children] of relationships) for (const child of children) {
    const parent = groups.get(name), object = groups.get(child)
    if (parent && object && parent !== object && !object.getObjectById(parent.id)) parent.add(object)
  }
  for (const group of groups.values()) if (!group.parent) root.add(group)
  if (!root.children.length) throw new ModelError('EMPTY', 'FCStd 没有可导入的可见 BREP 对象；请在 FreeCAD 中保存形状后重试。')
  return { kind: 'scene', name: basename(source.path), scene: { root, animations: [] }, metadata: { source: source.path, format: 'fcstd', unit: 'mm', upAxis: 'Z', properties: { objects }, warnings: ['FreeCAD 使用存档 BREP 离散化，仅读取已保存的可见形状与对象属性；不执行宏、不重新计算特征、不保留可编辑历史。装配链接及尚未保存的计算形状可能无法提取。'] } }
}
