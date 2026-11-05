import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

// 以真实仓库子路径提供生产产物，严格返回 404，避免 SPA 回退掩盖资源路径错误。
const root = path.resolve('dist'),
  prefix = '/model-converter/',
  port = Number(process.env.DIST_PORT ?? 4174)
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
}
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost')
    if (!url.pathname.startsWith(prefix)) {
      response.writeHead(404).end()
      return
    }
    const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html'
    const file = path.resolve(root, relative)
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    response.end(await readFile(file))
  } catch {
    response.writeHead(404).end()
  }
}).listen(port, '127.0.0.1', () => console.log(`生产子路径验证：http://127.0.0.1:${port}${prefix}`))
