# Model Converter · 三维模型转换器

面向公众免费使用的纯浏览器三维模型转换工具，计划部署到 GitHub Pages。模型计算在访问者设备上进行。

> 当前阶段：项目初始化与设计文档归档。转换引擎、文件导入、模型预览和实际导出尚未实现。下列设计文档描述规划能力，不代表当前已经支持。

## 设计文档

- [完整设计文档](docs/design.md)：产品目标、格式矩阵、技术架构、数据保留策略、实验重建、开发阶段、测试与发布要求。

## 开发环境

- Node.js 22.12 或更高的 22.x 版本。
- npm。
- Windows、macOS 或 Linux 开发环境；最终用户通过现代桌面浏览器使用。

## 本地启动

```powershell
Set-Location 'G:\myself\project\web\model-converter'
npm install
npm run dev
```

## 检查与构建

```powershell
npm run typecheck
npm run build
npm run preview
```

生产产物在 `dist/`。Vite 使用相对资源路径，适配 GitHub Pages 的仓库子路径。部署流程在实现阶段接入 GitHub Actions；当前尚未关联远程仓库或发布网站。

## 技术选型

已初始化 React、TypeScript、Vite。Three.js、WASM 引擎、Web Worker 和 ZIP 工具将在对应功能开发时安装，避免将尚未接入的依赖误认为已实现的功能。

## 开发约定

- 输入格式支持与输出格式支持分别登记。
- 检测网格、点云和高斯数据的实际内容，不只判断扩展名。
- 对转换中的近似、属性降级、丢失和不支持情况如实说明。
- 引擎按需加载；模型内容不发送到外部服务器。
- 遵守依赖许可证并保留第三方声明，源码公开不等于没有用途限制。

## 许可证

项目自有代码采用 [MIT](LICENSE)。第三方组件按其各自许可证使用和分发。
