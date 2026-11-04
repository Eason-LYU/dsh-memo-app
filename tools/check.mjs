import fs from 'node:fs'
const t = fs.readFileSync('E:/dsworkplace/dsh-memo/tools/.tok.tmp', 'utf8').trim()
const H = { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'User-Agent': 'chk' }
const repo = await fetch('https://api.github.com/repos/Eason-LYU/dsh-memo-data', { headers: H })
console.log('repo', repo.status)
const prof = await fetch('https://api.github.com/repos/Eason-LYU/dsh-memo-data/contents/pack/profile.md', { headers: H })
const pj = await prof.json()
console.log('profile', prof.status, pj.size ?? pj.message)
const idx = await fetch('https://api.github.com/repos/Eason-LYU/dsh-memo-app/contents/index.html', { headers: H })
const ij = await idx.json()
console.log('index repo size', idx.status, ij.size ?? ij.message)
