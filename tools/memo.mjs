#!/usr/bin/env node
// dsh-memo — 在 DSH 与手机之间搬运「轻记忆包」
//
// 用法：
//   node memo.mjs generate          只生成到 ./pack-out（不联网）
//   node memo.mjs pull              从 GitHub 拉手机笔记，追加进当天工作日志
//   node memo.mjs push              把 pack/*.md 推回 GitHub
//   node memo.mjs sync              pull + generate + push（开机后跑这个）
//
// 配置：同目录 config.json（见 config.example.json）
// Token：优先环境变量 MEMO_GH_TOKEN，其次 config.token（不推荐，明文）

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CONFIG_PATH = path.join(HERE, 'config.json')
const STATE_PATH = path.join(HERE, '.memo-state.json')

const DEFAULTS = {
  repo: '',                 // 例如 "Eason-LYU/dsh-memo-data"
  branch: 'main',
  workspace: '',            // 必填：~/.dsh/memory/workspaces/ 下的目录名，如 --E--dsworkplace--
  outDir: 'pack-out',
  packPrefix: 'pack',
  apiBase: 'https://api.github.com',
  maxRecentLines: 60,
  maxSkills: 30,
  maxCharsPerFile: 16000,
}

function loadConfig() {
  let cfg = {}
  if (fs.existsSync(CONFIG_PATH)) cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  return { ...DEFAULTS, ...cfg }
}

function tokenOf(cfg) {
  if (process.env.MEMO_GH_TOKEN) return process.env.MEMO_GH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  if (cfg.token) return cfg.token
  const f = path.join(ROOT, 'token.txt')
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, 'utf8').match(/github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+/)
    if (m) return m[0]
  }
  return ''
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function readIf(p) {
  try { return fs.readFileSync(p, 'utf8') } catch { return '' }
}

function clamp(s, n) {
  return s.length > n ? s.slice(0, n) + '\n…(截断)' : s
}

// ── 来源采集 ──────────────────────────────────────────────

function userRules() {
  return readIf(path.join(dshHome(), 'memory', 'MEMORY.md'))
}

function workspaceDir(cfg) {
  return path.join(dshHome(), 'memory', 'workspaces', cfg.workspace)
}

function recentLogs(cfg) {
  const dir = workspaceDir(cfg)
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .slice(-7)
  const out = []
  const clean = (s) => s
    .replace(/^\d{1,2}:\d{2}\s*/, '')
    .replace(/\[kind:[a-z]+\]\s*/gi, '')
    .replace(/`([^`]{40,})`/g, '`…`')
    .replace(/\s+/g, ' ')
    .trim()
  for (const f of files) {
    const day = f.replace('.md', '')
    const lines = readIf(path.join(dir, f)).split(/\r?\n/)
    const bullets = []
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('- ')) continue
      const body = clean(t.slice(2))
      if (body.length < 8) continue
      bullets.push(`${day} · ${body.length > 100 ? body.slice(0, 100) + '…' : body}`)
    }
    // 取当天最后 8 条（最新的事），而不是最早的 8 条
    out.push(...bullets.slice(-8))
  }
  return out.slice(-40)
}

function projectNotes(cfg) {
  return readIf(path.join(workspaceDir(cfg), 'MEMORY.md'))
}

// 分层摘要：近 7 天 / 近 30 天的关键结论，压成手机能读完的篇幅
function digest(cfg) {
  const dir = workspaceDir(cfg)
  if (!fs.existsSync(dir)) return '# 分层摘要\n\n（无日志）\n'
  const today = new Date()
  const wkStart = new Date(today.getTime() - 7 * 864e5).toISOString().slice(0, 10)
  const files = fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .slice(-30)
  const clean = (s) => s
    .replace(/^\d{1,2}:\d{2}\s*/, '')
    .replace(/\[kind:[a-z]+\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const key = /(决定|定稿|修正|口径|约定|结论|完成|修复|上线|教训|不要|必须|验证)/
  const week = []
  const month = []
  for (const f of files) {
    const day = f.slice(0, 10)
    for (const raw of readIf(path.join(dir, f)).split(/\r?\n/)) {
      const t = raw.trim()
      if (!t.startsWith('- ')) continue
      const body = clean(t.slice(2))
      if (body.length < 12 || !key.test(body)) continue
      const row = `${day} · ${body.slice(0, 110)}`
      if (day >= wkStart) week.push(row)
      month.push(row)
    }
  }
  const uniq = (a) => [...new Set(a)]
  const wk = uniq(week).slice(-12)
  const mo = uniq(month).slice(-18)
  return `# 分层摘要（${today.toISOString().slice(0, 10)} 生成）\n\n## 最近 7 天（要点）\n${wk.length ? wk.map((x) => '- ' + x).join('\n') : '- （无）'}\n\n## 最近 30 天（要点）\n${mo.length ? mo.map((x) => '- ' + x).join('\n') : '- （无）'}\n`
}

