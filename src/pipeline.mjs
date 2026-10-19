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
    id: 'rvc-model',
    label: '下载 RVC 美式口音模型（已弃用）',
    hint: '⚠️ 已弃用：RVC 存在授权风险（fairseq GPL、模型权重不明）。推荐用 Kokoro TTS 重合成方案替代。',
    commands: [['powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'src/fetch-rvc-model.ps1']]],
  },
  {
    id: 'tts',
    label: 'TTS 合成示范音（Kokoro，商用安全）',
    hint: '用 Kokoro-82M (Apache-2.0) 生成 work/samples 里的示范音，自然美式发音，无商业授权风险',
    commands: [['python', ['src/tts-kokoro.py', '--worklist', 'work/manifest.json', '--output', 'work/samples']]],
  },
  {
    id: 'ingest',
    label: '导入原始录音',
    hint: '把 work/inbox 里手机/录音笔的文件识别成正确文件名并转码',
    commands: [['python', ['src/ingest.py']]],
  },
  {
    id: 'process-audio',
    label: '音频后处理（降噪/统一音量）',
    hint: '对 work/audio 逐条：谱减法降噪 → EBU R128 响度归一化（-23 LUFS）。已移除 RVC 美式口音转换。',
    commands: [['python', ['src/process-audio.py', '--dir', 'work/audio', '--list', 'work/manifest.json']]],
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
export const FULL_PIPELINE = ['process-audio', 'check', 'asr', 'pack', 'publish']

export const REPORT_NAMES = ['recording-set-check.md', 'recording-asr-check.md', 'recording-ingest.md']
