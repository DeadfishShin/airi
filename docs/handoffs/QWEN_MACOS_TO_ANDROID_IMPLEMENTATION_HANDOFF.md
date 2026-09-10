# Qwen macOS 适配 → Android 开发 Agent 技术交接

## 0. 项目边界与事实等级

```text
PROJECT_TYPE=PERSONAL_PROJECT
ANDROID_GOAL=复用 macOS Qwen 适配经验，尽快完成 Android 端可靠实现
PRIORITY=functionality + stability + maintainability
COMMERCIAL_GRADE_SECURITY_ARCHITECTURE=NOT_REQUIRED
OVERENGINEERING=AVOID
```

本交接文档的 macOS 事实唯一以 PR13 为准：

```text
SOURCE_PR=13
SOURCE_HEAD=30ca9068aa864ed79706b665154a24bc890edfca
SOURCE_TREE=bf6f12a7baebf40c7db45afc058d113514ab3771
```

macOS source 是 Android 的 reference authority，不是 Android source authority。Android agent 必须先审计 Android 仓库当前真实状态，再按本文档吸收生命周期、不变量和失败经验；不得整块 cherry-pick macOS branch。

本文档不要求企业级 secrets system、generic provider architecture rewrite、Route B 或无关基础设施重构。目标是可靠可维护的个人项目实现。

## 1. 最终已验证的生产链路

```text
Microphone
  → local production VAD
  → speech segment / endpointing
  → Qwen realtime ASR
  → AIRI canonical conversation pipeline
  → persona / memory / tools
  → generation provider
  → conversational TTS queue
  → Qwen3 realtime TTS
  → speaker playback
```

### Barge-in 不变量

assistant 播放期间，mic/VAD 继续运行。有效的新用户 speech-start 会：

1. 只消费当前 assistant playback 的一次 interruption；
2. 取消旧 TTS，并取消或使旧 generation turn 失效；
3. 创建新 user turn；
4. 通过 session/token epoch 使旧事件失效；
5. 抑制旧音频的 late/stale playback；
6. 在连续打断后仍保持一致，最后等待 quiet tail。

这些语义已在 macOS Owner runtime 中确认，包括真实播放和 barge-in。

## 2. Qwen realtime ASR

```text
provider ID = qwen-audio-realtime-transcription
model      = qwen-audio-3.0-asr-flash-streaming
```

这是 PR13 中已通过真实 Owner runtime 的 ASR 选择。它属于 Qwen Audio realtime duplex WebSocket protocol family；生产捕获侧把经本地 VAD 分段后的 PCM 音频按 session 发送到主进程适配器，再由主进程建立带认证的 Qwen realtime session。Android 应复现“本地 endpointing 决定一个 session 的边界”这一语义，不能把每个音频 frame 当作独立请求。

关键生命周期：

```text
speech-start
  → session start / task-started
  → audio append (PCM, 16 kHz)
  → partial result*
  → final result*
  → silence endpoint
  → finish-task / task-finished
```

取消或 dispose 必须拥有 session 的停止权，并且 late event 不能重新打开已结束的 session。最终 transcription 进入现有 AIRI canonical conversation input，不绕过 persona、memory、tools 或正常 generation handoff。

macOS 关键源码：

- `packages/stage-ui/src/libs/providers/providers/qwen-audio-realtime/index.ts`：renderer provider 定义与 provider ID。
- `packages/stage-ui/src/libs/providers/qwen-audio-realtime-models.ts`：model catalog 与默认 model。
- `packages/stage-ui/src/libs/providers/qwen-audio-realtime-ipc.ts`：renderer/main 事件契约。
- `packages/stage-ui/src/stores/modules/hearing.ts`：mic/VAD/segment 到 remote ASR 的生产绑定。
- `packages/stage-ui/src/libs/audio/vad-streaming-session.ts`：一个 speech segment 对应一个 provider session 的串行化生命周期。
- `apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime/index.ts`：Electron main session owner、start/append/finish/cancel、partial/final/finished/error 事件。
- `apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime/protocol.ts`：Qwen WebSocket endpoint、run-task/finish-task frame、PCM/sample-rate 与错误清理。

Android acceptance signal：实际设备上一次短语音产生一个新 segment、一个 ASR session、至少一个 final，并把 final 交给现有聊天 pipeline；没有重复 session 或旧 turn 回流。

## 3. Qwen3 realtime TTS 与 Serena

