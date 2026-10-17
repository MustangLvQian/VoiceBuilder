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
import { WORK, AUDIO_DIR, loadConfig, appPaths } from './paths.mjs'

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
    '原始录音可以先用手机或麦克风用较高音质录，再统一转换。ffmpeg 示例：',
    '',
    '```',
    `ffmpeg -i in.wav -ac 1 -ar ${TARGET_RATE} -sample_fmt s16 work/audio/文件名.wav`,
    '```',
    '',
    '## 录完后的步骤',
    '',
    '1. 把全部 WAV 放进 `work/audio/`，文件名与清单一致。',
    '2. 机械校验：网页点「机械校验」（或 `npm run check`）。',
    '3. 内容校验（离线 ASR）：网页点「内容校验」（或 `npm run verify-asr`）。首次要先 `npm run model`。',
    '4. 人工试听：网页的「试听」区，或 `work/audio/` 里的文件。',
    '5. 交给 App：网页点「打包小程序分包」+「发布到 PWA」。',
    '',
    '> 建议对**原始高采样率录音**直接跑 ASR（准确率更高），确认无误后再转成 11 kHz。',
    '',
    '## 谁录的很重要',
    '',
    '- 你自己录：你同时是表演者与录音制作者，权利自有；若运营主体是公司/个体户，请书面把权利授权给主体。',
    '- 家人或外包录：必须签**表演者权 + 录音制作者权**的许可/转让协议。',
    '- 只对**同一个人的声音**做降噪/响度/剪口误是安全的；**换音色/克隆声音**会落入深度合成与 AI 标识范畴，别做。',
    '',
    '> 音频目录 `AUDIO_DIR` 当前为：`' + AUDIO_DIR.replace(/\\/g, '/') + '`',
    '',
  ].join('\n'),
  'utf8',
)

console.log(`Recording worklist: ${ordered.length} clips (${Object.keys(byGroup).length} groups)`)
for (const [g, n] of Object.entries(byGroup)) console.log(`  ${g.padEnd(40)} ${n}`)
console.log(`  words: ${ordered.reduce((n, i) => n + i.words, 0)}`)
console.log('Wrote work/recording-worklist.json / .csv / RECORDING-GUIDE.md')
