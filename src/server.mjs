// Local recording workstation for VoiceBuilder. Zero dependencies.
//
//   npm run ui   ->  http://127.0.0.1:5180
//
// The page walks the recording list one line at a time: play the sample, record
// the take in the browser, save it, go on. This server is the thin middle:
// it lists the clips, writes the WAV the page hands over, serves the WAVs back
// for listening, runs the one-clip ASR re-check, and exposes the pipeline steps
// (check / asr / pack / publish) as finishing buttons.
//
// Binds to loopback only. The only files it will write are work/audio/<id>.wav
// (and the config), and the only commands it can run are the fixed steps in
// pipeline.mjs.
import http from 'node:http'
import { spawn } from 'node:child_process'
import {
  readFileSync, writeFileSync, existsSync, readdirSync, createReadStream, statSync, mkdirSync, unlinkSync,
} from 'node:fs'
import { join, extname, basename, resolve, relative, sep } from 'node:path'
import {
  ROOT, WORK, INBOX_DIR, REPORTS_DIR, CONFIG_PATH,
  MANIFEST_PATH, RECORDING_WORKLIST, DOCS_DIR,
  DEFAULT_MODEL, loadConfig, appPaths,
} from './paths.mjs'
import { STEPS, REPORT_NAMES } from './pipeline.mjs'
import { resolveTopic, topicFolder } from './topics.mjs'

const PORT = process.env.PORT ? Number(process.env.PORT) : 5180
const WEB_DIR = join(ROOT, 'web')

// 11 kHz / 16-bit / mono is ~22 KB/s; 8 MB is a generous ceiling for one line.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
// A document is text, not audio: 16 MiB fits a large article PDF with room to
// spare without letting a stray huge file fill the disk.
const MAX_DOC_BYTES = 16 * 1024 * 1024
const ACCEPTED_SAMPLE_RATE = 11025
const DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md', '.markdown'])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
}

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(text)
}

function readBody(req, limit = 1e6) {
  return new Promise((done, fail) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { req.destroy(); fail(new Error(`请求体超过 ${Math.round(limit / 1024 / 1024)} MB`)) }
      else chunks.push(chunk)
    })
    req.on('end', () => done(Buffer.concat(chunks)))
    req.on('error', fail)
  })
}

function listWavs(dir) {
  if (!existsSync(dir)) return new Set()
  return new Set(readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav')))
}

// ---- topics -------------------------------------------------------------------
//
// resolveTopic()/topicFolder() live in topics.mjs so they can be unit-tested for
// path-traversal safety. The helpers here are the ones that need the filesystem.
function readTopicMeta(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
  } catch {
    return null
  }
}