```text
provider        = qwen3-tts-realtime
default model   = qwen3-tts-flash-realtime
alternative     = qwen3-tts-instruct-flash-realtime
validated voice = Serena
```

一个 conversational response 只允许一个 active conversational TTS session。主流程是：

```text
session start / ready
  → append assistant text chunks
  → finish / server commit
  → audio delta (PCM16)
  → production playback queue
  → response/session finished
```

取消必须停止当前 session，并使旧音频在 playback queue 中失效。session-finished 之后不得继续播放 stale delta。Preview 是单独的用户动作/测试路径，不能替代 conversational TTS，也不能把 preview 的 synthetic text 混入生产 response。

关键源码：

- `packages/stage-ui/src/libs/providers/qwen3-tts-realtime-models.ts`：两个稳定 realtime model 与默认 model。
- `packages/stage-ui/src/libs/providers/qwen3-tts-realtime-voices.ts`：voice ID、display label、model compatibility；Serena 的 provider ID 是 `Serena`。
- `packages/stage-ui/src/libs/providers/qwen-tts-realtime-ipc.ts`：renderer/main TTS 事件契约。
- `packages/stage-ui/src/libs/speech/qwen-tts-stage-session.ts`：conversation TTS session ownership。
- `packages/stage-ui/src/libs/speech/qwen-tts-pcm-playback.ts`：PCM/audio delta 到生产播放的桥接。
- `packages/stage-ui/src/libs/speech/qwen-tts-streaming-preview.ts`：Preview 的独立路径，不要与 conversational path 混用。
- `apps/stage-tamagotchi/src/main/services/airi/qwen-tts-realtime/index.ts`：Electron main WebSocket session 与 lifecycle。
- `apps/stage-tamagotchi/src/main/services/airi/qwen-tts-realtime/protocol.ts`：Qwen3 realtime WebSocket protocol、text append、audio delta、finish/error。

### Voice catalog lesson

provider voice ID 不等于展示名称。Android UI 可以显示本地化 label，但发送给 provider 时必须使用 catalog 的 provider parameter ID。尤其方言 voice 的展示名可能包含地区说明，不能把展示名直接作为 provider 参数。Serena 已经通过 macOS real runtime 验证；Android 仍需用自己的 audio output 做设备验收。

## 4. Credential：只保留实用边界

### Qwen

macOS 最终使用一个共享的：

```text
QWEN_DASHSCOPE_PAYG profile
  → ASR + TTS 共用
  → secure local persistence
  → public readiness state
  → runtime credential resolution
```

Android 应把同一原则翻译为 Android 原生安全存储（例如 Keystore-backed secure storage/Encrypted DataStore 等），不要把 secret 长期放入普通明文 SharedPreferences 或普通配置文件。只要做到“持久化加密、UI 只显示 ready/configured、运行时按需解析、缺失或损坏 fail closed”即可；不需要复制 Electron safeStorage API，也不需要构建企业级 credential broker。

### DeepSeek

macOS 的 DeepSeek 使用的是 Route A：secure persistence + runtime renderer transient credential。它不是 Qwen Android 适配的核心要求。Android agent 不要因为该历史实现扩大到 Route B 或全 provider secrets architecture。

## 5. Frozen VAD authority

```text
model         = onnx-community/silero-vad
revision      = ddc9a7e80d6758f6fc795a1e8a04b798eb929d3a
SHA256        = a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808
threshold     = 0.52
exit          = 0.156
minSilence    = 1200ms
speechPad     = 360ms
minSpeech     = 300ms
sampleRate    = 16000
userTurnGrace = 500ms
```

关键源码：`packages/stage-ui/src/stores/modules/hearing.ts`、`packages/stage-ui/src/libs/audio/vad-streaming-session.ts`。

Android 不要求机械复制 macOS 实现代码。先复制上述行为参数和 lifecycle 语义，再接入 Android audio stack；除非真实设备证据证明必须调整，否则不要重新从零调 VAD。

## 6. Barge-in 实现要点

必须保留以下不变量：

```text
mic/VAD active during assistant playback
→ valid speech starts interruption
→ old TTS/generation cancellation
→ session/token invalidation
→ stale output suppression
→ consecutive interruption safety
→ quiet tail
```

参考：`packages/stage-ui/src/libs/speech/barge-in.ts`、`packages/stage-ui/src/libs/speech/barge-in.test.ts`、`packages/stage-ui/src/libs/audio/vad-streaming-session.ts`。Android 端应先用状态机和单元测试固定这些不变量，再做设备测试。

