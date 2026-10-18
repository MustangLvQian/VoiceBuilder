// Recording workstation logic. Talks to server.mjs, records through recorder.js.
import { Recorder, listMicrophones, audioContext } from '/recorder.js'

const $ = (id) => document.getElementById(id)
const state = {
  clips: [],
  currentId: null,
  topic: '',             // '' = the App's own list; otherwise a work/docs/<slug> id
  recorder: null,
  taking: null,          // WAV result held while the user decides
  busy: false,
  meter: { raf: 0, source: null, analyser: null },
}

// Each list remembers its own position, so switching to a topic and back does
// not jump the App list to a sentence you have never seen.
function lastIdKey(topic = state.topic) {
  return topic ? `vb.lastId.${topic}` : 'vb.lastId'
}

const settings = loadSettings()
const player = new Audio()

function loadSettings() {
  try {
    return Object.assign({ autoSave: true, autoVerify: false, deviceId: '' },
      JSON.parse(localStorage.getItem('vb.settings') || '{}'))
  } catch {
    return { autoSave: true, autoVerify: false, deviceId: '' }
  }
}
function saveSettings() {
  localStorage.setItem('vb.settings', JSON.stringify(settings))
}

async function api(path, options) {
  const res = await fetch(path, options)
  const type = res.headers.get('content-type') || ''
  const body = type.includes('json') ? await res.json() : await res.text()
  return { ok: res.ok, status: res.status, body }
}

// Topic-scoped endpoints carry the topic in a query param, matching the server.
function topicQuery(topic = state.topic) {
  return topic ? `?topic=${encodeURIComponent(topic)}` : ''
}

// ---------------------------------------------------------------- list & render

function visible() {
  return $('only-unrecorded').checked ? state.clips.filter((c) => !c.hasRecording) : state.clips
}

function current() {
  return state.clips.find((c) => c.id === state.currentId) || null
}