function listTopics() {
  const summarize = (topic) => {
    const clips = clipsPayload(topic)
    return {
      id: topic.id,
      name: topic.app ? 'App 题库' : (readTopicMeta(topic.dir)?.name || topic.id),
      app: Boolean(topic.app),
      total: clips.length,
      recorded: clips.filter((c) => c.hasRecording).length,
      withSample: clips.filter((c) => c.hasSample).length,
    }
  }
  const topics = [summarize(resolveTopic(''))]
  if (existsSync(DOCS_DIR)) {
    for (const entry of readdirSync(DOCS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const topic = topicFolder(entry.name)
      if (!topic || !existsSync(topic.worklist)) continue
      topics.push(summarize(topic))
    }
  }
  return topics
}

function readWorklist(topic) {
  if (!topic.app) {
    if (!existsSync(topic.worklist)) return []
    try {
      return JSON.parse(readFileSync(topic.worklist, 'utf8'))
    } catch {
      return []
    }
  }
  const path = existsSync(RECORDING_WORKLIST)
    ? RECORDING_WORKLIST
    : existsSync(MANIFEST_PATH) ? MANIFEST_PATH : null
  if (!path) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

function clipsPayload(topic = resolveTopic('')) {
  const clips = readWorklist(topic)
  const samples = listWavs(topic.samples)
  const recordings = listWavs(topic.audio)
  // Topic files share names with the App's, so the URL has to name its topic.
  const q = topic.id ? `?topic=${encodeURIComponent(topic.id)}` : ''
  return clips.map((clip, i) => {
    const file = clip.file || `${clip.id}.wav`
    return {
      index: i + 1,
      total: clips.length,
      id: clip.id,
      file,
      text: clip.text || '',
      group: clip.group || '',
      source: clip.source || '',
      day: clip.day ?? null,
      words: clip.words ?? null,
      estSecondsNominal: clip.estSecondsNominal ?? null,
      estSecondsMax: clip.estSecondsMax ?? null,
      estSecondsMin: clip.estSecondsMin ?? null,
      ipa: clip.ipa || '',
      wordIpa: Array.isArray(clip.wordIpa) ? clip.wordIpa : [],
      tips: Array.isArray(clip.tips) ? clip.tips : [],
      hasSample: samples.has(file),
      hasRecording: recordings.has(file),
      sampleUrl: samples.has(file) ? `/samples/${encodeURIComponent(file)}${q}` : null,
      recordingUrl: recordings.has(file) ? `/recordings/${encodeURIComponent(file)}${q}` : null,
    }
  })
}

// Probe Python/vosk once and cache - importing vosk is the slow part.
let pythonProbe = null
function probePython() {
  if (pythonProbe) return Promise.resolve(pythonProbe)
  return new Promise((done) => {
    const child = spawn('python', ['-c', 'import vosk, sys; print(sys.version.split()[0])'], { cwd: ROOT })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', () => { pythonProbe = { ok: false, detail: 'python not found' }; done(pythonProbe) })
    child.on('close', (code) => {
      pythonProbe = code === 0
        ? { ok: true, detail: `python ${out.trim()}` }
        : { ok: false, detail: out.trim() || 'vosk not installed (pip install vosk)' }
      done(pythonProbe)
    })
  })
}

async function statusPayload() {
  const config = loadConfig()
  const app = appPaths(config)
  const clips = clipsPayload()
  const py = await probePython()
  return {
    config,
    appRoot: app.appRoot,
    appRootExists: Boolean(app.appRoot && existsSync(app.appRoot)),
    lumi: { path: app.lumiFile, exists: Boolean(app.lumiFile && existsSync(app.lumiFile)) },
    banks: {
      path: app.banksDir,
      count: app.banksDir && existsSync(app.banksDir)
        ? readdirSync(app.banksDir).filter((f) => f.endsWith('.json')).length
        : 0,
    },
    total: clips.length,
    recorded: clips.filter((c) => c.hasRecording).length,
    withSample: clips.filter((c) => c.hasSample).length,
    inbox: existsSync(INBOX_DIR)
      ? readdirSync(INBOX_DIR).filter((f) => !f.startsWith('.')).length
      : 0,
    model: { path: DEFAULT_MODEL, ready: existsSync(join(DEFAULT_MODEL, 'am')) },
    python: py,
    reports: REPORT_NAMES.map((name) => ({ name, exists: existsSync(join(REPORTS_DIR, name)) })),
  }
}

function spawnStream(cmd, args, res) {
  return new Promise((done) => {
    const real = cmd === 'node' ? process.execPath : cmd
    res.write(`$ ${cmd} ${args.join(' ')}\n\n`)
    const child = spawn(real, args, { cwd: ROOT })
    child.stdout.on('data', (d) => res.write(d))
    child.stderr.on('data', (d) => res.write(d))
    child.on('error', (err) => { res.write(`[无法启动 ${cmd}：${err.message}]\n`); done(127) })
    child.on('close', (code) => done(code ?? 0))
  })
}

async function runStep(id, res) {
  const steps = STEPS.filter((s) => (id === 'full' ? ['check', 'asr', 'pack', 'publish'].includes(s.id) : s.id === id))
  if (!steps.length) return sendText(res, 404, 'unknown step')

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
  let failed = false
  for (const step of steps) {
    res.write(`\n===== ${step.label} =====\n`)
    for (const [cmd, args] of step.commands) {
      const code = await spawnStream(cmd, args, res)
      if (code !== 0) { res.write(`\n[步骤失败，退出码 ${code}]\n`); failed = true; break }
    }
    if (failed) break
  }
  res.write(failed ? '\n[流程结束：有失败，请看上面的输出]\n' : '\n[流程完成]\n')
  res.end()
}

// Run one command and collect stdout, for the per-clip ASR re-check.
function runCapture(cmd, args) {
  return new Promise((done) => {
    const real = cmd === 'node' ? process.execPath : cmd
    const child = spawn(real, args, { cwd: ROOT })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => done({ code: 127, out, err: String(e.message) }))
    child.on('close', (code) => done({ code: code ?? 0, out, err }))
  })
}

// A 44-byte RIFF header is enough to prove the page sent what it claims, so a
// stray upload can never land in the recording set as a non-playable file.
function inspectWav(buffer) {
  if (buffer.length < 44) return { ok: false, reason: '文件太短，不是 WAV' }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { ok: false, reason: '不是 RIFF/WAVE 文件' }
  }
  const channels = buffer.readUInt16LE(22)
  const sampleRate = buffer.readUInt32LE(24)
  const bits = buffer.readUInt16LE(34)
  if (channels !== 1) return { ok: false, reason: `声道数应为 1，收到 ${channels}` }
  if (bits !== 16) return { ok: false, reason: `位深应为 16，收到 ${bits}` }
  if (sampleRate !== ACCEPTED_SAMPLE_RATE) {
    return { ok: false, reason: `采样率应为 ${ACCEPTED_SAMPLE_RATE}，收到 ${sampleRate}` }
  }
  return { ok: true, sampleRate, bytes: buffer.length }
}

