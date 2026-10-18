// The pipeline steps, shared by the local web UI and the CLI.
//
// Each command runs with cwd = project root. The marker "node" is replaced with
// the running Node executable by the server, so a machine without a global
// `node` on PATH still works.
export const STEPS = [
  {
    id: 'worklists',
    label: '生成工作清单',
    hint: '从 App 题库 + LUMI-VOICE-LINES.md 生成可录音清单，并标注音标与发音提示',
    commands: [
      ['node', ['src/build-listening-worklist.mjs']],
      ['node', ['src/build-recording-worklist.mjs']],
      ['python', ['src/generate-ipa.py']],
    ],
  },
  {
    id: 'model',
    label: '下载 ASR 模型（每台一次）',
    hint: 'Vosk 英文小模型约 41 MB，离线识别用',
    commands: [['powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'src/fetch-asr-model.ps1']]],
  },
  {
    id: 'tts',
    label: 'TTS 合成示范（可选）',
    hint: '用本机 Windows 语音生成 work/samples 里的示范音',
    commands: [['powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'src/generate-audio.ps1']]],
  },
  {
    id: 'ingest',
    label: '导入原始录音',
    hint: '把 work/inbox 里手机/录音笔的文件识别成正确文件名并转码',
    commands: [['python', ['src/ingest.py']]],
  },
  {
    id: 'check',
    label: '机械校验',
    hint: '格式 / 静音 / 爆音 / 时长异常',
    commands: [['node', ['src/check-recordings.mjs']]],
  },
  {
    id: 'asr',
    label: '内容校验（ASR）',
    hint: '离线转写并与台词逐词比对',
    commands: [['python', ['src/asr-verify.py']]],
  },
  {
    id: 'pack',
    label: '打包小程序分包',
    hint: '写入 App 的 wechat-miniprogram 分包与清单',
    commands: [['powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'src/pack-miniprogram.ps1']]],
  },
  {
    id: 'publish',
    label: '发布到 PWA',
    hint: '写入 App 的 public/audio',
    commands: [['node', ['src/publish-pwa.mjs']]],
  },
]

// Finishing flow, run once every line has a recording. TTS and import are not
// part of it: those produce work/audio entries, they are not a finalisation.
export const FULL_PIPELINE = ['check', 'asr', 'pack', 'publish']

export const REPORT_NAMES = ['recording-set-check.md', 'recording-asr-check.md', 'recording-ingest.md']
