// Offline recording app for the phone (packaged into an APK with Capacitor).
//
// There is no server here. The line list and the reference samples ship inside
// the app; takes are recorded with the microphone, normalised to
// 11 kHz/16-bit/mono WAV, and kept in IndexedDB so an app restart or a closed
// screen never loses work. "导出到手机" writes every take under its real file
// name into Documents/voicebuilder/ and offers a single ZIP for sharing, so the
// files can be dropped straight into work/audio/ on the desktop.
import { Recorder, audioContext } from './recorder.js'
import { TARGET_SAMPLE_RATE } from './audio-format.js'
import { createZip } from './zip.js'

const $ = (id) => document.getElementById(id)
const Capacitor = window.Capacitor
const nativePlugins = Capacitor && Capacitor.Plugins ? Capacitor.Plugins : null

const state = {
  clips: [],
  currentId: null,
  recorder: null,
  busy: false,
  meterRaf: 0,
  timerRaf: 0,
  meterSource: null,
  wakeLock: null,
}

const player = new Audio()
player.preload = 'none'

// ------------------------------------------------------------------ IndexedDB

let dbPromise = null
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('voicebuilder', 1)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains('takes')) database.createObjectStore('takes')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

async function tx(mode, run) {
  const database = await db()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('takes', mode)
    const store = transaction.objectStore('takes')
    const request = run(store)
    transaction.oncomplete = () => resolve(request ? request.result : undefined)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

const putTake = (id, buffer) => tx('readwrite', (s) => s.put(buffer, id))
const getTake = (id) => tx('readonly', (s) => s.get(id))
const deleteTake = (id) => tx('readwrite', (s) => s.delete(id))
const takeIds = () => tx('readonly', (s) => s.getAllKeys())

// ---------------------------------------------------------------------- helpers

function toast(message, ms = 2200) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), ms)
}

function setStatus(kind, title, detail = '') {
  const el = $('status')
  el.className = `status ${kind}`
  el.innerHTML = `<div class="t"></div>${detail ? '<div class="d"></div>' : ''}`
  el.querySelector('.t').textContent = title
  if (detail) el.querySelector('.d').textContent = detail
}

function clearStatus() {
  $('status').className = 'status hidden'
  $('status').innerHTML = ''
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

// ------------------------------------------------------------------- rendering

const current = () => state.clips.find((c) => c.id === state.currentId) || null

function render() {
  const clip = current()
  const done = state.clips.filter((c) => c.hasTake).length
  $('counter').textContent = `${done} / ${state.clips.length}`
  $('fill').style.width = state.clips.length ? `${(done / state.clips.length) * 100}%` : '0'

  if (!clip) {
    $('line').textContent = state.clips.length ? '都录完了。' : '没有清单数据。'
    return
  }

  $('line').textContent = clip.text
  $('file').textContent = clip.file
  $('chip-index').textContent = `第 ${clip.index} / ${clip.total} 条`
  $('chip-group').textContent = clip.group || '—'
  const badge = $('chip-state')
  badge.classList.remove('hidden')
  badge.className = `chip ${clip.hasTake ? 'done' : 'plain'}`
  badge.textContent = clip.hasTake ? '已录' : '未录'

  $('btn-mine').disabled = !clip.hasTake
  $('btn-sample').disabled = !clip.sample
  $('btn-prev').disabled = indexOf(state.currentId) <= 0
  $('btn-next').disabled = indexOf(state.currentId) >= state.clips.length - 1
}

const indexOf = (id) => state.clips.findIndex((c) => c.id === id)

function select(id, { keepStatus = false } = {}) {
  if (!keepStatus) clearStatus()
  player.pause()
  state.currentId = id
  localStorage.setItem('vb.mobile.lastId', id)
  render()
}

function go(delta) {
  const at = indexOf(state.currentId)
  const next = state.clips[at + delta]
  if (next) select(next.id)
}

function goUnrecorded() {
  const at = indexOf(state.currentId)
  const next = state.clips.slice(at + 1).find((c) => !c.hasTake) || state.clips.find((c) => !c.hasTake)
  if (next) select(next.id)
  else toast('89 条都录完了')
}

// --------------------------------------------------------------------- playback

function playSample() {
  const clip = current()
  if (!clip || !clip.sample) return
  player.pause()
  player.src = clip.sample
  player.play().catch((e) => setStatus('bad', '播放失败', String(e.message || e)))
}

async function playMine() {
  const clip = current()
  if (!clip) return
  const buffer = await getTake(clip.id)
  if (!buffer) return
  player.pause()
  player.src = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
  player.play().catch((e) => setStatus('bad', '播放失败', String(e.message || e)))
}

// -------------------------------------------------------------------- recording

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen')
  } catch { /* not fatal: the screen may just sleep */ }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {})
    state.wakeLock = null
  }
}