function render() {
  const clip = current()
  const recorded = state.clips.filter((c) => c.hasRecording).length
  $('progress-label').textContent = `已录 ${recorded} / ${state.clips.length}`
  $('progress-fill').style.width = state.clips.length ? `${recorded / state.clips.length * 100}%` : '0'

  if (!clip) {
    const grid = $('clip-line-grid')
    if (grid) {
      grid.innerHTML = ''
      const empty = document.createElement('div')
      empty.className = 'line-text empty'
      empty.textContent = state.clips.length ? '这一条都不剩了。' : '清单为空，先跑「生成工作清单」。'
      grid.appendChild(empty)
    }
    $('clip-index').textContent = '—'
    $('clip-group').textContent = '—'
    $('clip-file').textContent = '—'
    $('clip-state').classList.add('hidden')
    $('btn-sample').disabled = true
    $('btn-mine').disabled = true
    $('btn-rec').disabled = true
    return
  }

  $('clip-index').textContent = `第 ${clip.index} / ${clip.total} 条`
  $('clip-group').textContent = clip.group || '—'
  $('clip-file').textContent = clip.file

  // Render word-by-word grid: IPA above, word below.
  const grid = $('clip-line-grid')
  if (grid) {
    grid.innerHTML = ''
    const text = clip.text || ''
    const words = text.match(/[A-Za-z'\u2019]+|[^\sA-Za-z'\u2019]+/g) || []
    const wordIpa = Array.isArray(clip.wordIpa) ? clip.wordIpa : []
    let ipaIdx = 0
    for (const token of words) {
      const isWord = /^[A-Za-z'\u2019]+$/.test(token)
      const cell = document.createElement('span')
      cell.className = 'word-cell' + (isWord ? '' : ' punct')
      const ipaSpan = document.createElement('span')
      ipaSpan.className = 'ipa-above'
      if (isWord && ipaIdx < wordIpa.length) {
        // Wrap each word's IPA in square brackets, e.g. [həˈloʊ]. The worklist
        // stores raw IPA (or "[word]" for words missing from the CMU dict), so
        // only add brackets when they are not already there.
        const ipa = String(wordIpa[ipaIdx])
        ipaSpan.textContent = /^\[.*\]$/.test(ipa) ? ipa : `[${ipa}]`
        ipaIdx++
      } else {
        ipaSpan.textContent = '·'
      }
      const wordSpan = document.createElement('span')
      wordSpan.className = 'word-below'
      wordSpan.textContent = token
      cell.appendChild(ipaSpan)
      cell.appendChild(wordSpan)
      grid.appendChild(cell)
    }
  }

  const tipsWrap = $('clip-tips')
  const tipsList = $('clip-tips-list')
  if (tipsWrap && tipsList) {
    tipsList.innerHTML = ''
    if (Array.isArray(clip.tips) && clip.tips.length) {
      for (const t of clip.tips) {
        const li = document.createElement('li')
        li.textContent = t
        tipsList.appendChild(li)
      }
      tipsWrap.classList.remove('hidden')
    } else {
      tipsWrap.classList.add('hidden')
    }
  }

  const badge = $('clip-state')
  badge.classList.remove('hidden')
  badge.textContent = clip.hasRecording ? '已录' : clip.hasSample ? '待录 · 有示范' : '待录 · 无示范'
  badge.style.background = clip.hasRecording ? 'var(--good-soft)' : 'var(--line)'
  badge.style.color = clip.hasRecording ? 'var(--good)' : 'var(--ink-soft)'

  // While a take is in flight, playback would leak into the recording.
  const recording = Boolean(state.recorder && state.recorder.recording)
  $('btn-sample').disabled = !clip.hasSample || recording
  $('btn-mine').disabled = !clip.hasRecording || recording
  $('btn-rec').disabled = state.busy
  $('btn-delete').disabled = !clip.hasRecording
  $('btn-prev').disabled = navTarget(-1) === null
  $('btn-next').disabled = navTarget(1) === null
}

function navTarget(direction) {
  const list = visible()
  const at = list.findIndex((c) => c.id === state.currentId)
  if (at === -1) return list.length ? list[0].id : null
  const next = at + direction
  return next >= 0 && next < list.length ? list[next].id : null
}

function go(direction) {
  const target = navTarget(direction)
  if (target) select(target)
}

function select(id) {
  stopPlayback()
  clearStatus()
  state.taking = null
  state.currentId = id
  localStorage.setItem(lastIdKey(), id)
  render()
}

function selectFirstUnrecorded() {
  const next = state.clips.find((c) => !c.hasRecording)
  if (next) select(next.id)
}

// ---------------------------------------------------------------------- audio

function stopPlayback() {
  player.pause()
  player.currentTime = 0
}

function play(url) {
  if (!url) return
  stopPlayback()
  player.src = url
  player.play().catch((e) => setStatus('bad', { title: '播放失败', detail: String(e.message || e) }))
}

// ------------------------------------------------------------------ recording

function startMeter(stream) {
  const ctx = audioContext()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const data = new Uint8Array(analyser.fftSize)
  state.meter = { source, analyser, raf: 0 }
  const tick = () => {
    analyser.getByteTimeDomainData(data)
    let peak = 0
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128)
    $('meter-fill').style.width = `${Math.min(100, peak * 140)}%`
    $('meter-fill').style.background = peak > 0.98 ? 'var(--bad)' : peak < 0.02 ? 'var(--warn)' : 'var(--good)'
    state.meter.raf = requestAnimationFrame(tick)
  }
  state.meter.raf = requestAnimationFrame(tick)
}

function stopMeter() {
  cancelAnimationFrame(state.meter.raf)
  if (state.meter.source) state.meter.source.disconnect()
  state.meter = { raf: 0, source: null, analyser: null }
  $('meter-fill').style.width = '0%'
}