function styleBullets(cfg) {
  const src = [userRules(), projectNotes(cfg)].join('\n')
  const keep = /(偏好|默认|口径|风格|语体|交付|模板|格式|不得|必须|禁止)/
  const lines = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('- ') && keep.test(l))
  const seen = new Set()
  return lines
    .map((l) => (l.length > 120 ? l.slice(0, 120) + '…' : l))
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
    .slice(0, 20)
}

function skills(cfg) {
  const dir = path.join(dshHome(), 'skills')
  if (!fs.existsSync(dir)) return []
  const rows = []
  for (const name of fs.readdirSync(dir)) {
    const md = readIf(path.join(dir, name, 'SKILL.md'))
    if (!md) continue
    const fm = md.match(/^---\n([\s\S]*?)\n---/)
    const title = (fm ? (fm[1].match(/^name:\s*(.+)$/m)?.[1] ?? '') : '') || name
    const desc = (fm ? (fm[1].match(/^description:\s*(.+)$/m)?.[1] ?? '') : '') || ''
    rows.push(`- ${title.trim()} — ${desc.trim().slice(0, 90)}`)
  }
  return rows.slice(0, DEFAULTS.maxSkills)
}

function persona(cfg) {
  // 优先从本地 fun 插件里取「阿蓝」人设；取不到用内置精简版
  const plugin = path.join(ROOT, '..', 'dsh-plugin-fun', 'index.js')
  const src = readIf(plugin)
  const m = src.match(/const PERSONA_TEXT = `([\s\S]*?)`\n/)
  if (m) return m[1].trim()
  return [
    '# 人格：阿蓝',
    '你是「阿蓝」，一条蓝色小鱼，做 AI 助手；说话轻快、短句优先、接得住玩笑。',
    '正事优先：技术问题先给准确答案，俏皮话放最后一句。危险操作与敏感话题不开玩笑。',
  ].join('\n')
}

// ── 生成记忆包 ────────────────────────────────────────────

function buildPack(cfg) {
  const today = new Date().toISOString().slice(0, 10)
  const files = {}

  files['persona.md'] = clamp(`# 人格\n\n${persona(cfg)}\n`, cfg.maxCharsPerFile)

  files['rules.md'] = clamp(
    `# 用户硬性规则（来自 ~/.dsh/memory/MEMORY.md，按日期分段）\n\n${userRules().trim()}\n`,
    cfg.maxCharsPerFile,
  )

  const style = styleBullets(cfg)
  files['style.md'] = clamp(
    `# 说话与交付风格（自动摘录）\n\n${style.length ? style.join('\n') : '- （暂无摘录，沿用通用风格：直接、结论先行、少寒暄）'}\n`,
    cfg.maxCharsPerFile,
  )

  const recent = recentLogs(cfg)
  files['recent.md'] = clamp(
    `# 最近 7 天做过什么（自动摘录，${today} 生成）\n\n${recent.length ? recent.join('\n') : '- （近 7 天无日志）'}\n`,
    cfg.maxCharsPerFile,
  )

  const sk = skills(cfg)
  files['skills.md'] = clamp(
    `# 已固化的技能库\n\n${sk.length ? sk.join('\n') : '- （暂无）'}\n`,
    cfg.maxCharsPerFile,
  )

  files['meta.json'] = JSON.stringify(
    { generatedAt: new Date().toISOString(), workspace: cfg.workspace, version: 1 },
    null,
    2,
  ) + '\n'

  // 用户画像：来自 Kimi 的 16 份记忆（放在工作区 profile/ 下）
  const profileFile = path.resolve(ROOT, '..', 'profile', 'kimi-memory-16.md')
  if (fs.existsSync(profileFile)) {
    files['profile.md'] = clamp(readIf(profileFile).trim() + '\n', 24000)
  }

  // 分层摘要：手机不塞全部日志，只给要点
  files['digest.md'] = clamp(digest(cfg), 9000)

  // 手机端写的长期事实（durable.md），PC 拉取后回灌进包
  const durableCache = path.join(HERE, 'durable-cache.md')
  if (fs.existsSync(durableCache)) {
    files['durable.md'] = clamp(readIf(durableCache).trim() + '\n', 12000)
  }

  return files
}

function writePack(cfg, files) {
  const out = path.join(ROOT, cfg.outDir)
  fs.mkdirSync(out, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(out, name), body, 'utf8')
  }
  return out
}

