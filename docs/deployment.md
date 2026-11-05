# GitHub Pages 发布与故障定位

仓库：https://github.com/TQtong/model-converter 。默认发布 URL：https://tqtong.github.io/model-converter/ 。

## 正常发布

1. 在仓库 Settings → Pages 中将发布源设置为 **GitHub Actions**。
2. 推送已提交代码到 `main`，或运行“检查与发布 GitHub Pages”工作流。
3. 等待 `build` 与 `deploy` 成功；失败的构建不会替换线上版本。
4. 在 Actions 部署输出中取得实际站点地址。转换模型的计算不在 Actions 中运行。

工作流使用最小化权限：构建只读取源码，部署任务具有 `pages: write` 和 `id-token: write`。PR 运行检查，不部署。生产目录只包含静态站点、引擎资源与第三方声明，不包括测试模型或用户文件。

## 本地复现

```sh
npm ci
npm run check:encoding
npm run typecheck
npm run lint
npm test
npm run build
npm run test:deployment -- --project=chromium --project=firefox
```

最后一个命令自动启动严格的静态服务器，将 `dist/` 映射到 `/model-converter/`。源目录调试和生产路径验证分别运行，避免开发服务的路由回退掩盖路径错误。

## 资源与故障

- `base: './'`，Worker 使用 Vite 模块 URL，引擎由 `scripts/prepare-engines.mjs` 从冻结依赖复制，所有模型资源从导入的 File 集合读取。
- 404 时先查看 `engines/` 是否完整、构建是否执行 `prebuild`、站点是否使用正确尾部斜杠；不通过 CDN 临时加载引擎。
- WASM 必须按 `application/wasm` 提供。本站使用单线程引擎，不需要 SharedArrayBuffer/COOP/COEP。
- 缺少贴图或缓冲文件时需补全资源后重新导入；模型内的 HTTP URL 不会自动下载。
- 引擎、ZIP、重建失败均可取消和重试；任务移除释放模型、纹理与下载 URL。
- 浏览器内存不足时应拆分任务、降低重建分辨率或采样数量。本站不把 1 GiB 上限作为设备处理能力保证。

## 自定义引擎

第三方模块由锁文件冻结。替换引擎后必须重跑对应样例回读与生产子路径验证，不依据桌面库格式清单直接扩大 UI 支持范围。OCCT 来源、许可与重建方式见 [第三方说明](third-party.md)。
