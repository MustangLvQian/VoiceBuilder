// Local web UI for VoiceBuilder. Zero dependencies.
//
//   npm run ui   ->  http://127.0.0.1:5180
//
// It edits voicebuilder.config.json, runs the pipeline steps and streams their
// output, serves the produced WAVs for listening, and shows the check reports.
// It binds to loopback only and can only run the fixed steps in pipeline.mjs.
import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync, createReadStream, statSync, mkdirSync } from 'node:fs'
import { join, extname, basename, resolve, relative } from 'node:path'
import {
  ROOT, WORK, AUDIO_DIR, MODELS_DIR, REPORTS_DIR, CONFIG_PATH,
  MANIFEST_PATH, LISTENING_WORKLIST, DEFAULT_MODEL, loadConfig, appPaths,
} from './paths.mjs'
import { STEPS, FULL_PIPELINE, REPORT_NAMES } from './pipeline.mjs'

const PORT = process.env.PORT ? Number(process.env.PORT) : 5180
const WEB_DIR = join(ROOT, 'web')

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wav': 'audio/wav' }

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(text)
}

function readBody(req) {
  return new Promise((done) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk; if (data.length > 1e6) req.destroy() })
    req.on('end', () => done(data))
  })
}

function countWavs(dir) {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav')).length
}

function readManifest() {
  const path = existsSync(MANIFEST_PATH) ? MANIFEST_PATH : join(WORK, 'recording-worklist.json')
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

// Probe Python/vosk once and cache: importing vosk is the slow part.
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
  const modelPath = DEFAULT_MODEL
  const manifest = readManifest()
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
    worklists: existsSync(LISTENING_WORKLIST),
    manifestCount: manifest.length,
    audioCount: countWavs(AUDIO_DIR),
    model: { path: modelPath, ready: existsSync(join(modelPath, 'am')) },
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
  const queue = id === 'full' ? FULL_PIPELINE : [id]
  if (id !== 'full' && !STEPS.some((s) => s.id === id)) return sendText(res, 404, 'unknown step')

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
  let failed = false
  for (const sid of queue) {
    const step = STEPS.find((s) => s.id === sid)
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

function serveFile(res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return sendText(res, 404, 'not found')
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  createReadStream(filePath).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname

  try {
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      return serveFile(res, join(WEB_DIR, 'index.html'))
    }
    if (req.method === 'GET' && path === '/api/status') {
      return sendJson(res, 200, await statusPayload())
    }
    if (req.method === 'GET' && path === '/api/config') {
      return sendJson(res, 200, loadConfig())
    }
    if (req.method === 'GET' && path === '/api/steps') {
      const steps = STEPS.map(({ id, label, hint }) => ({ id, label, hint }))
      steps.push({ id: 'full', label: '一键全流程', hint: '清单 → 机械校验 → 内容校验 → 打包 → 发布（不含 TTS）', full: true })
      return sendJson(res, 200, steps)
    }
    if (req.method === 'POST' && path === '/api/config') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const config = {
        appRoot: String(body.appRoot || ''),
        ttsVoice: String(body.ttsVoice || 'Microsoft Zira Desktop'),
        sampleRate: Number(body.sampleRate) || 11025,
      }
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8')
      pythonProbe = null
      return sendJson(res, 200, config)
    }
    if (req.method === 'GET' && path === '/api/manifest') {
      return sendJson(res, 200, readManifest())
    }
    if (req.method === 'GET' && path === '/api/report') {
      const name = url.searchParams.get('name') || ''
      if (!REPORT_NAMES.includes(name)) return sendText(res, 400, 'unknown report')
      return serveFile(res, join(REPORTS_DIR, name))
    }
    if (req.method === 'GET' && path.startsWith('/audio/')) {
      const file = basename(decodeURIComponent(path.slice('/audio/'.length)))
      return serveFile(res, join(AUDIO_DIR, file))
    }
    if (req.method === 'POST' && path.startsWith('/api/run/')) {
      return await runStep(path.slice('/api/run/'.length), res)
    }
    return sendText(res, 404, 'not found')
  } catch (err) {
    return sendText(res, 500, String(err && err.stack ? err.stack : err))
  }
})

mkdirSync(WORK, { recursive: true })
server.listen(PORT, '127.0.0.1', () => {
  console.log(`VoiceBuilder UI: http://127.0.0.1:${PORT}`)
  console.log(`project: ${relative(process.cwd(), ROOT) || ROOT}`)
})