// ── GitHub ────────────────────────────────────────────────

function ghHeaders(cfg) {
  const token = tokenOf(cfg)
  if (!token) throw new Error('缺少 GitHub token：设环境变量 MEMO_GH_TOKEN，或在 config.json 里写 token')
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dsh-memo',
  }
}

async function gh(cfg, method, p, body) {
  const url = `${cfg.apiBase}/repos/${cfg.repo}/contents/${encodeURIComponent(p).replace(/%2F/g, '/')}`
  const res = await fetch(url + (method === 'GET' ? `?ref=${encodeURIComponent(cfg.branch)}` : ''), {
    method,
    headers: { ...ghHeaders(cfg), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub ${method} ${p} → ${res.status} ${await res.text()}`)
  return res.json()
}

async function ghList(cfg, p) {
  const out = await gh(cfg, 'GET', p)
  return Array.isArray(out) ? out : []
}

async function pushFile(cfg, p, content, message) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await gh(cfg, 'GET', p).catch(() => null)
    const body = {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: cfg.branch,
    }
    if (existing && existing.sha) body.sha = existing.sha
    try {
      await gh(cfg, 'PUT', p, body)
      return
    } catch (e) {
      lastErr = e
      // 422 通常是 GET 拿不到 sha（504/限流）后又撞上已存在文件：重读再写
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)))
    }
  }
  throw lastErr
}

// ── 手机笔记回流 ──────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) } catch { return { processed: {} } }
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8')
}

async function pullPhoneNotes(cfg) {
  const state = loadState()
  let dirs = []
  try {
    dirs = await ghList(cfg, `${cfg.packPrefix}/phone`)
  } catch (e) {
    console.warn('[pull] 读取手机目录失败：', e.message)
    return 0
  }
  let n = 0
  const dailyLog = path.join(workspaceDir(cfg), `${new Date().toISOString().slice(0, 10)}.md`)
  fs.mkdirSync(path.dirname(dailyLog), { recursive: true })

  for (const entry of dirs) {
    if (entry.type !== 'file' || !entry.name.endsWith('.md')) continue
    if (state.processed[entry.sha]) continue
    // 长期事实单独缓存，不进日志（否则会和 pack 重复）
    if (entry.name === 'durable.md') {
      const df = await gh(cfg, 'GET', entry.path)
      if (df?.content) {
        fs.writeFileSync(path.join(HERE, 'durable-cache.md'), Buffer.from(df.content, 'base64').toString('utf8'), 'utf8')
      }
      state.processed[entry.sha] = { path: entry.path, at: new Date().toISOString() }
      continue
    }
    const file = await gh(cfg, 'GET', entry.path)
    if (!file?.content) continue
    const text = Buffer.from(file.content, 'base64').toString('utf8').trim()
    if (text) {
      const block = `\n\n## 来自手机 · ${entry.name}\n\n${text}\n`
      fs.appendFileSync(dailyLog, block, 'utf8')
      n++
    }
    state.processed[entry.sha] = { path: entry.path, at: new Date().toISOString() }
  }
  saveState(state)
  return n
}

async function pushPack(cfg) {
  const out = path.join(ROOT, cfg.outDir)
  const files = fs.readdirSync(out).filter((f) => /\.(md|json)$/.test(f))
  for (const f of files) {
    const body = fs.readFileSync(path.join(out, f), 'utf8')
    await pushFile(cfg, `${cfg.packPrefix}/${f}`, body, `memo: update ${f}`)
    console.log(`[push] ${f}`)
  }
}

// ── 入口 ──────────────────────────────────────────────────

const cmd = process.argv[2] || 'generate'
const cfg = loadConfig()

try {
  if (cmd === 'generate') {
    const out = writePack(cfg, buildPack(cfg))
    console.log(`[generate] ${out}`)
  } else if (cmd === 'pull') {
    const n = await pullPhoneNotes(cfg)
    console.log(`[pull] 新笔记 ${n} 条`)
  } else if (cmd === 'push') {
    writePack(cfg, buildPack(cfg))
    await pushPack(cfg)
    console.log('[push] 完成')
  } else if (cmd === 'sync') {
    const n = await pullPhoneNotes(cfg)
    const out = writePack(cfg, buildPack(cfg))
    await pushPack(cfg)
    console.log(`[sync] 手机笔记 ${n} 条，记忆包已从 ${out} 推送`)
  } else {
    console.log('用法: node memo.mjs [generate|pull|push|sync]')
    process.exit(1)
  }
} catch (e) {
  console.error('[memo] 失败：', e.message)
  process.exit(1)
}