let timerRaf = 0
function startTimer() {
  const started = performance.now()
  const tick = () => {
    $('timer').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`
    timerRaf = requestAnimationFrame(tick)
  }
  timerRaf = requestAnimationFrame(tick)
}
function stopTimer() { cancelAnimationFrame(timerRaf) }

async function toggleRecord() {
  if (state.busy) return
  if (state.recorder && state.recorder.recording) return stopRecord()
  return startRecord()
}

async function startRecord() {
  const clip = current()
  if (!clip) return
  stopPlayback()
  state.busy = true
  $('btn-rec').disabled = true
  $('rec-label').textContent = '准备中…'
  try {
    state.recorder = new Recorder({ deviceId: settings.deviceId })
    await state.recorder.start()
    startMeter(state.recorder.stream)
    startTimer()
    $('btn-rec').classList.add('on')
    $('rec-label').textContent = '停止'
    $('btn-rec').disabled = false
    $('btn-sample').disabled = true
    $('btn-mine').disabled = true
    setStatus('warn', { title: '录音中…', detail: '读完这句话后按空格停止。' })
    refreshMics()
    // Recording is now running: release the re-entrancy guard so the same
    // button/space can stop it. `state.recorder.recording` is what decides.
    state.busy = false
  } catch (err) {
    state.busy = false
    stopMeter()
    finishRecordButton()
    const message = String(err && err.name === 'NotAllowedError'
      ? '麦克风权限被拒绝。请在浏览器地址栏允许麦克风后重试。'
      : err && err.message ? err.message : err)
    setStatus('bad', { title: '无法开始录音', detail: message })
  }
}

async function stopRecord() {
  if (!state.recorder || !state.recorder.recording) return
  state.busy = true
  $('rec-label').textContent = '处理中…'
  $('btn-rec').disabled = true
  stopMeter()
  stopTimer()
  let result
  try {
    result = await state.recorder.stop()
  } catch (err) {
    state.busy = false
    finishRecordButton()
    return setStatus('bad', { title: '录音失败', detail: String(err.message || err) })
  }
  state.recorder = null
  $('timer').textContent = `${result.duration.toFixed(1)}s`
  state.taking = result
  if ($('auto-save').checked) {
    await saveTake()
  } else {
    state.busy = false
    finishRecordButton()
    describeTake(result, false)
  }
}

function finishRecordButton() {
  $('btn-rec').classList.remove('on')
  $('rec-label').textContent = '开始录音'
  $('btn-rec').disabled = false
  $('btn-sample').disabled = !current()?.hasSample
  $('btn-mine').disabled = !current()?.hasRecording
}

function describeTake(result, saved) {
  const kb = ((result.bytes || result.wav.byteLength) / 1024).toFixed(1)
  const seconds = result.duration.toFixed(1)
  if (result.peak < 0.02) {
    setStatus('warn', {
      title: saved ? `已保存，但几乎没有声音（${seconds}s，${kb} KB）` : `几乎没有声音（${seconds}s，${kb} KB）`,
      detail: '确认麦克风没静音、离得不太远，必要时重录。',
    })
  } else if (result.peak >= 0.999) {
    setStatus('warn', {
      title: `${saved ? '已保存，但' : ''}可能有爆音（${seconds}s，${kb} KB）`,
      detail: '离麦克风远一点或降低输入音量，重录会更干净。',
    })
  } else {
    setStatus('good', {
      title: saved ? `已保存 ${current()?.file || ''}（${seconds}s，${kb} KB）` : `录好了（${seconds}s，${kb} KB）`,
      detail: saved ? '按空格录下一条，或 → 切换。' : '按空格重录，或点「下一条」保留。',
    })
  }
}

async function saveTake() {
  const clip = current()
  const taken = state.taking
  if (!clip || !taken) return
  $('rec-label').textContent = '保存中…'
  const { ok, body } = await api(`/api/recordings/${encodeURIComponent(clip.id)}${topicQuery()}${state.topic ? '&' : '?'}duration=${taken.duration.toFixed(2)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/wav' },
    body: taken.wav,
  })
  state.busy = false
  finishRecordButton()
  if (!ok) {
    return setStatus('bad', { title: '保存失败', detail: body.error || JSON.stringify(body) })
  }
  const clipState = state.clips.find((c) => c.id === clip.id)
  clipState.hasRecording = true
  clipState.recordingUrl = body.recordingUrl
  state.taking = null
  describeTake({ duration: taken.duration, peak: taken.peak, bytes: body.bytes }, true)
  render()
  if ($('auto-verify').checked) await verify(clip.id)
}