function startMeter(stream) {
  const ctx = audioContext()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  state.meterSource = source
  const data = new Uint8Array(analyser.fftSize)
  const tick = () => {
    analyser.getByteTimeDomainData(data)
    let peak = 0
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128)
    $('meter').style.width = `${Math.min(100, peak * 140)}%`
    $('meter').style.background = peak > 0.98 ? 'var(--bad)' : peak < 0.02 ? 'var(--warn)' : 'var(--good)'
    state.meterRaf = requestAnimationFrame(tick)
  }
  state.meterRaf = requestAnimationFrame(tick)
}

function stopMeter() {
  cancelAnimationFrame(state.meterRaf)
  if (state.meterSource) state.meterSource.disconnect()
  state.meterSource = null
  $('meter').style.width = '0%'
}

function startTimer() {
  const started = performance.now()
  const tick = () => {
    $('timer').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`
    state.timerRaf = requestAnimationFrame(tick)
  }
  state.timerRaf = requestAnimationFrame(tick)
}

function stopTimer() { cancelAnimationFrame(state.timerRaf) }

async function startRecord() {
  const clip = current()
  if (!clip || state.busy) return
  state.busy = true
  player.pause()
  $('rec-label').textContent = '准备中…'
  try {
    state.recorder = new Recorder({})
    await state.recorder.start()
    startMeter(state.recorder.stream)
    startTimer()
    requestWakeLock()
    $('btn-rec').classList.add('on')
    $('rec-label').textContent = '停止'
    $('btn-sample').disabled = true
    $('btn-mine').disabled = true
    setStatus('warn', '录音中…', '读完这句，点一下停止。')
    state.busy = false
  } catch (err) {
    state.busy = false
    stopMeter()
    stopTimer()
    $('rec-label').textContent = '开始录音'
    const message = err && err.name === 'NotAllowedError'
      ? '麦克风权限被拒绝：到手机的「设置 → 应用 → VoiceBuilder → 权限」里允许麦克风。'
      : String(err && err.message ? err.message : err)
    setStatus('bad', '无法开始录音', message)
  }
}

async function stopRecord() {
  if (!state.recorder || !state.recorder.recording) return
  state.busy = true
  $('rec-label').textContent = '保存中…'
  stopMeter()
  stopTimer()
  releaseWakeLock()

  let result
  try {
    result = await state.recorder.stop()
  } catch (err) {
    state.busy = false
    resetRecButton()
    return setStatus('bad', '录音失败', String(err.message || err))
  }
  state.recorder = null

  const clip = current()
  await putTake(clip.id, result.wav)
  clip.hasTake = true

  $('timer').textContent = `${result.duration.toFixed(1)}s`
  resetRecButton()
  state.busy = false

  const seconds = result.duration.toFixed(1)
  if (result.peak < 0.02) {
    setStatus('warn', `已保存，但几乎没有声音（${seconds}s）`, '确认没挡住麦克风，点「开始录音」重录。')
  } else if (result.peak >= 0.999) {
    setStatus('warn', `已保存，可能有爆音（${seconds}s）`, '离麦克风远一点再录会更干净。')
  } else {
    setStatus('good', `已保存 ${clip.file}（${seconds}s）`, '')
  }
  render()
}

function resetRecButton() {
  $('btn-rec').classList.remove('on')
  $('rec-label').textContent = '开始录音'
  const clip = current()
  $('btn-sample').disabled = !clip || !clip.sample
  $('btn-mine').disabled = !clip || !clip.hasTake
}

function toggleRecord() {
  if (!state.busy && state.recorder && state.recorder.recording) return stopRecord()
  if (!state.busy) return startRecord()
}

// ------------------------------------------------------------------------ list

function openList() {
  const list = $('list')
  list.innerHTML = ''
  state.clips.forEach((clip) => {
    const row = document.createElement('div')
    row.className = `item${clip.id === state.currentId ? ' current' : ''}`
    const number = document.createElement('div')
    number.className = 'n'
    number.textContent = clip.index
    const text = document.createElement('div')
    text.className = 'txt'
    text.textContent = clip.text
    const small = document.createElement('small')
    small.textContent = clip.group || ''
    text.appendChild(small)
    const flag = document.createElement('div')
    flag.className = `flag ${clip.hasTake ? 'on' : 'off'}`
    flag.textContent = clip.hasTake ? '已录' : '未录'
    row.append(number, text, flag)
    row.addEventListener('click', () => {
      select(clip.id)
      closeList()
    })
    list.appendChild(row)
  })
  $('sheet').classList.remove('hidden')
}

function closeList() { $('sheet').classList.add('hidden') }

// ---------------------------------------------------------------------- export

async function exportAll() {
  const clips = state.clips.filter((c) => c.hasTake)
  if (!clips.length) return toast('还没有任何录音')

  $('btn-export').disabled = true
  const files = []
  let bytes = 0
  try {
    for (const clip of clips) {
      const buffer = await getTake(clip.id)
      if (!buffer) continue
      files.push({ name: clip.file, data: new Uint8Array(buffer) })
      bytes += buffer.byteLength
    }

    const mb = (bytes / 1048576).toFixed(1)
    let wroteFolder = 0

    // Native: drop each WAV into Documents/voicebuilder/ under its real name, so
    // the phone's file manager can copy the folder straight into work/audio/.
    if (nativePlugins && nativePlugins.Filesystem) {
      const { Filesystem } = nativePlugins
      for (const file of files) {
        try {
          await Filesystem.writeFile({
            path: `voicebuilder/${file.name}`,
            data: bytesToBase64(file.data),
            directory: 'DOCUMENTS',
            recursive: true,
          })
          wroteFolder++
        } catch { /* first failure aborts below with a clear message */ }
      }
      if (!wroteFolder) {
        try {
          await Filesystem.writeFile({
            path: 'voicebuilder-recordings.zip',
            data: bytesToBase64(createZip(files)),
            directory: 'CACHE',
            recursive: true,
          })
        } catch { /* ignore, share step below reports */ }
      }
    }

    // Always offer the single ZIP too: one attachment is far easier to send.
    const zip = createZip(files)
    const zipName = 'voicebuilder-recordings.zip'
    let shared = false
    if (nativePlugins && nativePlugins.Filesystem && nativePlugins.Share) {
      try {
        const written = await nativePlugins.Filesystem.writeFile({
          path: zipName,
          data: bytesToBase64(zip),
          directory: 'CACHE',
        })
        await nativePlugins.Share.share({
          title: 'VoiceBuilder 录音',
          text: `${files.length} 条录音（${mb} MB）`,
          files: [written.uri],
        })
        shared = true
      } catch { /* fall through to the browser download path */ }
    }

    if (!shared) {
      const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = zipName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    }

    setStatus('good', `已导出 ${files.length} 条（${mb} MB）`,
      wroteFolder
        ? `已写入手机 Documents/voicebuilder/（${wroteFolder} 个 .wav），并生成 ZIP 供分享。`
        : '已生成 ZIP。若手机没弹分享框，可在文件管理里找 Downloads。')
  } catch (err) {
    setStatus('bad', '导出失败', String(err.message || err))
  } finally {
    $('btn-export').disabled = false
  }
}

// ---------------------------------------------------------------------- wiring

$('btn-rec').addEventListener('click', toggleRecord)
$('btn-sample').addEventListener('click', playSample)
$('btn-mine').addEventListener('click', playMine)
$('btn-prev').addEventListener('click', () => go(-1))
$('btn-next').addEventListener('click', () => go(1))
$('btn-unrecorded').addEventListener('click', goUnrecorded)
$('btn-list').addEventListener('click', openList)
$('btn-close').addEventListener('click', closeList)
$('sheet').addEventListener('click', (event) => { if (event.target.id === 'sheet') closeList() })
$('btn-export').addEventListener('click', exportAll)

async function boot() {
  const response = await fetch('./worklist.json')
  const data = await response.json()
  const ids = await takeIds()
  const have = new Set(ids)

  state.clips = data.map((clip) => ({ ...clip, hasTake: have.has(clip.id) }))

  const last = localStorage.getItem('vb.mobile.lastId')
  if (last && state.clips.some((c) => c.id === last)) state.currentId = last
  else state.currentId = state.clips.length ? state.clips[0].id : null

  render()

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('bad', '这个环境不支持录音', '需要 Android WebView 里带麦克风权限运行。')
  } else if (state.clips.every((c) => c.hasTake)) {
    setStatus('good', `${state.clips.length} 条都录完了`, '点「导出到手机」把录音取回电脑。')
  } else {
    setStatus('good', '准备好了', '点「播放示范」听一句，再点「开始录音」跟着念。')
  }
}

boot().catch((err) => setStatus('bad', '载入失败', String(err.message || err)))