## 7. DO_NOT_PORT_LITERALLY

以下是 macOS 平台胶水，不要直接搬到 Android：

- macOS TCC 的 launch attribution 与 Privacy 状态；
- LaunchServices `/usr/bin/open -n`；
- Electron `safeStorage` API；
- Electron IPC/Eventa 的具体 plumbing；
- `APP_USER_DATA_PATH` test profile；
- macOS bundle ID、CDHash、designated requirement；
- macOS speaker/output device 的实现细节；
- temporary owner-sync diagnostic seam，除非 Android 测试确实需要一个等价同步点。

Android 应复制的是 architecture、lifecycle、invariants 与 failure lessons，而不是 macOS 平台接口。

## 8. 本轮真正有价值的失败经验

1. Fresh packaged app identity 与开发版 permission/profile 不等价；安装包、Bundle identity、权限和 userData 要分别确认。
2. Test userData 与 normal userData 混用会制造“credential 丢失”等假故障；测试 profile 必须明确命名并与最终运行 profile 分开。
3. Microphone track live 不等于 VAD positive；采集成功、模型输入流动和 speech-positive 是三个不同证据。
4. Observer 没看到事件不一定代表产品实际没运行；本轮 instrumented observer 曾 false-negative，最终以 Owner 的实际产品体验为准，同时保留 observer 局限。
5. Voice display name 与 provider ID 不得混淆。
6. Secure credential readiness 应与 provider configured 状态分离；“配置完成”不能只由一个空或半配置 record 推断。
7. TTS 旧 session cancellation 后必须防 stale output，尤其要处理 late audio delta 和 finished 之后的队列数据。
8. Diagnostic harness 不得变成 production dependency；默认生产路径应能在没有 diagnostic env/bridge 时独立工作。
9. Full-chain 最终要以真实设备“听得到、能打断”验收，不能只用 provider returned audio 或 observer counters 代替。

## 9. Android 开发前置审计

macOS source 是 reference，不是 Android source。Android agent 开始前必须在 Android 仓库只读盘点：

- 现有 microphone capture 与 audio focus/lifecycle；
- 现有 VAD、segment/endpointing；
- 现有 AIRI chat/generation、persona/memory/tools binding；
- 现有 TTS 与 speaker playback queue；
- 现有 credential UI/storage；
- 现有 cancellation、session ownership、stale-output 防护。

先找能复用的 Android 组件，再补缺口；不要直接移植 Electron 文件或把 macOS 分支整块 cherry-pick。

## 10. 推荐 Android 最短实施顺序

| 阶段 | 目标 | macOS reference | Android 自行实现 | acceptance signal |
| --- | --- | --- | --- | --- |
| A1 | 审计现有 speech/conversation architecture | `hearing.ts`、`vad-streaming-session.ts`、speech store | 对齐 Android 现有 lifecycle、audio focus、chat handoff | 形成现状/缺口清单，不改 provider 行为 |
| A2 | 加入共享 Qwen PAYG 配置 | `qwen-dashscope-payg-credentials/`、`qwen-dashscope-payg-ipc.ts` | Android 原生安全存储、public ready state、fail-closed | ASR/TTS 看到同一个 ready profile，secret 不进普通配置 |
| A3 | 实现 Qwen realtime ASR adapter | `qwen-audio-realtime/index.ts`、`protocol.ts`、provider model catalog | Android WebSocket/协程/音频发送与 session cancel | 一段真实语音 → 一个 session → final |
| A4 | 实现 Qwen3 realtime TTS 与 voice/model catalog | `qwen-tts-realtime/`、`qwen3-tts-realtime-models.ts`、`qwen3-tts-realtime-voices.ts` | Android streaming text、PCM queue、provider ID 映射 | Serena 与 model ID 正确，收到 audio delta |
| A5 | 绑定 Android VAD → ASR → AIRI → TTS | `hearing.ts`、`speech.ts`、`qwen-tts-stage-session.ts` | 接入现有 persona/memory/tools/generation，不绕过 canonical path | 一次 user turn 完整贯通 |
| A6 | 加入 barge-in/stale-output 语义 | `barge-in.ts`、其测试、PCM playback | turn epoch、cancel、队列清空/失效、quiet tail | 播放中打断后旧音频不再出现，可连续打断 |
| A7 | 真实设备 full-chain acceptance | PR13 Owner runtime evidence | Android permission/audio route/设备噪声与 speaker | mic → ASR → AIRI → TTS → speaker，且听得到、能打断 |

