# VoiceBuilder

英闯星球（YingChuangXingQiu）的**音频生产与校验**工具，独立于 App 本身。
它只做一件事：把"要录的台词"变成 App 能直接用的音频文件，并保证质量。

App 不再自带音频脚本，也不再有 `audio-preview/`。它只**消费**成品：
`public/audio/**` 与 `wechat-miniprogram/content/audio-preview-manifest.json`。

## 它做什么

```
生成工作清单 → (TTS 合成 | 真人录音) → 机械校验 + ASR 内容校验 → 打包交给 App
```

- **工作清单**：从 App 的题库（`wechat-miniprogram/content/question-banks/*.json` +
  `utils/assessment.js`）和 `LUMI-VOICE-LINES.md` 生成，含每条台词、文件名、预估时长。
- **收录**：要么用本机 Windows 语音 TTS 合成，要么按清单真人录音后放进 `work/audio/`。
- **机械校验**：文件是否齐全、命名、采样率/声道/位深、静音、爆音、时长异常。
- **内容校验（ASR）**：Vosk 离线英文模型把每条录音转成文字，与台词逐词比对，
  输出 PASS / REVIEW / FAIL。这是"念错没念错"的自动检查。
- **交付**：把成品打包进 App 的微信小程序分包，并发布到 PWA 的 `public/audio`。

## 快速开始

```powershell
# 一次性
copy voicebuilder.config.example.json voicebuilder.config.json   # 改成你的 App 路径
pip install vosk
npm run model        # 下载离线 ASR 模型（~41 MB，可断点续传）
npm run ui           # 打开 http://127.0.0.1:5180
```

网页里：填 App 路径 → 保存 → 依次点「生成工作清单」「机械校验」「内容校验」
「打包小程序分包」「发布到 PWA」。也可以直接点「一键全流程」。

真人录音：先「生成工作清单」，按 `work/recording-worklist.csv` 录，把 WAV 放进
`work/audio/`（文件名照抄清单），再跑两道校验，最后打包发布。
详见 `work/RECORDING-GUIDE.md`。

## 命令行（不用网页也行）

| 命令 | 作用 |
|---|---|
| `npm run worklists` | 生成 listening / recording 工作清单 |
| `npm run model` | 下载 ASR 模型（每台机器一次） |
| `npm run tts` | 用 Windows SAPI 合成预览 WAV |
| `npm run check` | 机械校验（写 `work/reports/recording-set-check.md`） |
| `npm run verify-asr` | ASR 内容校验（写 `work/reports/recording-asr-check.md`） |
| `npm run pack` | 打包进 App 的小程序分包 |
| `npm run publish-pwa` | 发布到 App 的 `public/audio` |

## 目录

```
voicebuilder.config.json   你的 App 路径（gitignore，剩 machine-specific）
src/                       清单生成、校验、TTS、打包、发布、网页服务器
web/index.html             本地网页界面
work/                      工作区
  audio/                   成品 WAV（gitignore）
  manifest.json            期望音频清单
  listening-worklist.json  听力清单
  recording-worklist.*     录音工作清单（json / csv）+ RECORDING-GUIDE.md
  reports/                 两道校验的报告
models/                    Vosk 模型（gitignore）
```

## 边界与注意事项

- **校验是第二意见，不是判决**：ASR 会听错专有名词、数字、轻读，REVIEW 的行要人耳确认。
- **格式**：成品必须是 11 kHz / 16-bit / 单声道 WAV，小程序分包每个 < 2 MB、总包 < 20 MB。
- **`.json.js` 陷阱**：小程序 `require()` 不能加载 `.json`，所以打包时会同时写
  `content/audio-preview-manifest.json.js`（见 App 的 `docs/pitfalls.md` MP-01）。
- **行尾**：打包器把 manifest 的换行统一成 LF，保证与 App 仓库逐字节一致，
  不产生格式噪音。
- **换机器**：`pip install vosk` 再 `npm run model`。

## 这个仓库里没有什么

VoiceBuilder 只包含**工具**。它不含题库、录音成品或品牌素材——那些属于
英闯星球主项目，不在开源范围内。因此你可以自由复用这套流水线，但拿不到
它的内容：问卷文本、Lumi 台词、录好的音频都要你自己的。

## 开源许可

[MIT](./LICENSE)。工具可自由使用、修改与再分发（包括闭源）；但不含任何
题库、音频或品牌内容的授权。