async function verify(id) {
  $('btn-rec').disabled = true
  $('rec-label').textContent = '校验中…'
  const { ok, body } = await api(`/api/verify/${encodeURIComponent(id)}${topicQuery()}`, { method: 'POST' })
  $('btn-rec').disabled = false
  $('rec-label').textContent = '开始录音'
  if (!ok) {
    setStatus('warn', { title: '内容校验没跑成', detail: body.error || JSON.stringify(body) })
    return
  }
  const percent = body.sim === null || body.sim === undefined ? '' : `${Math.round(body.sim * 100)}%`
  const kind = body.status === 'PASS' ? 'good' : body.status === 'REVIEW' ? 'warn' : 'bad'
  const verdict = body.status === 'PASS' ? '机器听下来一致' : body.status === 'REVIEW' ? '接近，建议人工听一遍' : '和台词差得较多，建议重录'
  setStatus(kind, {
    title: `${body.status}　${percent}`,
    detail: `${verdict}${body.got ? `<div class="diff">识别：${escapeHtml(body.got)}</div>` : ''}${body.diff ? `<div class="diff">${renderDiff(body.diff)}</div>` : ''}`,
  })
}

// ---------------------------------------------------------------------- status

function clearStatus() {
  $('status').className = 'status hidden'
  $('status').innerHTML = ''
}

function setStatus(kind, { title, detail }) {
  const el = $('status')
  el.className = `status ${kind}`
  el.innerHTML = `<div class="label">${escapeHtml(title)}</div>${detail ? `<div>${detail}</div>` : ''}`
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// ASR diff: "−word" was expected but not heard, "+word" was heard but not expected.
function renderDiff(diff) {
  return escapeHtml(diff).split(' ').map((token) => {
    if (token.startsWith('\u2212')) return `<i>${token.slice(1)}</i>`
    if (token.startsWith('+')) return `<b>${token.slice(1)}</b>`
    return token
  }).join(' ')
}

function banner(message) {
  const el = $('banner')
  el.className = 'status bad'
  el.textContent = message
}

// ----------------------------------------------------------------------- tools

function logLine(text) {
  const el = $('console')
  el.textContent += `\n${text}`
  el.scrollTop = el.scrollHeight
}

async function streamPost(path, payload) {
  $('console').textContent = ''
  const res = await fetch(path, { method: 'POST', body: payload })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    $('console').textContent += decoder.decode(value, { stream: true })
    $('console').scrollTop = $('console').scrollHeight
  }
  await refreshStatus()
  await refreshClips()
}

async function refreshStatus() {
  const { body } = await api('/api/status')
  if (body.reports) {
    $('reports').innerHTML = ''
    for (const report of body.reports) {
      const link = document.createElement('a')
      link.href = `/api/report?name=${encodeURIComponent(report.name)}`
      link.target = '_blank'
      link.textContent = report.exists ? `打开报告：${report.name}` : `${report.name}（还没有）`
      $('reports').appendChild(link)
    }
  }
  const root = $('root-state')
  root.textContent = body.appRootExists ? '已连接：找到 App 仓库' : body.appRoot ? '路径无效或不存在' : '未设置'
  root.style.color = body.appRootExists ? 'var(--good)' : 'var(--warn)'
  return body
}

async function refreshTopics(selectId) {
  const { body } = await api('/api/topics')
  const topics = body.topics || []
  const select = $('topic-select')
  select.innerHTML = ''
  for (const topic of topics) {
    const option = document.createElement('option')
    option.value = topic.id
    option.textContent = topic.total
      ? `${topic.name}（${topic.recorded}/${topic.total}）`
      : topic.name
    select.appendChild(option)
  }
  if (selectId !== undefined && topics.some((t) => t.id === selectId)) state.topic = selectId
  if (!topics.some((t) => t.id === state.topic)) state.topic = ''
  select.value = state.topic
  return topics
}

function topicHint(topics) {
  const topic = topics.find((t) => t.id === state.topic)
  const hint = $('topic-hint')
  if (!hint) return
  if (!topic) { hint.textContent = ''; return }
  hint.textContent = topic.total
    ? `共 ${topic.total} 条，已录 ${topic.recorded}，有示范音 ${topic.withSample}`
    : (topic.app ? '还没有清单，先点「生成工作清单」。' : '这个专题是空的。')
}