每一阶段只验证本阶段信号，不为了“看起来完整”引入无关 provider 或平台重构。

## 11. PR13 source map

| Capability | PR13 source files | Android concept |
| --- | --- | --- |
| Qwen credential | `apps/stage-tamagotchi/src/main/services/airi/qwen-dashscope-payg-credentials/store.ts`; `index.ts`; `packages/stage-ui/src/libs/providers/qwen-dashscope-payg-ipc.ts` | Keystore-backed shared PAYG profile + public readiness |
| Qwen ASR | `apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime/index.ts`; `protocol.ts`; `packages/stage-ui/src/libs/providers/qwen-audio-realtime-ipc.ts` | Main/service-owned realtime ASR adapter |
| ASR model catalog | `packages/stage-ui/src/libs/providers/qwen-audio-realtime-models.ts` | Stable provider/model ID registry |
| Qwen TTS | `apps/stage-tamagotchi/src/main/services/airi/qwen-tts-realtime/index.ts`; `protocol.ts`; `packages/stage-ui/src/libs/speech/qwen-tts-stage-session.ts` | Realtime TTS session and playback ownership |
| TTS model catalog | `packages/stage-ui/src/libs/providers/qwen3-tts-realtime-models.ts` | Model IDs, compatibility, default selection |
| Voice catalog | `packages/stage-ui/src/libs/providers/qwen3-tts-realtime-voices.ts` | Provider voice ID separate from display label |
| Preview | `packages/stage-ui/src/libs/speech/qwen-tts-streaming-preview.ts` | Separate preview/test path; never substitute for conversation TTS |
| Hearing/VAD | `packages/stage-ui/src/stores/modules/hearing.ts`; `packages/stage-ui/src/libs/audio/vad-streaming-session.ts` | Capture, endpointing, one-session-per-segment semantics |
| Owner-sync diagnostic | `packages/stage-ui/src/libs/audio/remote-asr-owner-sync-gate.ts`; `remote-asr-owner-sync-gate.test.ts` | Optional test synchronization seam; not production dependency |
| Onboarding fix | `packages/stage-ui/src/stores/onboarding.ts`; `packages/stage-ui/src/stores/onboarding.test.ts`; `packages/stage-ui/src/components/scenarios/dialogs/onboarding/onboarding.vue` | Configured-own-provider completion/recovery semantics |
| Selection persistence tests | `packages/stage-ui/src/stores/modules/speech-selection-persistence.browser.test.ts`; `packages/stage-ui/src/stores/modules/speech.ts` | Cold-start persistence, cross-window sync, incompatible voice normalization |

## 12. Acceptance evidence and scope closure

### SOURCE/BUILD ACCEPTANCE

PR13 is the accepted final macOS source candidate. Its final integration source includes the Qwen credential, ASR, TTS, voice catalog, VAD/hearing, packaging, onboarding, DeepSeek Route-A support and the retained selection persistence coverage. Controller evidence records PR13 as OPEN/DRAFT/UNMERGED/mergeable with the exact source head/tree above. No new macOS production change is requested by this handoff.

### OWNER REAL-DEVICE ACCEPTANCE

The following are already accepted and must not be re-run as part of Android documentation work:

```text
REAL_MIC_RUNTIME=PASS_OWNER_ACCEPTED
QWEN_ASR_RUNTIME=PASS_OWNER_ACCEPTED
AIRI_GENERATION_RUNTIME=PASS_OWNER_ACCEPTED
DEEPSEEK_V4_FLASH_RUNTIME=PASS_OWNER_ACCEPTED
SERENA_TTS_PLAYBACK_RUNTIME=PASS_OWNER_ACCEPTED
BARGE_IN_RUNTIME=PASS_OWNER_ACCEPTED
```

An instrumented observer once reported a bounded no-speech false negative. It is retained as an instrumentation limitation relative to Owner product runtime evidence; it does not override the accepted real-device result.

## 13. Handoff boundaries

```text
PRODUCTION_SOURCE_MUTATION_COUNT=0
ANDROID_MUTATION_COUNT=0
PROVIDER_CALL_COUNT=0
MIC_CAPTURE_COUNT=0
SECRET_EXPOSURE_COUNT=0
```

This document contains no credential, transcript, PCM, audio payload or private runtime data. The next action is Android-repository audit followed by A1–A7, not another macOS security enhancement or another macOS runtime acceptance.
