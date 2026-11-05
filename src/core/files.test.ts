import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { collectFiles, resolveResource, safePath } from './files'

describe('本地资源与压缩包边界', () => {
  it('保留中文目录并解析父目录中的贴图', () => {
    const texture = { path: '模型/贴图/颜色 a.png', file: new File(['test'], '颜色 a.png') }
    expect(resolveResource([texture], '模型/几何/main.gltf', '../贴图/颜色%20a.png')).toBe(texture)
    expect(safePath('模型\\几何/../main.obj')).toBe('模型/main.obj')
  })
  it('阻止路径越界与外部模型资源', () => {
    for (const path of ['../x', '/x', 'C:\\x', 'https://a/x']) expect(() => safePath(path)).toThrow()
    expect(() => resolveResource([], 'main.gltf', 'https://example.org/a.bin')).toThrow('已阻止')
    expect(() => resolveResource([], 'main.gltf', 'a.bin')).toThrow('缺少配套资源')
  })
  it('解压后保留目录并拒绝重复主文件', async () => {
    const zip = new File([new Uint8Array(zipSync({ '模型/a.obj': strToU8('v 0 0 0') }))], '模型.zip')
    expect((await collectFiles([zip]))[0].path).toBe('模型/a.obj')
    await expect(collectFiles([new File(['a'], 'a.obj'), new File(['b'], 'a.obj')])).rejects.toThrow('重复路径')
  })
  it('拒绝压缩包中越界文件', async () => {
    const zip = new File([new Uint8Array(zipSync({ '../escape.obj': strToU8('bad') }))], 'bad.zip')
    await expect(collectFiles([zip])).rejects.toThrow('越出')
  })
})
