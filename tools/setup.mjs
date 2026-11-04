// 一次性初始化：检查仓库 → 推送 app 文件 → 开 Pages → 推记忆包
// 用法: node setup.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'))
function readToken() {
  if (process.env.MEMO_GH_TOKEN) return process.env.MEMO_GH_TOKEN
  if (cfg.token) return cfg.token
  const f = path.join(ROOT, 'token.txt')
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, 'utf8').match(/github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+/)
    if (m) return m[0]
  }
  return ''
}
const token = readToken()
if (!token) { console.error('没有找到 token：请把 token 粘进项目根目录的 token.txt 后保存'); process.exit(1) }

const API = 'https://api.github.com'
const H = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-memo-setup',
}

async function api(method, p, body, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(API + p, {
        method,
        headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await res.text()
      let json = null
      try { json = text ? JSON.parse(text) : null } catch { }
      return { status: res.status, json, text }
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw new Error(`${method} ${p} 网络失败：${lastErr?.message}`)
}

function walk(dir, base = '') {
  const out = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${ent.name}` : ent.name
    if (ent.isDirectory()) out.push(...walk(path.join(dir, ent.name), rel))
    else out.push(rel)
  }
  return out
}
const APP_FILES = walk(path.join(ROOT, 'app'))

async function main() {
  const me = await api('GET', '/user')
  if (me.status !== 200) {
    console.error('token 无效：', me.status, me.text.slice(0, 160))
    process.exit(1)
  }
  console.log('账号:', me.json.login)

  const [owner, name] = cfg.repo.split('/')
  const appRepo = cfg.appRepo || `${owner}/dsh-memo-app`

  for (const r of [cfg.repo, appRepo]) {
    const info = await api('GET', `/repos/${r}`)
    if (info.status !== 200) {
      console.error(`仓库 ${r} 不可见（${info.status}）：${info.text.slice(0, 120)}`)
      process.exit(1)
    }
    console.log(`仓库 ${r} ok · 默认分支 ${info.json.default_branch} · ${info.json.private ? '私有' : '公开'} · Pages ${info.json.has_pages}`)
  }

  // 1. 推 app 文件
  for (const f of APP_FILES) {
    const body = fs.readFileSync(path.join(ROOT, 'app', f))
    const encoded = Buffer.from(body).toString('base64')
    const existing = await api('GET', `/repos/${appRepo}/contents/${f}?ref=${cfg.branch}`)
    if (f.startsWith('vendor/') && existing.status === 200 && existing.json?.size === body.length) {
      continue // 依赖库没变就跳过，省请求
    }
    const payload = { message: `app: add ${f}`, content: encoded, branch: cfg.branch }
    if (existing.status === 200 && existing.json?.sha) payload.sha = existing.json.sha
    const put = await api('PUT', `/repos/${appRepo}/contents/${f}`, payload)
    const ok = put.status === 200 || put.status === 201
    console.log(`上传 ${f}: ${ok ? 'ok' : put.status + ' ' + put.text.slice(0, 120)}`)
  }

  // 2. 开 Pages
  const pages = await api('GET', `/repos/${appRepo}/pages`)
  if (pages.status === 200) {
    console.log('Pages 已启用:', pages.json.html_url)
  } else {
    const created = await api('POST', `/repos/${appRepo}/pages`, {
      source: { branch: cfg.branch, path: '/' },
    })
    if (created.status === 201 || created.status === 204) {
      console.log('Pages 已创建:', created.json?.html_url ?? '(构建中)')
    } else {
      console.error('Pages 创建失败:', created.status, created.text.slice(0, 300))
    }
  }

  // 3. 推记忆包
  const { execFileSync } = await import('node:child_process')
  execFileSync(process.execPath, [path.join(HERE, 'memo.mjs'), 'push'], {
    stdio: 'inherit',
    env: { ...process.env, MEMO_GH_TOKEN: token },
  })
}

main().catch((e) => { console.error('setup 失败:', e.message); process.exit(1) })
