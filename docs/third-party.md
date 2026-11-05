# 第三方来源、许可与引擎重建

自有代码使用 MIT，第三方组件依各自许可分发。`npm ci` 按 `package-lock.json` 安装；程序构建会遍历生产依赖，收集版权、LICENSE/NOTICE 及来源到 `public/THIRD_PARTY_NOTICES.txt`，站点页脚提供入口。

主要组件：React、Three.js、fflate、Lucide、Web-IFC、Rhino3dm、Spark、loaders.gl、AssimpJS/Assimp、OCCT。许可分别包含 MIT、BSD、Apache-2.0、LGPL-2.1 与例外，不以本项目 MIT 覆盖第三方许可。

## Assimp FBX 导出

- 封装来源：[repalash/assimpjs 固定提交](https://github.com/repalash/assimpjs/tree/cca5cdd9a78eb0b8dbcce435a179e8d5dd4febd0)。
- 依赖以 HTTPS 源码归档固定到提交，避免构建依赖 SSH 凭据；JS/WASM 随站点分发。
- 保留分发包 `dist/license.assimp.txt` 与 `dist/license.assimpjs.txt`。
- 输出经过 FBX 文件签名、回读几何、蒙皮与动画验证，仍标记实验性。

## OCCT 独立 WASM

- `occt-import-js@0.0.23` 对应封装源码：[c2148e54b456b571238d35cac037d304053d64b2](https://github.com/kovacsv/occt-import-js/tree/c2148e54b456b571238d35cac037d304053d64b2)。
- 对应 OCCT 子模块：[d2abb6d844231cb8f29be6894440874a4700e4a5](https://github.com/Open-Cascade-SAS/OCCT/tree/d2abb6d844231cb8f29be6894440874a4700e4a5)。
- 遵守 LGPL-2.1 与 [OCCT 例外](licenses/OCCT_LGPL_EXCEPTION.txt)，完整 LGPL 与例外一并进入站点声明；封装和内核未修改。
- 使用对应封装源码的 `README.md`、`CMakeLists.txt`、`tools/` 和 Emscripten 构建单线程 WASM。递归检出上述子模块后运行上游 `tools/build_wasm_win.bat` 或 `tools/build_wasm_linux.sh`（以对应提交实际脚本名为准）。
- 将自定义产物替换 `node_modules/occt-import-js/dist/occt-import-js.wasm`，保持 JS 与 WASM ABI 匹配，运行 `npm run build`；准备脚本会把它复制到静态引擎目录。也可直接替换构建产物 `dist/engines/occt/occt-import-js.wasm`，但必须重新验证兼容性。
- 允许用户为调试该动态组件的修改而进行必要的调试，不对第三方 LGPL 权利附加额外限制。

## LASzip 兼容解码算法

`src/vendor/laz/` 保存上游完整 TypeScript 算法、固定提交来源及 MIT/Apache-2.0 LICENSE/NOTICE。未修改算法；本项目包装层仅启用 LAS 1.0–1.3、点记录 0–3，校验 VLR、块表、长度和版本，并在可终止 Worker 中运行。

真实 LAZ 测试样例来自 loaders.gl 的确定性 MIT 测试数据，附独立 LAS 参考、上游 README、LICENSE 与固定来源。源码和样例不进入首屏资源；测试样例不发布到站点。

## 模型样例

自行构造的示例、纹理、动画、IFC 与点云测试数据采用 CC0 1.0；外部 CAD 和 LAZ 样例各按所在目录说明。不会把“可下载”当作任意用途授权，也未引入 SuGaR 或其他用途限制不匹配的研究引擎。
