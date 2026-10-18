#!/usr/bin/env node
// 检查 AGENTS.md 里 skill 路由表引用的 skill 名，本机是否真的装着。
// 用法：node tools/check-skills.cjs [--file AGENTS.md]
// 只检查标题里含 "Skill" 的章节中的表格行。
// 找不到的名字退出码为 1。「不要用」列里的名字是弃用/已删的 skill，
// 不要求安装，也不影响退出码（G-0018：提示与退出码曾互相矛盾）。

const fs = require('fs')
const path = require('path')
const os = require('os')

const args = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
const file = fileIdx >= 0 ? args[fileIdx + 1] : 'AGENTS.md'

const roots = [
  path.join(os.homedir(), '.agents', 'skills'),
  path.join(os.homedir(), '.config', 'opencode', 'skills'),
  path.join(os.homedir(), '.claude', 'skills'),
  path.join(process.cwd(), '.agents', 'skills'),
  path.join(process.cwd(), '.opencode', 'skills'),
  path.join(process.cwd(), '.claude', 'skills'),
]

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}

// 与 opencode 的发现规则一致：必须有 frontmatter、name 和 description。
// name 可能与目录名不同（gstack-* 系列如此），两种名字都算已安装。
const installed = new Set()
const invalid = []
for (const root of roots) {
  if (!fs.existsSync(root)) continue
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const file = path.join(root, dir.name, 'SKILL.md')
    if (!fs.existsSync(file)) { invalid.push(`${dir.name}: 缺少 SKILL.md`); continue }
    const fm = frontmatter(fs.readFileSync(file, 'utf8'))
    if (!fm || !fm.name) { invalid.push(`${dir.name}: frontmatter 缺 name，会被过滤`); continue }
    if (!fm.description) { invalid.push(`${dir.name}: 缺 description，永远不会被自动选中`); continue }
    installed.add(dir.name)
    installed.add(fm.name)
  }
}

console.log(`本机可用 skill：${installed.size} 个（含别名）`)
if (invalid.length) {
  console.log('\n无效的 skill：')
  for (const s of invalid) console.log(`  - ${s}`)
}

if (!fs.existsSync(file)) {
  console.log(`\n找不到 ${file}，跳过路由检查`)
  process.exit(invalid.length ? 1 : 0)
}

// 只取标题里含 "Skill" 的章节中的表格行，按 | 列解析。
// 表头里含「不要用」的那一列是弃用清单：只出现在那里的名字不算 missing。
const names = new Set() // 需要本机已安装的名字
const avoided = new Set() // 「不要用」列里的名字，不要求安装
let inSkillSection = false
let colAvoid = -1 // 当前表格「不要用」列的下标，-1 = 没有这一列
let prevWasRow = false
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const h = /^#{1,6}\s+(.*)$/.exec(line)
  if (h) { inSkillSection = /skill/i.test(h[1]); prevWasRow = false; continue }
  if (!inSkillSection || !line.trim().startsWith('|')) { prevWasRow = false; continue }
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  if (!prevWasRow) colAvoid = cells.findIndex((c) => c.includes('不要用')) // 表头行定列
  prevWasRow = true
  cells.forEach((cell, i) => {
    const target = i === colAvoid ? avoided : names
    for (const m of cell.matchAll(/`([a-z0-9][a-z0-9-]*)`/g)) target.add(m[1])
  })
}

const missing = [...names].filter((n) => !installed.has(n)).sort()
console.log(`\n${file} 的 skill 路由表引用了 ${names.size} 个 skill，本机未找到 ${missing.length} 个`)
for (const n of missing) console.log(`  - ${n}`)
const avoidedMissing = [...avoided].filter((n) => !names.has(n) && !installed.has(n)).sort()
if (avoidedMissing.length) {
  // 前缀用 · 不用 -：G-0018 守卫把 "  - " 开头的行都当作违规，这里不能踩中
  console.log(`「不要用」列里的 ${avoidedMissing.length} 个名字本机未安装（弃用/已删，预期如此）：`)
  for (const n of avoidedMissing) console.log(`  · ${n}`)
}

const bad = missing.length > 0 || invalid.length > 0
console.log(bad ? '\n有问题，需要修正' : '\n全部通过')
process.exit(bad ? 1 : 0)