async function refreshClips() {
  const { body } = await api(`/api/clips?session=${encodeURIComponent(state.topic)}`)
  state.clips = body.clips || []
  if (state.currentId && !state.clips.some((c) => c.id === state.currentId)) state.currentId = null
  if (!state.currentId && state.clips.length) {
    const remembered = localStorage.getItem(lastIdKey())
    state.currentId = remembered && state.clips.some((c) => c.id === remembered)
      ? remembered
      : state.clips[0].id
  }
  render()
  return body
}

async function switchTopic(topicId) {
  if (state.recorder && state.recorder.recording) return
  stopPlayback()
  clearStatus()
  state.taking = null
  state.topic = topicId
  state.currentId = null
  const topics = await refreshTopics()
  topicHint(topics)
  await refreshClips()
  const label = topics.find((t) => t.id === state.topic)?.name || state.topic
  logLine(`已切换到「${label}」`)
}

async function uploadDoc() {
  const input = $('doc-file')
  const file = input.files && input.files[0]
  const console = $('doc-console')
  if (!file) {
    setStatus('warn', { title: '先选择要上传的文件', detail: '支持 PDF / docx / txt / md。' })
    return
  }
  if (file.size > 16 * 1024 * 1024) {
    setStatus('warn', { title: '文件超过 16 MB', detail: `${(file.size / 1048576).toFixed(1)} MB。` })
    return
  }
  $('btn-upload-doc').disabled = true
  console.textContent = `上传 ${file.name}（${(file.size / 1024).toFixed(1)} KB）…\n`
  try {
    const res = await fetch(`/api/docs?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) {
      const type = res.headers.get('content-type') || ''
      const body = type.includes('json') ? await res.json() : await res.text()
      const message = typeof body === 'string' ? body : (body.error || JSON.stringify(body))
      console.textContent += `\n[失败] ${message}\n`
      setStatus('bad', { title: '上传失败', detail: message })
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      console.textContent = text
      console.scrollTop = console.scrollHeight
    }
    text += decoder.decode()
    const slug = (text.match(/^\[专题\]\s*(\S+)/m) || [])[1] || ''
    const topics = await refreshTopics(slug)
    if (slug) { state.currentId = null; await refreshClips() }
    topicHint(topics)
    input.value = ''
    const topic = topics.find((t) => t.id === slug)
    if (topic) {
      setStatus('good', { title: `专题「${topic.name}」已就绪`, detail: `共 ${topic.total} 条，示范音 ${topic.withSample} 条。可以开始逐句录了。` })
      logLine(`专题「${topic.name}」已生成，共 ${topic.total} 条`)
    } else {
      setStatus('warn', { title: '上传结束但没找到新专题', detail: '看看上面的输出。' })
    }
  } catch (err) {
    console.textContent += `\n[出错] ${err && err.message ? err.message : err}\n`
    setStatus('bad', { title: '上传出错', detail: String(err && err.message ? err.message : err) })
  } finally {
    $('btn-upload-doc').disabled = false
  }
}

async function refreshMics() {
  const mics = await listMicrophones()
  const select = $('mic-select')
  const chosen = settings.deviceId
  select.innerHTML = '<option value="">默认设备</option>'
  for (const mic of mics) {
    const option = document.createElement('option')
    option.value = mic.deviceId
    option.textContent = mic.label
    select.appendChild(option)
  }
  select.value = mics.some((m) => m.deviceId === chosen) ? chosen : ''
}

async function buildStepButtons() {
  const { body } = await api('/api/steps')
  $('step-buttons').innerHTML = ''
  for (const step of body) {
    const button = document.createElement('button')
    button.textContent = step.label
    button.title = step.hint || ''
    button.addEventListener('click', () => streamPost(`/api/run/${step.id}`))
    $('step-buttons').appendChild(button)
  }
}

// --------------------------------------------------------------------- wiring

$('btn-rec').addEventListener('click', toggleRecord)
$('btn-sample').addEventListener('click', () => play(current()?.sampleUrl))
$('btn-mine').addEventListener('click', () => play(current()?.recordingUrl))
$('btn-prev').addEventListener('click', () => go(-1))
$('btn-next').addEventListener('click', () => go(1))
$('btn-first-unrecorded').addEventListener('click', selectFirstUnrecorded)
$('btn-delete').addEventListener('click', async () => {
  const clip = current()
  if (!clip || !clip.hasRecording) return
  if (!window.confirm(`删除 ${clip.file} 的录音？`)) return
  const { ok, body } = await api(`/api/recordings/${encodeURIComponent(clip.id)}${topicQuery()}`, { method: 'DELETE' })
  if (!ok) return setStatus('bad', { title: '删除失败', detail: body.error || '' })
  clip.hasRecording = false
  clip.recordingUrl = null
  clearStatus()
  render()
})
$('only-unrecorded').addEventListener('change', () => {
  const list = visible()
  if (!list.some((c) => c.id === state.currentId)) {
    if (list.length) select(list[0].id)
    else render()
  } else {
    render()
  }
})
$('auto-save').addEventListener('change', () => { settings.autoSave = $('auto-save').checked; saveSettings() })
$('auto-verify').addEventListener('change', () => { settings.autoVerify = $('auto-verify').checked; saveSettings() })
$('mic-select').addEventListener('change', () => {
  settings.deviceId = $('mic-select').value
  saveSettings()
  if (state.recorder) state.recorder.deviceId = settings.deviceId
})
$('btn-save-root').addEventListener('click', async () => {
  const { ok, body } = await api('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appRoot: $('app-root').value.trim() }),
  })
  logLine(ok ? `App 路径已保存：${body.appRoot || '(空)'}` : 'App 路径保存失败')
  await refreshStatus()
})
$('btn-oneclick').addEventListener('click', () => streamPost('/api/run/full'))
$('btn-import').addEventListener('click', () => streamPost('/api/import'))
$('btn-refresh').addEventListener('click', async () => { await refreshClips(); await refreshStatus(); logLine('清单已重新载入') })
$('btn-refresh-topics').addEventListener('click', async () => {
  const topics = await refreshTopics()
  topicHint(topics)
  await refreshClips()
  logLine('清单列表已刷新')
})
$('topic-select').addEventListener('change', () => switchTopic($('topic-select').value))
$('btn-upload-doc').addEventListener('click', uploadDoc)

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, select, textarea')) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.code === 'Space') {
    event.preventDefault()
    if (state.recorder && state.recorder.recording) {
      stopRecord()
    } else if (!$('btn-rec').disabled) {
      startRecord()
    }
  } else if (event.key === 's' || event.key === 'S') {
    play(current()?.sampleUrl)
  } else if (event.key === 'p' || event.key === 'P') {
    play(current()?.recordingUrl)
  } else if (event.key === 'ArrowLeft') {
    go(-1)
  } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
    go(1)
  }
})

async function boot() {
  if (!window.isSecureContext) {
    banner('麦克风需要安全上下文：请用 http://127.0.0.1:5180 打开，不要用局域网 IP。')
  } else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    banner('这个浏览器不支持录音（navigator.mediaDevices 缺失）。请用 Chrome 或 Edge。')
  }

  $('auto-save').checked = settings.autoSave
  $('auto-verify').checked = settings.autoVerify

  const status = await refreshStatus()
  $('app-root').value = status.config.appRoot || ''
  const topics = await refreshTopics()
  topicHint(topics)
  await refreshClips()
  if (!current() && state.clips.length) selectFirstUnrecorded()
  await buildStepButtons()
  await refreshMics()

  if (status.total === 0) {
    logLine('还没有清单。点下面的「生成工作清单」或先设置 App 仓库路径。')
  }
  if (state.clips.some((c) => c.id === state.currentId && !c.hasSample)) {
    setStatus('warn', { title: '这条没有示范音', detail: '缺少对应示范音文件，可先跑「TTS 合成」生成示范。' })
  }
}

// Small read-only handle so automated checks (and the devtools console) can see
// what the page is doing without scraping the DOM.
window.__vb = {
  get state() { return state },
  current,
  visible,
}

boot()