function findClip(id, topic = resolveTopic('')) {
  return clipsPayload(topic).find((c) => c.id === id) || null
}

// Upload a document, parse it into a topic worklist, then render its samples.
// This streams a plain-text log (upload -> parse -> IPA -> TTS) the way the
// pipeline steps do, because rendering samples for a long article takes a while.
async function createTopic(req, res, url) {
  const name = url.searchParams.get('name') || ''
  const ext = extname(name).toLowerCase()
  if (!name) return sendJson(res, 400, { ok: false, error: '缺少文件名（?name=...）' })
  if (!DOC_EXTENSIONS.has(ext)) {
    return sendJson(res, 400, { ok: false, error: `不支持的格式 ${ext || '(无扩展名)'}，只支持 PDF / docx / txt / md` })
  }

  let buffer
  try {
    buffer = await readBody(req, MAX_DOC_BYTES)
  } catch (e) {
    return sendJson(res, 413, { ok: false, error: String(e.message) })
  }
  if (!buffer.length) return sendJson(res, 400, { ok: false, error: '文件是空的' })

  mkdirSync(DOCS_DIR, { recursive: true })
  const temp = join(DOCS_DIR, `.upload-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  writeFileSync(temp, buffer)

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  })
  try {
    res.write(`收到 ${name}（${(buffer.length / 1024).toFixed(1)} KB）\n\n`)

    // 1. Parse the document into sentence-per-clip items.
    res.write('===== 解析文档、分句 =====\n')
    const parsed = await runCapture('python', ['src/doc-to-worklist.py', '--input', temp, '--name', name, '--docs-dir', DOCS_DIR])
    res.write(parsed.out)
    if (parsed.err) res.write(parsed.err)
    if (parsed.code !== 0) {
      res.write('\n[解析失败，未生成专题]\n')
      return res.end()
    }
    const summaryLine = parsed.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{')).pop()
    const summary = summaryLine ? JSON.parse(summaryLine) : null
    const topic = summary ? topicFolder(summary.slug) : null
    if (!topic || !existsSync(topic.worklist)) {
      res.write('\n[解析没有返回可用的专题目录]\n')
      return res.end()
    }

    // 2. IPA + tips (nice to have: a topic is still usable without them).
    res.write('\n===== 生成音标与发音提示 =====\n')
    const ipa = await spawnStream('python', ['src/generate-ipa.py', '--list', topic.worklist], res)
    if (ipa !== 0) res.write('[音标生成失败，不影响录音；确认已 pip install pronouncing]\n')

    // 3. Sample WAVs (also nice to have: the narrator can record without them).
    res.write('\n===== 合成示范音（Kokoro TTS，商用安全）=====\n')
    const tts = await spawnStream('python', [
      'src/tts-kokoro.py',
      '--worklist', topic.worklist,
      '--output', topic.samples,
      '--voice', 'af_heart'
    ], res)
    if (tts !== 0) res.write('[示范音合成失败，仍可录音，只是没有示范音]\n')

    res.write(`\n[完成] 专题「${summary.name}」共 ${summary.total} 句\n`)
    res.write(`[专题] ${topic.id}\n`)
    return res.end()
  } catch (err) {
    res.write(`\n[出错] ${err && err.message ? err.message : err}\n`)
    return res.end()
  } finally {
    try { unlinkSync(temp) } catch { /* already gone */ }
  }
}

function serveFile(res, filePath, headers = {}) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return sendText(res, 404, 'not found')
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    ...headers,
  })
  createReadStream(filePath).pipe(res)
}

// Only serve files whose resolved path stays inside the given folder.
function serveFrom(res, dir, name) {
  const file = basename(decodeURIComponent(name))
  const target = resolve(dir, file)
  if (target !== resolve(dir, file) || !target.startsWith(resolve(dir) + sep)) return sendText(res, 400, 'bad path')
  return serveFile(res, target)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname

  try {
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      return serveFile(res, join(WEB_DIR, 'index.html'))
    }

    // ---- data -----------------------------------------------------------------
    if (req.method === 'GET' && path === '/api/clips') {
      const session = url.searchParams.get('session') || ''
      const topic = resolveTopic(session)
      if (!topic) return sendJson(res, 404, { error: `没有这个专题：${session}` })
      const clips = clipsPayload(topic)
      return sendJson(res, 200, { clips, total: clips.length, session })
    }
    if (req.method === 'GET' && path === '/api/topics') {
      return sendJson(res, 200, { topics: listTopics() })
    }
    if (req.method === 'GET' && path === '/api/status') {
      return sendJson(res, 200, await statusPayload())
    }
    if (req.method === 'GET' && path === '/api/config') {
      return sendJson(res, 200, loadConfig())
    }
    if (req.method === 'POST' && path === '/api/config') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const config = {
        appRoot: String(body.appRoot || ''),
        ttsVoice: String(body.ttsVoice || 'Microsoft Zira Desktop'),
        sampleRate: Number(body.sampleRate) || ACCEPTED_SAMPLE_RATE,
      }
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8')
      pythonProbe = null
      return sendJson(res, 200, config)
    }
    if (req.method === 'GET' && path === '/api/steps') {
      const steps = STEPS.filter((s) => ['process-audio', 'check', 'asr', 'pack', 'publish'].includes(s.id))
        .map(({ id, label, hint }) => ({ id, label, hint }))
      return sendJson(res, 200, steps)
    }
    if (req.method === 'GET' && path === '/api/report') {
      const name = url.searchParams.get('name') || ''
      if (!REPORT_NAMES.includes(name)) return sendText(res, 400, 'unknown report')
      return serveFile(res, join(REPORTS_DIR, name))
    }

    // ---- audio ------------------------------------------------------------------
    if (req.method === 'GET' && path.startsWith('/samples/')) {
      const topic = resolveTopic(url.searchParams.get('topic') || '')
      if (!topic) return sendText(res, 404, 'not found')
      return serveFrom(res, topic.samples, path.slice('/samples/'.length))
    }
    if (req.method === 'GET' && path.startsWith('/recordings/')) {
      const topic = resolveTopic(url.searchParams.get('topic') || '')
      if (!topic) return sendText(res, 404, 'not found')
      return serveFrom(res, topic.audio, path.slice('/recordings/'.length))
    }

    // ---- recording set writes ---------------------------------------------------
    if ((req.method === 'PUT' || req.method === 'POST') && path.startsWith('/api/recordings/')) {
      const id = decodeURIComponent(path.slice('/api/recordings/'.length))
      const topic = resolveTopic(url.searchParams.get('topic') || '')
      if (!topic) return sendJson(res, 404, { ok: false, error: `没有这个专题` })
      const clip = findClip(id, topic)
      if (!clip) return sendJson(res, 404, { ok: false, error: `清单里没有 “${id}”` })
      let buffer
      try {
        buffer = await readBody(req, MAX_UPLOAD_BYTES)
      } catch (e) {
        return sendJson(res, 413, { ok: false, error: String(e.message) })
      }
      const info = inspectWav(buffer)
      if (!info.ok) return sendJson(res, 400, { ok: false, error: info.reason })
      mkdirSync(topic.audio, { recursive: true })
      const target = join(topic.audio, clip.file)
      writeFileSync(target, buffer)
      const q = topic.id ? `?topic=${encodeURIComponent(topic.id)}` : ''
      return sendJson(res, 200, {
        ok: true, id, file: clip.file, bytes: info.bytes, sampleRate: info.sampleRate,
        recordingUrl: `/recordings/${encodeURIComponent(clip.file)}${q}`,
        duration: Number(url.searchParams.get('duration') || 0) || null,
      })
    }
    if (req.method === 'DELETE' && path.startsWith('/api/recordings/')) {
      const id = decodeURIComponent(path.slice('/api/recordings/'.length))
      const topic = resolveTopic(url.searchParams.get('topic') || '')
      if (!topic) return sendJson(res, 404, { ok: false, error: `没有这个专题` })
      const clip = findClip(id, topic)
      if (!clip) return sendJson(res, 404, { ok: false, error: `清单里没有 “${id}”` })
      const target = join(topic.audio, clip.file)
      if (!existsSync(target)) return sendJson(res, 200, { ok: true, id, removed: false })
      unlinkSync(target)
      return sendJson(res, 200, { ok: true, id, removed: true })
    }

    // ---- one-clip ASR re-check ---------------------------------------------------
    if (req.method === 'POST' && path.startsWith('/api/verify/')) {
      const id = decodeURIComponent(path.slice('/api/verify/'.length))
      const topic = resolveTopic(url.searchParams.get('topic') || '')
      if (!topic) return sendJson(res, 404, { ok: false, error: `没有这个专题` })
      const clip = findClip(id, topic)
      if (!clip) return sendJson(res, 404, { ok: false, error: `清单里没有 “${id}”` })
      if (!existsSync(join(topic.audio, clip.file))) {
        return sendJson(res, 400, { ok: false, error: '还没有录音' })
      }
      if (!existsSync(join(DEFAULT_MODEL, 'am'))) {
        return sendJson(res, 400, { ok: false, error: 'ASR 模型未下载，先跑「下载 ASR 模型」' })
      }
      const args = ['src/asr-verify.py', '--only', id, '--json', '--no-report']
      if (!topic.app) args.push('--dir', topic.audio, '--list', topic.worklist)
      const { code, out, err } = await runCapture('python', args)
      const line = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{')).pop()
      if (!line) {
        return sendJson(res, 500, { ok: false, error: err.trim() || out.trim() || 'ASR 没有返回结果', code })
      }
      const parsed = JSON.parse(line)
      const row = (parsed.rows || [])[0] || null
      return sendJson(res, 200, { ok: true, clipId: id, status: row ? row.status : 'SKIP', sim: row ? row.sim : null, got: row ? row.got : '', diff: row ? row.diff : '' })
    }

    // ---- one-clip audio post-processing -----------------------------------------
    if (req.method === 'POST' && path.startsWith('/api/process-clip/')) {
      const id = decodeURIComponent(path.slice('/api/process-clip/'.length))
      const topic = resolveTopic(url.searchParams.get('topic') || '')
      if (!topic) return sendJson(res, 404, { ok: false, error: `没有这个专题` })
      const clip = findClip(id, topic)
      if (!clip) return sendJson(res, 404, { ok: false, error: `清单里没有 “${id}”` })
      if (!existsSync(join(topic.audio, clip.file))) {
        return sendJson(res, 400, { ok: false, error: '还没有录音' })
      }
      // Parse optional args from query string (RVC removed; only backup remains)
      const backup = url.searchParams.has('backup')
      const args = ['src/process-audio.py', '--dir', topic.audio, '--list', topic.worklist, '--file', clip.file, '--json']
      if (backup) args.push('--backup')
      const { code, out, err } = await runCapture('python', args)
      const line = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{')).pop()
      if (!line) {
        return sendJson(res, 500, { ok: false, error: err.trim() || out.trim() || '音频处理未返回结果', code, output: out })
      }
      const parsed = JSON.parse(line)
      // Find the result for our file
      const detail = (parsed.details || []).find((d) => d.file === clip.file) || {}
      return sendJson(res, 200, { ok: true, clipId: id, file: clip.file, status: detail.status || 'ok', error: detail.error || null, output: out })
    }

    // ---- document topics ---------------------------------------------------------
    if (req.method === 'POST' && path === '/api/docs') {
      return await createTopic(req, res, url)
    }

    // ---- import ------------------------------------------------------------------
    if (req.method === 'POST' && path === '/api/import') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
      const code = await spawnStream('python', ['src/ingest.py'], res)
      res.write(code === 0 ? '\n[导入完成]\n' : '\n[有文件未归位，请看 work/inbox 与报告]\n')
      return res.end()
    }

    // ---- pipeline steps ----------------------------------------------------------
    if (req.method === 'POST' && path.startsWith('/api/run/')) {
      return await runStep(path.slice('/api/run/'.length), res)
    }

    // ---- static web assets -------------------------------------------------------
    if (req.method === 'GET' && /^\/(audio-format|recorder|app)\.js$/.test(path)) {
      return serveFrom(res, WEB_DIR, path.slice(1))
    }

    return sendText(res, 404, 'not found')
  } catch (err) {
    return sendText(res, 500, String(err && err.stack ? err.stack : err))
  }
})

mkdirSync(WORK, { recursive: true })
server.listen(PORT, '127.0.0.1', () => {
  console.log(`VoiceBuilder 录音工作站: http://127.0.0.1:${PORT}`)
  console.log(`project: ${relative(process.cwd(), ROOT) || ROOT}`)
})
