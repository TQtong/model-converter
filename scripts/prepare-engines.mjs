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
  ...['draco_decoder.js', 'draco_wasm_wrapper.js', 'draco_decoder.wasm'].map((file) => [
    `three/examples/jsm/libs/draco/gltf/${file}`,
    `draco/${file}`,
  ]),
]
for (const [source, destination] of copies) {
  const target = path.join(root, 'public/engines', destination)
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(path.join(root, 'node_modules', source), target)
}
const notices = [
  '# 第三方组件声明\n\n下列组件以锁文件版本分发。模型文件不上传，程序资源来自本站。\n',
]
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
const packages = Object.entries(lock.packages)
  .filter(([location, info]) => location.startsWith('node_modules/') && !info.dev)
  .map(([location]) => location)
for (const location of packages) {
  const folder = path.join(root, location)
  const info = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'))
  notices.push(
    `\n## ${info.name} ${info.version}\n\n许可：${info.license}\n源码：${typeof info.repository === 'string' ? info.repository : (info.repository?.url ?? info.homepage)}\n`,
  )
  for (const file of await readdir(folder))
    if (/^(license|copying|notice)(\.|$)/i.test(file))
      notices.push(`\n### ${file}\n\n${await readFile(path.join(folder, file), 'utf8')}\n`)
}
for (const file of ['license.assimp.txt', 'license.assimpjs.txt'])
  notices.push(await readFile(path.join(root, 'node_modules/assimpjs-fbx/dist', file), 'utf8'))
for (const file of ['SOURCE.md', 'LICENSE', 'LASZIP-LICENSE', 'LASZIP-NOTICE'])
  notices.push(await readFile(path.join(root, 'src/vendor/laz', file), 'utf8'))
notices.push(
  '\n## OCCT 动态链接与重建说明\n\nOCCT 为独立单线程 WASM 模块，未修改上游。封装对应源码：https://github.com/kovacsv/occt-import-js/tree/c2148e54b456b571238d35cac037d304053d64b2；OCCT 内核对应源码：https://github.com/Open-Cascade-SAS/OCCT/tree/d2abb6d844231cb8f29be6894440874a4700e4a5。在封装源码中按 README、CMakeLists.txt 与 tools 构建，替换 node_modules/occt-import-js/dist/occt-import-js.wasm 后执行 npm run build，即可发布替换版本。允许用户调试此动态组件的修改。OCCT 使用 LGPL-2.1 与下附上游例外，本站 MIT 不覆盖第三方组件。完整构建及来源记录见仓库 docs/third-party.md。\n',
)
notices.push(await readFile(path.join(root, 'docs/licenses/OCCT_LGPL_EXCEPTION.txt'), 'utf8'))
await mkdir(path.join(root, 'public'), { recursive: true })
await writeFile(path.join(root, 'public/THIRD_PARTY_NOTICES.txt'), notices.join('\n'), 'utf8')
console.log('已准备本地 WASM、解码器与第三方许可。')
