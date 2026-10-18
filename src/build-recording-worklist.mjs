/**
 * Builds the recording worklist for a human narrator.
 *
 * Derives the exact ids and file names the pipeline expects (Lumi lines read
 * from the App's LUMI-VOICE-LINES.md + the listening items from
 * work/listening-worklist.json), so a recorded WAV simply drops into
 * work/audio/ under the right name.
 *
 * Outputs (under work/):
 *   recording-worklist.json
 *   recording-worklist.csv   (UTF-8 BOM so Excel shows text right)
 *   RECORDING-GUIDE.md
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { WORK, AUDIO_DIR, SAMPLES_DIR, INBOX_DIR, loadConfig, appPaths } from './paths.mjs'

const TARGET_RATE = 11025
const TARGET_BITS = 16
const TARGET_CHANNELS = 1

const app = appPaths(loadConfig())
const LUMI_FILE = app.lumiFile
const LISTENING_FILE = join(WORK, 'listening-worklist.json')

if (!app.appRoot || !existsSync(LUMI_FILE)) {
  throw new Error(`App LUMI-VOICE-LINES.md not found. Set "appRoot" in voicebuilder.config.json. Tried: ${LUMI_FILE || '(empty)'}`)
}
if (!existsSync(LISTENING_FILE)) throw new Error(`Missing ${LISTENING_FILE} (run build-listening-worklist first)`)

const wordsIn = (text) => (text.match(/[A-Za-z\u2019']+/g) || []).length
const estimateSeconds = (words) => ({
  min: Math.max(0.6, words / 3.8),
  nominal: Math.max(0.7, words / 2.2),
  max: words / 1.4 + 2.5,
})

const items = []

const lumiText = readFileSync(LUMI_FILE, 'utf8')
const lumiRow = /^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|.*$/gm
let m
while ((m = lumiRow.exec(lumiText)) !== null) {
  const mdId = m[1].trim()
  const text = m[2].trim()
  if (!text || /^English line/i.test(text)) continue
  items.push({ id: `lumi-${mdId}`, group: 'Lumi 台词', source: 'LUMI-VOICE-LINES.md', day: null, text })
}

for (const entry of JSON.parse(readFileSync(LISTENING_FILE, 'utf8'))) {
  items.push({ id: entry.id, group: entry.source, source: entry.source, day: entry.day ?? null, text: entry.text })
}

const seen = new Set()
for (const item of items) {
  if (seen.has(item.id)) throw new Error(`duplicate id: ${item.id}`)
  seen.add(item.id)
  item.file = `${item.id}.wav`
  item.words = wordsIn(item.text)
  const est = estimateSeconds(item.words)
  item.estSecondsMin = Number(est.min.toFixed(1))
  item.estSecondsNominal = Number(est.nominal.toFixed(1))
  item.estSecondsMax = Number(est.max.toFixed(1))
}

const ordered = items.map((item, i) => ({ index: i + 1, ...item }))

mkdirSync(WORK, { recursive: true })
writeFileSync(join(WORK, 'recording-worklist.json'), JSON.stringify(ordered, null, 2) + '\n', 'utf8')

const csvEscape = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = [
  ['序号', 'id', '文件名', '分组', '天', '英文文本（只录这一列）', '词数', '预估时长(秒)'],
  ...ordered.map((it) => [
    it.index, it.id, it.file, it.group, it.day ?? '', it.text, it.words,
    `${it.estSecondsMin}-${it.estSecondsMax}`,
  ]),
].map((row) => row.map(csvEscape).join(',')).join('\n')
writeFileSync(join(WORK, 'recording-worklist.csv'), '\uFEFF' + csv + '\n', 'utf8')

const byGroup = ordered.reduce((acc, it) => { acc[it.group] = (acc[it.group] || 0) + 1; return acc }, {})

writeFileSync(
  join(WORK, 'RECORDING-GUIDE.md'),
  [
    '# 真人录音工作清单',
    '',
    '由 `node src/build-recording-worklist.mjs` 生成（或在 VoiceBuilder 网页里点「生成工作清单」）。',
    '',
    `共 **${ordered.length}** 条：${Object.entries(byGroup).map(([g, n]) => `${g} ${n}`).join('、')}。总词数约 ${ordered.reduce((n, i) => n + i.words, 0)}。`,
    '',
    '## 你要录什么',
    '',
    '打开 `recording-worklist.csv`（或 `recording-worklist.json`），**只朗读「英文文本」列**。',
    '不要读 id、文件名或中文参考。逐条录成单独文件，文件名必须**逐字等于「文件名」列**（如 `lumi-lumi-task-welcome.wav`）。',
    '',
    '录音方向（与 LUMI-VOICE-LINES.md 一致）：温暖、清楚、好奇、轻微俏皮；语速自然，方便小学生跟读。',
    '',
    '## 目标格式',
    '',
    `- ${TARGET_RATE} Hz / ${TARGET_BITS}-bit / ${TARGET_CHANNELS === 1 ? '单声道' : TARGET_CHANNELS + ' 声道'} WAV，放进 \`work/audio/\``,
    '- 理由：小程序总包 20 MB、音频分包每个 <2 MB；高采样率会让分包超限并失败',
    '',
    '**不用自己转码，也不用装 ffmpeg**：下面第 1、2 种方式都会自动转成上面的格式。',
    '',
    '## 怎么录（三选一）',
    '',
    '1. **网页逐句直录（推荐）**：`npm run ui` 打开 http://127.0.0.1:5180。',
    '   每一条先播示范音（`work/samples/`），你照着念，停止后自动转码并保存成清单里的文件名。',
    '   快捷键：`空格` 录/停、`S` 听示范、`P` 听自己的、`←` `→` 切换、`Enter` 下一条。',
    '2. **手机/录音笔录完批量导入**：把原始文件（m4a / mp3 / wav 都行）丢进 `work/inbox/`，',
    '   再点网页的「导入原始录音」（或 `npm run import`）。文件名没规律也能认：',
    '   会离线转写并与清单逐条比对，最像哪条就是哪条；**不确定的不会瞎猜**，',
    '   留在 inbox 里并在 `work/reports/recording-ingest.md` 里列出。',
    '3. **自己转好再放进去**：把 WAV 直接放进 `work/audio/`，文件名逐字等于清单的「文件名」列。',
    '',
    '## 录完后的步骤',
    '',
    '1. 机械校验：网页「机械校验」（或 `npm run check`）——齐全、命名、格式、静音、爆音、时长。',
    '2. 内容校验（离线 ASR）：网页「内容校验」（或 `npm run verify-asr`）。首次要先 `npm run model`。',
    '3. 人工试听：网页按 `P` 听，或直接听 `work/audio/` 里的文件。**ASR 只是第二意见，不是判决**。',
    '4. 交给 App：网页「一键收尾」，或依次「打包小程序分包」+「发布到 PWA」。',
    '',
    '> 打开网页里的「保存后自动做内容校验」，可以录一条确认一条。',
    '',
    '## 谁录的很重要',
    '',
    '- 你自己录：你同时是表演者与录音制作者，权利自有；若运营主体是公司/个体户，请书面把权利授权给主体。',
    '- 家人或外包录：必须签**表演者权 + 录音制作者权**的许可/转让协议。',
    '- 只对**同一个人的声音**做降噪/响度/剪口误是安全的；**换音色/克隆声音**会落入深度合成与 AI 标识范畴，别做。',
    '',
    '> 三个目录：成品 `' + AUDIO_DIR.replace(/\\/g, '/') + '`、示范音 `' + SAMPLES_DIR.replace(/\\/g, '/') + '`、待导入 `' + INBOX_DIR.replace(/\\/g, '/') + '`',
    '',
  ].join('\n'),
  'utf8',
)

console.log(`Recording worklist: ${ordered.length} clips (${Object.keys(byGroup).length} groups)`)
for (const [g, n] of Object.entries(byGroup)) console.log(`  ${g.padEnd(40)} ${n}`)
console.log(`  words: ${ordered.reduce((n, i) => n + i.words, 0)}`)
console.log('Wrote work/recording-worklist.json / .csv / RECORDING-GUIDE.md')
