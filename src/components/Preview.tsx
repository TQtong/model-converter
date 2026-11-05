import { useEffect, useRef, useState } from 'react'
import { AnimationMixer, Box3, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, GridHelper, Group, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Points, PointsMaterial, Quaternion, Scene, TorusKnotGeometry, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { Box, Grid2X2, Maximize, Pause, Play, Scan, Triangle } from 'lucide-react'
import { modelBounds } from '../core/scene'
import type { ModelDocument } from '../core/types'

export function Preview({ model }: { model?: ModelDocument }) {
  const host = useRef<HTMLDivElement>(null)
  const fit = useRef<() => void>(() => {})
  const wireRef = useRef(false), gridRef = useRef(true), playRef = useRef(true), animationRef = useRef(0)
  const [wire, setWire] = useState(false), [grid, setGrid] = useState(true), [playing, setPlaying] = useState(true)
  const [error, setError] = useState(''), [note, setNote] = useState(''), [animation, setAnimation] = useState(0)
  wireRef.current = wire; gridRef.current = grid; playRef.current = playing; animationRef.current = animation
  useEffect(() => {
    const element = host.current!
    let renderer: WebGLRenderer
    try { renderer = new WebGLRenderer({ antialias: false, alpha: true }) } catch { setError('当前设备无法创建 WebGL 预览。您仍可转换与下载模型。'); return }
    setError(''); setNote('')
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x11191f, 1)
    renderer.domElement.setAttribute('aria-label', '三维模型预览，左键旋转，右键平移，滚轮缩放')
    element.appendChild(renderer.domElement)
    const scene = new Scene(), camera = new PerspectiveCamera(40, 1, 0.001, 1e8)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    scene.add(new HemisphereLight(0xc9e9ff, 0x4b4b55, 2))
    const light = new DirectionalLight(0xffffff, 3); light.position.set(3, 6, 4); scene.add(light)
    const fill = new DirectionalLight(0x93baed, 1.5); fill.position.set(-5, 1, -3); scene.add(fill)
    const content = new Group(); scene.add(content)
    const ownedGeometries: BufferGeometry[] = [], ownedMaterials: (MeshStandardMaterial | PointsMaterial)[] = []
    const mixers: AnimationMixer[] = [], animationRoots: { root: Group; model: ModelDocument }[] = []
    const sparkResources: { dispose: () => void }[] = []
    const bounds = model ? modelBounds(model) : new Box3(new Vector3(-1.5, -1.5, -1.5), new Vector3(1.5, 1.5, 1.5))
    const center = bounds.getCenter(new Vector3()), size = Math.max(bounds.getSize(new Vector3()).length(), 0.001)
    let disposed = false
    async function populate(document: ModelDocument) {
      if (document.tiles) { for (const tile of document.tiles) await populate(tile.model); return }
      if (document.scene) {
        const root = clone(document.scene.root)
        const previewRoot = new Group(); previewRoot.position.copy(center).negate(); previewRoot.add(root); content.add(previewRoot)
        if (document.scene.animations.length) { const mixer = new AnimationMixer(root); mixers.push(mixer); animationRoots.push({ root: root as Group, model: document }) }
        return
      }
      const points = document.points!
      const count = points.positions.length / 3, step = Math.max(1, Math.ceil(count / 500000))
      if (step > 1) setNote(`预览显示约 ${Math.ceil(count / step).toLocaleString()} / ${count.toLocaleString()} 个点，导出使用原始数据`)
      if (document.kind === 'gaussian') {
        try {
          const { PackedSplats, SplatMesh, SparkRenderer } = await import('@sparkjsdev/spark')
          if (disposed) return
          const packed = new PackedSplats({ construct: splats => {
            const p = new Vector3(), scale = new Vector3(), rotation = new Quaternion(), color = new Color(), a = points.attributes
            for (let i = 0; i < count; i += step) {
              p.fromArray(points.positions, i * 3).sub(center)
              scale.set(Math.exp(a.scale_0[i]), Math.exp(a.scale_1[i]), Math.exp(a.scale_2[i]))
              rotation.set(a.rot_1[i], a.rot_2[i], a.rot_3[i], a.rot_0[i]).normalize()
              color.setRGB(...[0, 1, 2].map(j => Math.max(0, Math.min(1, 0.5 + a[`f_dc_${j}`][i] * 0.28209479177387814))) as [number, number, number])
              splats.pushSplat(p, scale, rotation, 1 / (1 + Math.exp(-a.opacity[i])), color)
            }
          } })
          await packed.initialized
          if (disposed) { packed.dispose(); return }
          const spark = new SparkRenderer({ renderer }), mesh = new SplatMesh({ packedSplats: packed })
          scene.add(spark); content.add(mesh); sparkResources.push(mesh, spark, packed)
          setNote('高斯形状预览 · 基础颜色；导出读取原始属性数组')
          return
        } catch (failure) { if (!disposed) setNote(`高斯渲染不可用，显示中心点：${(failure as Error).message}`) }
      }
      const positions: number[] = [], colors: number[] = []
      for (let i = 0; i < count; i += step) {
        positions.push(points.positions[i * 3] - center.x, points.positions[i * 3 + 1] - center.y, points.positions[i * 3 + 2] - center.z)
        if (points.colors) colors.push(...points.colors.slice(i * 3, i * 3 + 3))
      }
      const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      if (colors.length) geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      const material = new PointsMaterial({ size: size / 350, color: colors.length ? 0xffffff : 0xb2d7df, vertexColors: !!colors.length, sizeAttenuation: true })
      ownedGeometries.push(geometry); ownedMaterials.push(material); content.add(new Points(geometry, material))
    }
    if (model) void populate(model).catch(failure => { if (!disposed) setError(`预览失败：${failure.message}。转换仍可继续。`) })
    else {
      const geometry = new TorusKnotGeometry(0.85, 0.26, 180, 28), material = new MeshStandardMaterial({ color: 0xbed9d4, metalness: 0.35, roughness: 0.35 })
      ownedGeometries.push(geometry); ownedMaterials.push(material)
      const mesh = new Mesh(geometry, material); mesh.rotation.set(0.3, 0.6, 0); content.add(mesh)
    }
    const helper = new GridHelper(size * 2, 24, 0x44555c, 0x26333b)
    helper.position.y = model ? bounds.min.y - center.y - size * 0.02 : -1.4
    scene.add(helper)
    fit.current = () => { camera.position.set(size * 0.85, size * 0.55, size * 0.85); camera.near = Math.max(size / 10000, 0.00001); camera.far = size * 1000; camera.updateProjectionMatrix(); controls.target.set(0, 0, 0); controls.update() }
    fit.current()
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth, height = element.clientHeight
      renderer.setSize(width, height); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix()
    })
    resize.observe(element)
    let lastTime = performance.now(), currentAnimation = -1, currentWire = false
    renderer.setAnimationLoop(() => {
      const now = performance.now(), delta = Math.min((now - lastTime) / 1000, 0.1); lastTime = now
      if (currentAnimation !== animationRef.current) {
        currentAnimation = animationRef.current
        for (const [i, mixer] of mixers.entries()) { mixer.stopAllAction(); const clip = animationRoots[i].model.scene!.animations[currentAnimation]; if (clip) mixer.clipAction(clip).play() }
      }
      if (playRef.current) mixers.forEach(mixer => mixer.update(delta))
      if (currentWire !== wireRef.current) {
        currentWire = wireRef.current
        content.traverse(object => {
          const mesh = object as Mesh
          if (!mesh.isMesh || !mesh.material) return
          if (!mesh.userData.previewMaterialOwned) { mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => m.clone()) : mesh.material.clone(); mesh.userData = { ...mesh.userData, previewMaterialOwned: true }; (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => ownedMaterials.push(m as MeshStandardMaterial)) }
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) (material as MeshStandardMaterial).wireframe = currentWire
        })
      }
      helper.visible = gridRef.current; controls.update(); renderer.render(scene, camera)
    })
    return () => {
      disposed = true; renderer.setAnimationLoop(null); resize.disconnect(); controls.dispose()
      mixers.forEach(mixer => { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()) })
      sparkResources.forEach(resource => resource.dispose())
      ownedGeometries.forEach(geometry => geometry.dispose()); ownedMaterials.forEach(material => material.dispose())
      helper.geometry.dispose(); helper.material.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    }
  }, [model])
  const clips = model?.scene?.animations ?? []
  return <section className="preview" aria-label="模型预览">
    <div className="preview-heading"><span><Box size={15} /> {model ? '模型预览' : '三维工作区'}</span><span className="preview-mode">透视视图 <span className="tiny-dot" /></span></div>
    <div ref={host} className="canvas-host" />
    {!model && <div className="preview-caption"><span>YOUR NEXT DIMENSION</span><h2>让模型，跨越格式。</h2><p>导入文件，在这里查看每一个细节。</p></div>}
    {error && <div className="preview-error" role="status">{error}</div>}
    {note && <div className="preview-note">{note}</div>}
    <div className="preview-tools">
      <button title="适配视图" aria-label="适配视图" onClick={() => fit.current()}><Scan size={18} /></button>
      <button title="线框" aria-label="线框" aria-pressed={wire} onClick={() => setWire(!wire)}><Triangle size={18} /></button>
      <button title="网格" aria-label="网格" aria-pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={18} /></button>
      <span />
      <button title="全屏预览" aria-label="全屏预览" onClick={() => { void host.current?.parentElement?.requestFullscreen().catch(() => setNote('当前浏览器未允许全屏。')) }}><Maximize size={17} /></button>
    </div>
    {clips.length > 0 && <div className="animation-tools"><button aria-label={playing ? '暂停动画' : '播放动画'} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} /> : <Play size={15} />}</button><select aria-label="动画片段" value={animation} onChange={event => setAnimation(Number(event.target.value))}>{clips.map((clip, index) => <option key={clip.uuid} value={index}>{clip.name || `动画 ${index + 1}`} · {clip.duration.toFixed(2)} 秒</option>)}</select></div>}
    <div className="preview-hint"><span className="axis">Y<span>Z</span><b>X</b></span><span>左键旋转 · 右键平移 · 滚轮缩放</span></div>
  </section>
}
