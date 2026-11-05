# Model Converter · 三维模型转换器

面向公众免费使用的纯浏览器三维模型转换工作台。导入文件、文件夹或 ZIP，预览模型，选择实际可用的目标格式，下载模型、转换报告与关联属性。无需账户、Python、Blender、本地服务或转换后端。

在线站点：[GitHub Pages](https://tqtong.github.io/model-converter/) · [源码](https://github.com/TQtong/model-converter) · [完整设计](docs/design.md) · [实现与验收](docs/implementation.md)

## 已实现能力

| 数据类型           | 输入                                                                  | 输出                                                               |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 网格与场景         | OBJ、FBX、GLB/glTF、STL、网格 PLY、OFF、3DS、DAE、3MF、AMF、WRL、3DM  | GLB/glTF、OBJ + MTL/贴图、STL、网格 PLY、OFF、网格 3DM；实验性 FBX |
| CAD/BIM            | STEP/STP、IGES/IGS、BREP/BRP、FCStd、IFC、DotBIM                      | 上述网格格式与关联 `metadata.json`                                 |
| 点云               | 点云 PLY、PCD（ASCII/二进制/LZF）、XYZ、LAS/LAZ 1.0–1.3（点记录 0–3） | 点云 PLY、PCD、XYZ                                                 |
| Gaussian Splatting | 标准高斯 PLY、SPLAT、SPZ v2/v3                                        | 标准高斯 PLY、SPLAT                                                |
| 有限 3D Tiles      | 显式层级 GLB、B3DM、PNTS、外部 tileset                                | 按内容分块转换；网格封装为单级 3D Tiles                            |

PLY 根据顶点属性与面定义区分网格、点云、高斯。GLB/glTF 和 FBX 走独立场景通道，保留支持的层级、蒙皮、骨骼、贴图和关键帧；FBX 导出必须通过实际回读检查才允许下载。

实验路线包括面积加权网格表面采样为点云/高斯、点云局部法线估计与有符号距离场重建、高斯各向异性密度等值面重建，以及提取高斯中心为普通点云。表面采样读取原始 UV、基础贴图、材质色和顶点色。

## 使用流程

1. 导入模型及其材质、贴图、缓冲文件。建议导入整个文件夹或 ZIP，保留目录结构；多个主模型可选择加入队列。
2. 检查预览、单位、对象层级与工程属性。源文件未声明单位时，确认“源单位”。CAD 离散化偏差在导入前设置。
3. 选择可用目标和必要参数。默认保留方向；glTF 场景通道按规范换算为米，并记录变换。
4. 开始转换。一次运行一个本机任务，可取消、重试、连续导入和重新导出。
5. 单文件可直接下载；多文件自动打包 ZIP。“完整包”额外包含 `conversion-report.json` 与 `metadata.json`。

## 重要边界

- 模型不上传、不持久化；模型引用的外部 URL 会被阻止。缺少资源需补充后重新导入。刷新页面需要重新选择文件。
- 单任务输入及 ZIP 解压后均不超过 **1 GiB**；超过 **256 MiB** 提示内存需求。可处理规模取决于设备，1 GiB 是限制而非成功保证。
- CAD/IFC 输出为离散网格，不包含原生参数化历史或完整 CAD/BIM 回写。工程属性附带保存，不等于目标格式原生表达完整工程语义。
- FreeCAD 读取已保存的可见 BREP，不执行宏或重算特征；Rhino 读取可提取几何/渲染网格，输出为网格对象。
- LAS 1.4、点记录 4/5 波形、隐式瓦片、OSGB、闭源工程文件、照片训练、SuGaR/CUDA 不在首版支持范围。
- 普通静态格式不能保存骨骼动画；SPLAT 会量化颜色/旋转并丢弃高阶球谐；重建是近似算法，不代表真实表面或无损转换。
- SPZ 用 Spark 扩展精度解码并提取最高三阶球谐；PLY 保留已读取的高斯标量，高阶球谐可随方向设置同步旋转。
- 重建默认 `32³`，可调 `16³–96³`，最多均匀选取 30 万个原始点参与重建；预览最多显示约 50 万个点，普通格式导出使用原始数据。

更详细的保留规则与验证覆盖见 [实现说明](docs/implementation.md)。

## 开发与验证

需要 Node.js 22.12 或更高版本，建议 Node.js 24，以及 npm。

```sh
npm ci
npm run dev
```

`predev` 和 `prebuild` 将锁定依赖的 WASM/解码器与许可证复制到 `public/engines/`。生产产物使用相对路径，支持 GitHub Pages 仓库子路径，重型引擎按格式加载。

```sh
npm run check:encoding
npm run typecheck
npm run lint
npm test
npm run build
```

浏览器回读测试覆盖场景、动画、材质、CAD/BIM、点云、高斯、压缩、地理坐标、取消与资源网络边界。

```sh
npx playwright install chromium firefox
npm run test:browser -- --project=chromium --project=firefox --grep-invert "生产仓库"
npm run test:deployment -- --project=chromium --project=firefox
```

已安装桌面 Chrome/Edge 时，可选择 `--project=chrome`、`--project=edge`。测试配置自动启动本地服务；生产测试严格挂载 `/model-converter/`，不使用 SPA 回退掩盖路径错误。测试样例许可见 [tests/fixtures/README.md](tests/fixtures/README.md)。

## 发布

[Pages 工作流](.github/workflows/pages.yml) 在 `main` 推送时执行编码、类型、静态检查、单元测试、Chromium/Firefox 读写回读测试、生产构建和仓库子路径验证，通过后发布到 GitHub Pages。PR 仅检查，不部署。

仓库 Pages 发布源应为 **GitHub Actions**。Actions 只分发静态程序，不处理访问者的模型任务。详见 [发布说明](docs/deployment.md)。

## 项目结构

```text
src/adapters/     真实格式读写与能力注册
src/core/         文件安全、原始数据、转换、采样与重建、报告、下载
src/workers/      可终止单线程计算与按需引擎
src/components/   预览、设置、层级、属性与帮助界面
src/hooks/        单任务队列、取消、重试、释放
src/vendor/       有完整来源和许可证的 LASzip 兼容算法
tests/browser/   浏览器读写、保真、网络与发布验证
scripts/         静态资源、编码检查与子路径服务器
```

## 许可证

项目自有代码采用 [MIT](LICENSE)。第三方许可独立适用，包含 MIT、BSD、Apache-2.0、OCCT LGPL-2.1 与例外，保留完整版权及 NOTICE。[第三方来源与重建说明](docs/third-party.md)，构建后可从站点底部下载 `THIRD_PARTY_NOTICES.txt`。
