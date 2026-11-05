import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const decoder = new TextDecoder('utf-8', { fatal: true }),
  failures = []
let checked = 0
async function inspect(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (
      [
        '.git',
        'node_modules',
        'dist',
        'work',
        'test-results',
        'playwright-report',
        'engines',
        'user-models',
      ].includes(entry.name)
    )
      continue
    const file = path.join(folder, entry.name)
    if (entry.isDirectory()) await inspect(file)
    else if (
      /\.(?:tsx?|mjs|css|html|json|md|ya?ml|txt|ifc)$/.test(file) ||
      /^(LICENSE|NOTICE)$/.test(entry.name)
    ) {
      try {
        const text = decoder.decode(await readFile(file))
        if (text.includes('\uFFFD') || /\u951F\u65A4\u62F7/.test(text))
          throw new Error('发现替换字符或常见乱码')
        checked++
      } catch (error) {
        failures.push(`${file}: ${error.message}`)
      }
    }
  }
}
await inspect('.')
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else console.log(`UTF-8 与中文编码检查通过：${checked} 个文本文件。`)
