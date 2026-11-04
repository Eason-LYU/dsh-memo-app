// 把项目源码（不含密钥/产物）备份到数据仓库的 src/ 下
// 用法：node tools/pushsrc.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'))

const tokenFile = path.join(HERE, '.tok.tmp')
const tokenFromFile = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : ''
const token = process.env.GITHUB_TOKEN || tokenFromFile || fs.existsSync(path.join(ROOT, 'token.txt'))
  ? (process.env.GITHUB_TOKEN || tokenFromFile || fs.readFileSync(path.join(ROOT, 'token.txt'), 'utf8').match(/github_pat_[A-Za-z0-9_]+/)?.[0])
  : ''
if (!token) { console.error('[src] 缺少 token'); process.exit(1) }

const PREFIX = 'src'
const FILES = [
  'README.md',
  '.gitignore',
  'run-sync.cmd',
  'tools/memo.mjs',
  'tools/setup.mjs',
  'tools/check.mjs',
  'tools/pushsrc.mjs',
  'profile/kimi-memory-16.md',
]

const API = `https://api.github.com/repos/${CFG.repo}/contents`
const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-memo-src' }

async function gh(method, p, body) {
  const res = await fetch(`${API}/${p}`, {
    method,
    headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`${method} ${p} → ${res.status} ${(await res.text()).slice(0, 120)}`)
  }
  return res.status === 404 ? null : res.json()
}

for (const rel of FILES) {
  const candidates = [path.join(ROOT, rel), path.join(path.resolve(ROOT, '..'), rel)]
  const abs = candidates.find((p) => fs.existsSync(p))
  if (!abs) { console.log('[skip]', rel); continue }
  const content = fs.readFileSync(abs)
  const target = `${PREFIX}/${rel}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await gh('GET', target).catch(() => null)
    const body = {
      message: `src: ${rel}`,
      content: content.toString('base64'),
      branch: CFG.branch || 'main',
    }
    if (existing && existing.sha) body.sha = existing.sha
    try { await gh('PUT', target, body); console.log('[src]', rel); break }
    catch (e) { if (attempt === 2) throw e; await new Promise((r) => setTimeout(r, 800)) }
  }
}
console.log('[src] 完成')
