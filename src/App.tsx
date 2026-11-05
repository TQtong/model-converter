import './App.css'

function App() {
  return (
    <main className="project-shell">
      <div className="project-mark" aria-hidden="true">M</div>
      <p className="eyebrow">MODEL CONVERTER</p>
      <h1>三维模型转换器</h1>
      <p className="intro">面向多种三维数据的浏览器转换工具。</p>
      <section className="status-card" aria-labelledby="status-title">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <h2 id="status-title">项目已初始化</h2>
          <p>设计方案已归档，模型导入、预览与转换功能将在后续开发中接入。</p>
        </div>
      </section>
      <p className="project-note">免费开放 · 浏览器本地处理 · 面向 GitHub Pages</p>
    </main>
  )
}

export default App
