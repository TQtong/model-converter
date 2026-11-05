import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// 引擎从锁定的 npm 依赖复制到站点，运行时不依赖 CDN 或仓库根路径。
const root = process.cwd()
const copies = [
  ['occt-import-js/dist/occt-import-js.wasm', 'occt/occt-import-js.wasm'],
  ['assimpjs-fbx/dist/assimpjs.wasm', 'assimp/assimpjs.wasm'],
  ['web-ifc/web-ifc.wasm', 'ifc/web-ifc.wasm'],
  ['rhino3dm/rhino3dm.js', 'rhino/rhino3dm.js'],
  ['rhino3dm/rhino3dm.wasm', 'rhino/rhino3dm.wasm'],
  ...['draco_decoder.js', 'draco_wasm_wrapper.js', 'draco_decoder.wasm'].map(file => [`three/examples/jsm/libs/draco/gltf/${file}`, `draco/${file}`]),
]
for (const [source, destination] of copies) {
  const target = path.join(root, 'public/engines', destination)
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(path.join(root, 'node_modules', source), target)
}
const notices = ['# 第三方组件声明\n\n下列组件以锁文件版本分发。模型文件不上传，程序资源来自本站。\n']
const packages = ['three', 'fflate', 'react', 'react-dom', 'lucide-react', 'assimpjs-fbx', 'occt-import-js', 'web-ifc', 'rhino3dm', '@sparkjsdev/spark', '@loaders.gl/core', '@loaders.gl/las']
for (const name of packages) {
  const folder = path.join(root, 'node_modules', name)
  const info = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'))
  notices.push(`\n## ${name} ${info.version}\n\n许可：${info.license}\n源码：${typeof info.repository === 'string' ? info.repository : info.repository?.url ?? info.homepage}\n`)
  for (const file of await readdir(folder)) if (/^(license|copying|notice)(\.|$)/i.test(file)) notices.push(`\n### ${file}\n\n${await readFile(path.join(folder, file), 'utf8')}\n`)
}
for (const file of ['license.assimp.txt', 'license.assimpjs.txt']) notices.push(await readFile(path.join(root, 'node_modules/assimpjs-fbx/dist', file), 'utf8'))
notices.push('\n## OCCT 动态链接说明\n\nOCCT 为独立单线程 WASM 模块，未修改上游。用户可以替换 public/engines/occt/occt-import-js.wasm 并重建站点。封装与构建说明：https://github.com/kovacsv/occt-import-js；OCCT 源码版本由其子模块锁定：https://github.com/kovacsv/occt-import-js/tree/main/occt。OCCT 使用 LGPL-2.1 与上游例外，保留各自许可；本项目 MIT 不覆盖这些依赖。\n')
await mkdir(path.join(root, 'public'), { recursive: true })
await writeFile(path.join(root, 'public/THIRD_PARTY_NOTICES.txt'), notices.join('\n'), 'utf8')
console.log('已准备本地 WASM、解码器与第三方许可。')
