// PowerShell 脚本守卫。这两条都是本项目真踩过的坑（见 docs/pitfalls.md WF-01 / WF-02），
// 静态检查 src/*.ps1，防止回归。
//
// WF-01：PS 5.1 对无 BOM 的文件按 ANSI(CP936) 解码，含中文的 .ps1 会静默被破坏
//         （结果变 $null、报错行号错位），必须存成带 BOM 的 UTF-8。
// WF-02：PS 变量名大小写不敏感，局部变量若与参数同名（如 $worklist 与 $Worklist），
//         赋值会拿到未解析的原始字符串而不是管道结果。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const scripts = readdirSync(ROOT).filter((f) => f.endsWith('.ps1'))

test('src has PowerShell scripts to guard', () => {
  assert.ok(scripts.length > 0, 'expected src/*.ps1 to exist')
})

test('WF-01: non-ASCII .ps1 must be UTF-8 with BOM (PS 5.1 decodes no-BOM as CP936)', () => {
  for (const name of scripts) {
    const bytes = readFileSync(join(ROOT, name))
    const nonAscii = Array.from(bytes.slice(0, 4096)).some((b) => b >= 0x80)
    if (!nonAscii) continue
    const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    assert.ok(hasBom, `${name} contains non-ASCII text but has no UTF-8 BOM; re-save as "UTF-8 with BOM"`)
  }
})

test('WF-02: no local variable may shadow a parameter of the same name', () => {
  for (const name of scripts) {
    const src = readFileSync(join(ROOT, name), 'utf8').replace(/^\uFEFF/, '')
    const paramBlock = src.match(/\bparam\s*\(([\s\S]*?)\)\s*(?:\r?\n|$)/)
    if (!paramBlock) continue
    const params = Array.from(paramBlock[1].matchAll(/\$(\w+)/g), (m) => m[1].toLowerCase())
    assert.ok(params.length > 0, `${name}: param() block has no parameters?`)
    for (const p of params) {
      // 只看脚本作用域（行首无缩进）的赋值，块内 if ($x) { $x = ... } 默认值写法不算。
      const re = new RegExp(`^\\$${p}\\s*=`, 'im')
      const hit = src.match(re)
      assert.equal(hit, null,
        `${name}: line "${hit ? hit[0].trim() : ''}" assigns to $${p}, which shadows the parameter ` +
        'of the same name (PS variable names are case-insensitive). Rename the local variable.')
    }
  }
})
