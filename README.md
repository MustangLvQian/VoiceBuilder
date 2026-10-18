# VoiceBuilder

英闯星球（YingChuangXingQiu）的**音频生产与校验**工具，独立于 App 本身。
它只做一件事：把"要录的台词"变成 App 能直接用的音频文件，并保证质量。

App 不再自带音频脚本，也不再有 `audio-preview/`。它只**消费**成品：
`public/audio/**` 与 `wechat-miniprogram/content/audio-preview-manifest.json`。

## 它做什么

```
生成工作清单 → (TTS 出示范音 | 真人逐句录音 / 批量导入) → 机械校验 + ASR 内容校验 → 打包交给 App
```

- **工作清单**：从 App 的题库（`wechat-miniprogram/content/question-banks/*.json` +
  `utils/assessment.js`）和 `LUMI-VOICE-LINES.md` 生成，含每条台词、文件名、预估时长。
- **音标与发音提示**：用 CMU 词典（美式）给每条台词生成按词对齐的 IPA 和针对性发音提示，
  录音时每个词上方显示 `[ˈnoʊtəs]` 这样的音标。
- **录音工作站（网页）**：一条一条来——先播示范音，你照着念，停止后自动转成
  11 kHz/16-bit/单声道 WAV 并存成清单里的正确文件名，接着下一条。
- **批量导入**：手机/录音笔录的 `m4a`/`mp3` 丢进 `work/inbox/`，离线转写后自动认出
  每条是哪句；认不准的不瞎猜，留给人处理。
- **机械校验**：文件是否齐全、命名、采样率/声道/位深、静音、爆音、时长异常。
- **内容校验（ASR）**：Vosk 离线英文模型把每条录音转成文字，与台词逐词比对，
  输出 PASS / REVIEW / FAIL。这是"念错没念错"的自动检查。
- **交付**：把成品打包进 App 的微信小程序分包，并发布到 PWA 的 `public/audio`。

## 快速开始

```powershell
# 一次性
copy voicebuilder.config.example.json voicebuilder.config.json   # 改成你的 App 路径
pip install vosk av pronouncing
npm run model        # 下载离线 ASR 模型（~41 MB，可断点续传）
npm run ui           # 打开 http://127.0.0.1:5180
```

网页里：填 App 路径 → 保存 → 点「生成工作清单」→ 然后**逐句录**：

- `空格` 开始/停止录音，停录后自动保存成正确文件名（可关掉「自动保存」先试听）
- `S` 听示范音，`P` 听自己刚录的，`←` `→` 切换，`Enter` 下一条
- 想边录边确认，打开「保存后自动做内容校验」，每条给出 PASS / REVIEW / FAIL

全部录完后点「一键收尾」（校验 → 打包 → 发布）。详见 `work/RECORDING-GUIDE.md`
（首次点「生成工作清单」后会生成）。

用手机或录音笔录的，把文件丢进 `work/inbox/` 再点「导入原始录音」即可，
不需要装 ffmpeg。

## 命令行（不用网页也行）

| 命令 | 作用 |
|---|---|
| `npm test` | 跑网页录音转码（WAV 编码/重采样）的单元测试 |
| `npm run worklists` | 生成 listening / recording 工作清单，并标注音标与发音提示 |
| `npm run ipa` | 只给录音清单补音标与发音提示（需 `pronouncing`） |
| `npm run model` | 下载 ASR 模型（每台机器一次） |
| `npm run tts` | 用 Windows SAPI 生成 `work/samples/` 里的示范音 |
| `npm run import` | 把 `work/inbox/` 的原始录音识别、转码、归位 |
| `npm run check` | 机械校验（写 `work/reports/recording-set-check.md`） |
| `npm run verify-asr` | ASR 内容校验（写 `work/reports/recording-asr-check.md`） |
| `npm run pack` | 打包进 App 的小程序分包 |
| `npm run publish-pwa` | 发布到 App 的 `public/audio` |

## 目录

```
voicebuilder.config.json   你的 App 路径（gitignore，剩 machine-specific）
src/                       清单生成、导入、校验、TTS、打包、发布、网页服务器
  audio_text.py            文本比对与音频解码的共享实现（asr-verify 与 ingest 共用）
  generate-ipa.py          用 CMU 词典生成逐词 IPA 与发音提示，写回录音清单
web/                       本地网页界面
  index.html               录音工作站
  app.js                   录音、导航、保存、收尾按钮
  recorder.js              浏览器录音（getUserMedia + 重采样）
  audio-format.js          纯函数：Float32 → 16-bit WAV（有单测）
test/                      node --test 用例
work/                      工作区（gitignore）
  audio/                   成品录音 WAV（App 真正拿到的东西）
  samples/                 示范音，录音时播放（TTS 生成）
  inbox/                   手机/录音笔的原始文件，等待 import
  manifest.json            期望音频清单
  listening-worklist.json  听力清单
  recording-worklist.*     录音工作清单（json / csv）+ RECORDING-GUIDE.md
  reports/                 校验与导入报告
models/                    Vosk 模型（gitignore）
```

## 边界与注意事项

- **校验是第二意见，不是判决**：ASR 会听错专有名词、数字、轻读，REVIEW 的行要人耳确认。
- **格式**：成品必须是 11 kHz / 16-bit / 单声道 WAV，小程序分包每个 < 2 MB、总包 < 20 MB。
  网页录音与 `import` 都会自动转成这个格式，不需要 ffmpeg。
- **空录音集会拒绝发布**：`work/audio/` 为空时打包会硬失败、发布也会拒绝，
  以免把 App 已有的音频清空（真要清空得显式加 `--allow-empty`）。
- **`.json.js` 陷阱**：小程序 `require()` 不能加载 `.json`，所以打包时会同时写
  `content/audio-preview-manifest.json.js`（见 App 的 `docs/pitfalls.md` MP-01）。
- **行尾**：打包器把 manifest 的换行统一成 LF，保证与 App 仓库逐字节一致，
  不产生格式噪音。
- **换机器**：`pip install vosk av pronouncing` 再 `npm run model`。

## 这个仓库里没有什么

VoiceBuilder 只包含**工具**。它不含题库、录音成品或品牌素材——那些属于
英闯星球主项目，不在开源范围内。因此你可以自由复用这套流水线，但拿不到
它的内容：问卷文本、Lumi 台词、录好的音频都要你自己的。

## 开源许可

[MIT](./LICENSE)。工具可自由使用、修改与再分发（包括闭源）；但不含任何
题库、音频或品牌内容的授权。
