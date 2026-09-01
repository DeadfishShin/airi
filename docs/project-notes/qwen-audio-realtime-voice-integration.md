# Qwen Audio 实时语音集成工程笔记

状态：macOS-first 实验路线的工程参考。本文档基于当前源码、提交历史、已提交测试、Owner 的 bounded real-runtime evidence，以及 Alibaba 官方文档；它不是产品 SLA，也不是对任何服务条款的法律解释。

## 当前状态摘要

| 能力 | 当前结论 | 证据级别 |
| --- | --- | --- |
| Qwen streaming ASR macOS | PASS | `REAL_RUNTIME_PROVEN` |
| Qwen PAYG realtime TTS | PASS | `REAL_RUNTIME_PROVEN` |
| Qwen PAYG LLM→TTS overlap | PASS | `REAL_RUNTIME_PROVEN` |
| Token Plan native WS TTS | PASS | `PROBE_PROVEN` + `REAL_RUNTIME_PROVEN` |
| Token Plan real audible runtime | PASS | `REAL_RUNTIME_PROVEN` |
| Token Plan real LLM→TTS overlap | PASS | `REAL_RUNTIME_PROVEN` |
| Token Plan model catalog UI | PASS | `SOURCE_PROVEN` + Owner UI 验收 |
| Full ASR→LLM→TTS voice E2E | PENDING | `OPEN` |
| Barge-in | PENDING | `OPEN` |
| AEC | PENDING | `OPEN` |
| Android | NOT STARTED | `OPEN` |

“PASS”只表示本文对应的实验边界已被证明。尚未完成的 E2E、barge-in、AEC、Android 不得从这些 PASS 推导出来。

## 1. 文档目的与适用范围

这是 AIRI macOS-first realtime voice 集成的工程笔记。它帮助后续开发者理解为什么当前链路把路由、凭证、renderer、Electron main、远端 task 和本地播放分开，以及过去哪些看似合理的假设已经被事实推翻。

当前目标主链是：

```text
Streaming ASR → Streaming LLM → Streaming TTS
```

后续才扩展到 endpointing、VAD、barge-in、AEC 和 cancellation 的完整交互闭环。Android 当前尚未进入这条实验路线。

证据约定：

- `SOURCE_PROVEN`：可由当前 source/test 直接复现。
- `REAL_RUNTIME_PROVEN`：Owner 的真实 macOS AIRI runtime 已观察并记录。
- `PROBE_PROVEN`：独立、有界的真实协议 probe 已观察到结果。
- `OFFICIAL_DOC_SUPPORTED`：Alibaba 当前官方文档明确描述。
- `CURRENT_DESIGN_DECISION`：项目为安全、可测试或可维护性作出的选择。
- `OPEN` / `NOT_YET_PROVEN`：证据尚不充分或工作未完成，不得改写成 `UNSUPPORTED`。

## 2. 当前最终架构

主数据流：

```text
Microphone
  → PCM16 mono 16 kHz
  → Qwen realtime ASR
  → AIRI transcript / chat
  → streaming LLM
  → StageTtsSession
  → Qwen Token Plan TTS
  → PCM16LE mono 24 kHz
  → AudioContext
  → analyser / lipsync
  → speaker
```

安全边界：

```text
Renderer
  ↕ typed Eventa IPC
Electron main
  ↕ authenticated Alibaba WebSocket
Alibaba / Qwen Audio
```

Renderer 只持有 provider/model/voice 的非秘密选择和必要的 session ID。`DASHSCOPE_API_KEY`、`DASHSCOPE_WORKSPACE_ID`、`TOKEN_PLAN_API_KEY` 以及 `Authorization` header 只能在 Electron main 侧形成和使用。`SOURCE_PROVEN`、`CURRENT_DESIGN_DECISION`。

当前关键 source authority：

- `packages/stage-ui/src/libs/speech/tts-session.ts`：统一的 `StageTtsSession` 接口与 provider-aware resolver。
- `packages/stage-ui/src/libs/speech/qwen-tts-stage-session.ts`：PAYG `qwen3-tts-realtime` 的 Stage adapter。
- `packages/stage-ui/src/libs/speech/qwen-audio-tts-token-plan-stage-session.ts`：Token Plan native task protocol 的 Stage adapter。
- `packages/stage-ui/src/libs/speech/qwen-tts-pcm-playback.ts`：共享的 raw PCM16LE decoder、`AudioBuffer` 创建和调度器。
- `apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime/`：PAYG realtime ASR main service/protocol。
- `apps/stage-tamagotchi/src/main/services/airi/qwen-tts-realtime/`：PAYG Qwen3 realtime TTS main service/protocol。
- `apps/stage-tamagotchi/src/main/services/airi/qwen-audio-tts-token-plan/`：Token Plan TTS main service/protocol。
- `packages/stage-ui/src/components/scenes/Stage.vue`：Stage 入口、LLM token hooks、speech state、audio destination 和 lifecycle cancellation。

## 3. Capability / Billing Route Matrix

路由按 capability 选择，而不是用一个全局 `PAYG | Token Plan` 开关覆盖所有语音能力。这样允许 ASR、LLM、TTS 各自使用明确且相互隔离的计费/API route。`CURRENT_DESIGN_DECISION`。

| Capability | Provider / route | Model | Voice | Credential | Realtime 结论 |
| --- | --- | --- | --- | --- | --- |
| ASR | Qwen PAYG | `qwen-audio-3.0-asr-flash-streaming` | N/A | `DASHSCOPE_API_KEY` + `DASHSCOPE_WORKSPACE_ID` + `DASHSCOPE_REGION` | true realtime partial/final：YES |
| ASR | Token Plan Personal | `qwen-audio-3.0-asr-flash` | N/A | `TOKEN_PLAN_API_KEY` | 当前矩阵未提供等价的 live streaming replacement；`OPEN` |
| TTS | Qwen PAYG | `qwen3-tts-flash-realtime` | `Cherry` | PAYG route | native realtime WS；LLM→TTS overlap：PASS |
| TTS | Token Plan Personal | `qwen-audio-3.0-tts-plus` | AIRI 当前 canary：`longanlingxin` | `TOKEN_PLAN_API_KEY` | native WS runtime：PASS |
| Speech-to-speech | Token Plan Personal / realtime-plus | `qwen-audio-3.0-realtime-plus` | 由服务能力决定 | Token Plan route | protocol matrix：支持 AOQ/WebRTC/WebSocket；作为 end-to-end realtime speech conversation；AIRI custom-app API policy：`OFFICIAL_POLICY_CONFLICT_FOR_CUSTOM_APP_API_USE` |
| Realtime transcript seam | Token Plan Personal / realtime-plus | `qwen-audio-3.0-realtime-plus` | N/A | Token Plan route | push-to-talk/manual 下可先提交音频并接收 transcript，再独立决定是否发送 `response.create`；runtime entitlement 未证明 |

重要区分：`qwen-audio-3.0-asr-flash` 与 `qwen-audio-3.0-asr-flash-streaming` 不是同一个 model ID。当前官方 ASR model 文档把前者描述为非 realtime HTTP 模式，把后者描述为 realtime WebSocket 模式。[Alibaba ASR model 文档](https://help.aliyun.com/zh/model-studio/asr-model)（`OFFICIAL_DOC_SUPPORTED`）。

当前 Token Plan Personal 官方 overview 列出的音频模型至少包括：`qwen-audio-3.0-tts-plus`、`qwen-audio-3.0-realtime-plus`、`qwen-audio-3.0-asr-flash`，区域为华北 2（北京）。[Token Plan Personal overview](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)（`OFFICIAL_DOC_SUPPORTED`）。

Token Plan Personal 的当前官方 overview 与第三方工具页面明确规定：仅限兼容的 AI coding / agent tools 中的交互使用，并明确不支持自定义应用程序直接在自动化脚本或应用后端调用 API。故对 AIRI 自研应用 API 使用必须标记为 `OFFICIAL_POLICY_CONFLICT_FOR_CUSTOM_APP_API_USE`。这不是自行作出的法律结论；AIRI 是否能被 Alibaba/provider 明确认定为允许的“agent tool”仍需 provider explicit confirmation。Owner-operated interactive AIRI canary 的 runtime 成功不能覆盖该政策边界。`OFFICIAL_DOC_SUPPORTED` + `REAL_RUNTIME_PROVEN`，但不作法律保证。

## 4. Credential / Cost Isolation Rules

正式规则：

1. ASR PAYG 与 TTS Token Plan 可以同时存在。
2. Token Plan route 只读取 `TOKEN_PLAN_API_KEY`。
3. PAYG route 继续使用既有的 `DASHSCOPE_API_KEY`、`DASHSCOPE_WORKSPACE_ID`、`DASHSCOPE_REGION` authority。
4. `TOKEN_PLAN_API_KEY` 不能 fallback 到 `DASHSCOPE_API_KEY` 或 workspace-specific PAYG endpoint。
5. PAYG 失败不能 fallback 到 Token Plan；Token Plan 失败也不能 fallback 到 PAYG。
6. Renderer 不保存、不读取、不展示任何 key 或 workspace secret。
7. 日志不得打印 `Authorization`、`Bearer` credential、raw environment、cookies、完整 request headers、request bodies、用户语音、LLM 输出文本或 PCM/base64 音频。

这不是纯粹的类型设计，而是防止“用户以为消耗套餐 credits，实际却产生 PAYG 账单”的成本安全边界。`CURRENT_DESIGN_DECISION`，并由 main service 的独立 credential resolution 与 fake tests 进行 `SOURCE_PROVEN` 守护。

## 5. Qwen Realtime ASR Implementation

当前 PAYG realtime ASR 的 source protocol authority 是 `apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime/protocol.ts`：

```text
model = qwen-audio-3.0-asr-flash-streaming
input = PCM16 mono 16000 Hz
run-task:
  task_group = audio
  task = asr
  function = recognition
  streaming = duplex
finish-task lifecycle
```

main 侧根据 `DASHSCOPE_REGION` 选择 Beijing 或 Singapore 的 workspace endpoint，并由 `DASHSCOPE_WORKSPACE_ID` 构造 workspace-specific host：

```text
Beijing:  wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
Singapore: wss://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference
```

花括号只是协议模板，不是可用 credential。文档和测试只保留环境变量名称，不保留真实 workspace value。`SOURCE_PROVEN`。

Renderer 通过 typed Eventa IPC 请求 session、发送 PCM、结束任务；main 持有 authenticated WebSocket。partial/final 经过 main → renderer SSE/fullStream bridge 进入 Hearing pipeline。Renderer 不能直接持有 Qwen credential 或 main socket。`SOURCE_PROVEN`。

Hearing 侧的 `consumeRealtimeTranscriptionResult` 把 `transcript.text.snapshot` 当作完整 snapshot 替换当前 partial，而不是把每次 snapshot 当 delta 追加。sentence-final 只在对应的 final/sentence lifecycle 处提交一次。`StreamingTranscriptionConsumers` 按 `consumerId` fan-out 给 Hearing Playground 和 Stage voice input。`SOURCE_PROVEN`。

## 6. ASR Debugging Lessons

### A. 初始 Qwen realtime ASR transport bring-up

### Problem

需要在 AIRI 中把真实麦克风 PCM 接到 Qwen realtime ASR，同时保留 renderer/main 安全边界和 partial/final streaming。

### Root cause

此前没有 Qwen-specific main service、typed IPC 和 renderer fullStream bridge。这个结论来自新增 source/test 的边界，而不是对服务端行为的猜测。`SOURCE_PROVEN`。

### Fix

由 main 负责 credentials/WebSocket/task protocol，renderer 通过 Eventa IPC 发送受控 PCM，并将 partial/final 变成 AIRI 的 transcript snapshot。

### Regression guard

`a6dba95cc4708aaf9dbe718928da3ef5701e94eb` 加入 ASR service、protocol、provider、IPC 和 provider tests。

### B. Settings route / black-screen

### Problem

Speech/Hearing 设置进入 Qwen provider detail 后黑屏。

### Root cause

file-based route 需要对应的 Vue component，但 `packages/stage-pages/src/pages/settings/providers/transcription/qwen-audio-realtime-transcription.vue` 缺失，路径解析成 404。

### Fix

增加最小 provider detail page，并遵循现有 settings component 约定。

### Regression guard

`72db28f4c8b3cf5a0f369c383f99055f19e9e38e` 与对应 browser/settings test。

### C. Session failure / lifecycle race

### Problem

真实讲话和 VAD speaking 已发生，但 UI 最终只显示 `Qwen Audio realtime ASR session is not active.`，原始 WebSocket/session failure 被覆盖。

### Root cause

early socket/session error 后旧逻辑立即删除 `sessions`；并发到达的 `audio.append` 看见 session 不存在，于是抛出 generic inactive error。随后 WebSocket error callback 又丢失原始 details。`SOURCE_PROVEN`，并由 focused deterministic race test 证明。

### Fix

引入 bounded terminal-error retention/tombstone，第一 terminal failure 成为 authoritative error；后续 append/finish/cancel/close 不能覆盖它。WebSocket error/close 提取有限的 handshake status、error type、sanitized message、close code/reason；不保留 credential、audio 或 transcript。

### Regression guard

`6465045d8241a8faa050422b2492ef5799a573eb` 增加 main/protocol tests。

### D. Hearing partial transcript 不可见

### Problem

backend 已收到 partial，但 Hearing Playground 仍显示“正在等待语音”。

### Root cause

VAD speaking status 与 transcript display 是两个状态。原有 UI 渲染了 speaking/waiting 状态，却没有把 realtime snapshot 接到可见的 current transcription display。`SOURCE_PROVEN`。

### Fix

沿用既有 `StreamingTranscriptionConsumers` 和 Hearing Playground state，让 `transcript.text.snapshot` 走 `onTranscriptionUpdate` 替换当前 partial；speech end/final 再进入 segment/chat 流程。

### Regression guard

`385e8c191265adb0f9cca744d570955bf3bea1e2` 增加 Playground browser/segment tests。

### E. Electron main → renderer Eventa delivery / targeting

### Problem

main telemetry 显示 partial/final 已存在，但 Settings/Hearing renderer 没有显示任何文本。

### Root cause

异步 main Eventa emit 没有可靠地保留 originating renderer target；多个 Electron window 下，broadcast/错误 context 会导致事件丢失或发给无关窗口。installed adapter 语义和 fake Electron integration 共同证明了 target 必须按 session 保存。`SOURCE_PROVEN`。

### Fix

session 建立时捕获 `ipcMainEvent.sender` / 对应 renderer target。后续 partial、final、finished、error 只发送给该 target；Hearing consumer 仍由 originating renderer 自己注册。

### Regression guard

`404b99648d73de7e0b674e137195d5e27a001f01` 增加 renderer/main routing、fullStream 和 Playground delivery tests。

### F. Partial/final 去重与 sentence identity

### Problem

snapshot `你好` → `你好世界` 如果按字符串追加，会显示 `你好你好世界`；final 若再作为新片段提交，会重复显示。

### Root cause

把 snapshot 错当 delta，或没有区分 sentence lifecycle 与 stream lifecycle。`SOURCE_PROVEN`。

### Fix

partial snapshot 使用 replacement semantics；sentence-final 只在正确的 final event 处提交一次，consumer 的 callback failure 隔离，不让一个 consumer 破坏其他 consumer。

### Regression guard

`385e8c191265adb0f9cca744d570955bf3bea1e2` 与 `404b99648d73de7e0b674e137195d5e27a001f01` 的 pipeline/browser/provider tests。

### G. Pre-start PCM buffering

### Problem

renderer VAD/PCM 可能早于 remote `task-started` 到达，若立即发送或丢弃会破坏开头语音。

### Root cause

Qwen task 需要先进入 started/ready gate；无界等待会造成内存风险，直接丢弃会造成首段缺失。`SOURCE_PROVEN`。

### Fix

main session 使用 bounded pre-start PCM buffer（当前 `256 * 1024` bytes），task-started 后按顺序 flush；超限 fail closed，terminal/cancel/dispose 清空。

### Regression guard

ASR protocol tests 覆盖 queue、flush、overflow、cancel 和 dispose。

### H. Provider errors / credentials fail closed

### Problem

缺 credential、invalid region、handshake failure 或 server task failure 容易被错误地变成泛化“session inactive”，也可能诱发不安全 fallback。

### Root cause

credential resolution、transport state、renderer UI state 未分层；并且早期错误清理没有保存 cause。

### Fix

main-only credential resolution；provider-specific sanitized error；first terminal failure authority；Token Plan/PAYG 独立 route，禁止 silent fallback。

### Regression guard

ASR provider/main tests、Token Plan service/protocol tests、payload secret scans。

## 7. ASR Real Runtime Baseline

冻结基线：`QWEN_AUDIO_30_REALTIME_ASR_MACOS_BASELINE_V1`。这些数字是当前实验环境的记录，不是 SLA。`REAL_RUNTIME_PROVEN`。

| Metric | Real run 1 | Real run 2 |
| --- | ---: | ---: |
| `CONNECT_MS` | 321 | 772 |
| `TASK_START_MS` | 97 | 99 |
| `SPEECH_START_TO_FIRST_PARTIAL_MS` | 860 | 1649 |
| `FIRST_AUDIO_TO_FIRST_PARTIAL_MS` | 441 | 778 |
| `SPEECH_END_TO_FINAL_MS` | 403 | 707 |
| `FINAL_TO_AIRI_DELIVERY_MS` | 0 | 0 |

Owner 观察到：speech detected、realtime partial visible、没有 duplicate transcript，停顿可以形成 segment/final boundary。`PARTIAL_BEFORE_SPEECH_END` 由 `speechStartToFirstPartialMs` 与 speech-end/final telemetry 的 instrumentation semantics 支持，但不要从这些数字推导未测量的网络或播放 SLA。

## 8. Current Unresolved ASR→Chat Latency

当前语音输入有两个明确的 ingress mode，不能把它们合并成一个“ASR final → chat 都等待 1200 ms”的结论：

### Streaming ASR sentence-end

`handleStreamingSentenceEnd()` 在
`apps/stage-tamagotchi/src/renderer/pages/index.vue` 中先把 provider final
交给 `streamingVoiceTurnEndpoint`。它不经过 `voiceTranscriptBuffer`，但也不再把
每个 final 立即当成 chat boundary：本地 VAD activity end 启动一个
`STREAMING_VOICE_ENDPOINT_GRACE_MS = 500` 的 bounded endpoint decision，期间可把
后续 provider session 的 final 聚合到同一个逻辑 user turn。endpoint decision 才会
调用 `sendVoiceInputTextToChat(aggregatedText)`。`SOURCE_PROVEN`；这只改变
streaming ASR → chat 的 endpoint handoff，不改变 ASR wire 或 provider task 语义。

### Recorder-backed transcription

recorder path 的 `onTranscriptionResult` 仍然调用：

```ts
createTranscriptBuffer({
  flushDelayMs: 1200,
  maxBufferedTextLength: 90,
  // ...
})
```

其 `onTranscriptionResult → voiceTranscriptBuffer.push() → flush → chat` 路径
可以包含配置的 1200 ms 等待。这里的 `asrFinalToTranscriptFlushMs` 才能归因于
该 AIRI 产品层 buffer；它不是 Qwen ASR model/network latency。状态：
`OPEN / NOT_YET_OPTIMIZED`，但仅针对 recorder-backed buffer policy/latency。

因此，早先把 1200 ms 泛化为 Qwen streaming ASR final → chat 延迟的假设已撤回。
streaming path 的 `asrFinalToTranscriptFlushMs` 现在是 first final 到 endpoint
decision 的时间；它可能包含 VAD-anchored 500 ms grace，但不是 recorder 的 1200 ms。
后续完整 E2E 必须记录 `transcriptIngressMode` 与 endpoint reason，再分别测量 ASR
model/network、streaming endpoint decision、recorder buffer、LLM first token、TTS
first audio 和 local playback。

## 9. PAYG Qwen3 Realtime TTS Architecture

当前 PAYG route：

```text
provider = qwen3-tts-realtime
model = qwen3-tts-flash-realtime
voice = Cherry
mode = server_commit
audio = PCM16LE mono 24000 Hz
```

主链：

```text
raw LLM token
  → StageTtsSession.appendText()
  → Qwen3 provider Stage adapter
  → typed renderer/main Eventa IPC
  → PAYG Qwen3 realtime WebSocket
  → streamed PCM
  → qwen-tts-pcm-playback
  → AudioContext / analyser / lipsync / speaker
```

`packages/stage-ui/src/libs/speech/tts-session.ts` 保持上层接口：`appendText`、`appendSpecial`、`finishInput`、`end`、`cancel`。Stage chat hooks 不知道 Qwen WebSocket frame details。

远端 `session.finished` 不是本地听感完成。PCM bridge 必须等本地 owned `AudioBufferSourceNode` 全部 ended 后才 local drain；收到 remote finish 立即 stop 会截断尾音。`SOURCE_PROVEN` + `REAL_RUNTIME_PROVEN`。

## 10. PAYG TTS Debugging Lessons

### A. Main transport 建立

`1d40721736173f6cd98c9b3b1023992ffa5af18d` 增加 PAYG Qwen3 main transport、协议和 fake tests。安全边界是 main-only credential、renderer-scoped session events、bounded terminal error authority。`SOURCE_PROVEN`。

### B. PCM playback bridge

`a536aff8f418a37ebe88e06678422d96cafa3844` 增加 raw PCM16LE → Float32 → 24 kHz mono `AudioBuffer`、sequence ordering、gap handling、contiguous schedule、cancel/error stop、finished tail drain 和 fake AudioContext tests。不要用 `decodeAudioData` 处理 raw PCM，也不要 WAV wrap。`SOURCE_PROVEN`。

### C. Provider-aware Stage binding

`83f04abaf145901b5e5f413e3b1bb8c0d5727aa5` 把 `StageTtsSession` 从 transport-only 判断扩展成显式 `providerId` resolver。Official 的 `bidirectional-ws` 仍然走 `createStreamingTtsSession → createStreamingTtsPipeline`；PAYG Qwen3 走专用 adapter；REST providers 仍走原有 `IntentHandle / segmenter`。仅把 Qwen 标成 `bidirectional-ws` 而不做 provider-aware adapter 是错误的。

### D. Settings route black-screen

Provider detail page 是 file-based route。`454ec7404a2e093c2116ad2c83e20a533d8360c3` 增加 `packages/stage-pages/src/pages/settings/providers/speech/qwen3-tts-realtime.vue`，避免已注册 provider 缺 detail component 而进入黑屏。后续 Token Plan detail route 也需要同样的 component convention。`SOURCE_PROVEN`。

### E. Detail page 显示 Cherry ≠ active runtime selection

### Problem

页面可以显示 Qwen3 model/`Cherry`，但实际 Stage 创建 session 前仍可能没有 active voice，或 active provider 仍是旧 provider。

### Root cause

detail page 的静态显示与 speech store 的 `activeSpeechProvider`、`activeSpeechModel`、`activeSpeechVoiceId`、`activeSpeechVoice` 是不同状态层。一次真实 runtime 还证明过 Token Plan detail page 显示正确，但 Stage 实际仍运行 PAYG Qwen3，从而报 PAYG key unavailable。

### Fix

`ba8bd88a4aa04594aa02984a9321defae45ce248` 与 `c502218cdfd9cd1d473e3bc6affff3bdb804d630` 修复/覆盖 canonical provider/model/voice selection。Stage 不允许用 `?? 'Cherry'` 之类 fallback 掩盖 store inconsistency。

### Reusable lesson

设置页的视觉正确不等于 runtime truth。每次 cold start、跨窗口 provider switch、model reload 都要验证 provider、model、voiceId、resolved VoiceInfo 四者一致。`SOURCE_PROVEN`。

### F. Renderer console telemetry owner 不可观察

`38c5a7ae435a40545ded6e18cf6b22e2be6d51b5` 增加 renderer Stage timing；Owner 打开的 DevTools 不一定属于产生 Qwen session 的 renderer。`ae14679e78db436ca613bb7cdad19c43a4a57e0e` 把 bounded content-free summary 通过 typed renderer→main invoke 送入 Bash/main log，保留 renderer clock 语义，不跨进程相减。`SOURCE_PROVEN`。

### G. Cancellation / local tail semantics

cancel 先停止本地 PCM sources，再通知 main cancel；不等待网络 cancel。正常 `session.finished` 不截断已排队 audio；Stage `onDone` 等 remote finish + local drain。Qwen3 Stage telemetry 只有在成功 terminal state 才输出成功 summary。`SOURCE_PROVEN`。

### H. Multi-window Eventa targeting

main service 在 session start 时保存 originating renderer target，后续音频、finished、error 只发给该 renderer。不能把语音音频 broadcast 到 Settings、Stage 或其他 window。`SOURCE_PROVEN`。

### I. Terminal error / session race

PAYG ASR 的 first-failure authority 原则也适用于 TTS：first terminal transport/protocol/server failure authoritative；late append/finish 不得替换成 `session is not active`、`disposed` 或 `cancelled`。使用 bounded tombstone，terminal cleanup 仍必须发生。`SOURCE_PROVEN` + `CURRENT_DESIGN_DECISION`。

### J. Token Plan route isolation

Token Plan 与 PAYG 不共享隐式 credential detection、endpoint、model、voice 或 fallback。`qwen-audio-tts-token-plan` 只使用 `TOKEN_PLAN_API_KEY`、`qwen-audio-3.0-tts-plus`、`longanlingxin` 和北京 Token Plan native WS；PAYG 继续使用 `qwen3-tts-flash-realtime`、`Cherry` 和既有 PAYG route。`8a855078e81f2ef418c1d1a3e0e6133e0d22f94c` 起由 provider/main/fake tests 守护。

## 11. PAYG TTS Runtime Baselines

以下是已接受的 macOS 实验基线，不是 SLA。`REAL_RUNTIME_PROVEN`。

### 短句

`QWEN3_REALTIME_TTS_MACOS_CANARY_BASELINE_V1`

| Metric | Value |
| --- | ---: |
| `CONNECT_MS` | 387 |
| `SESSION_READY` | 136 |
| `FIRST_SENT_TEXT_TO_FIRST_AUDIO` | 335 |
| `FINISH_TO_SESSION_FINISHED` | 908 |
| `AUDIBLE` | PASS |
| `CONTINUITY` | PASS |
| `TAIL` | PASS |

### 长文本 streaming overlap

`QWEN3_REALTIME_TTS_MACOS_STREAMING_OVERLAP_BASELINE_V1`

| Metric | Value |
| --- | ---: |
| `CONNECT` | 310 |
| `SESSION_READY` | 89 |
| `FIRST_SENT_TEXT_TO_FIRST_AUDIO` | 317 |
| `FINISH_TO_SESSION_FINISHED` | 12781 |
| `FIRST_LLM_TEXT_TO_APPEND` | 0.10 |
| `FIRST_LLM_TEXT_TO_AUDIO_EVENT` | 317.60 |
| `FIRST_LLM_TEXT_TO_PLAYBACK_SCHEDULE` | 318 |
| `FIRST_AUDIO_EVENT_RELATIVE_TO_INPUT_FINISH` | -582.90 |
| `FIRST_AUDIO_SCHEDULED_RELATIVE_TO_INPUT_FINISH` | -582.50 |
| `REMOTE_FINISH_TO_LOCAL_DRAIN` | 57032.70 |
| `REAL STREAMING OVERLAP` | PASS |

负值表示第一块音频事件/调度早于 LLM input stream finish；它不是“第一音频延迟”。两者必须分开报告。

## 12. Token Plan Discovery / Entitlement Lessons

### A. Personal route 是北京

当前中国站 Token Plan Personal overview 记录 region 为华北 2（北京），Base URL 为 `https://token-plan.cn-beijing.maas.aliyuncs.com`，而不是上一轮错误报告中的 Singapore-only。`OFFICIAL_DOC_SUPPORTED`。

### B. HTTP/SSE 与 native WS 的证据等级不同

最初官方 Token Plan 文档明确支持 HTTP/SSE TTS，但没有直接为 `qwen-audio-3.0-tts-plus` + Token Plan native WS entitlement 给出足够清晰的专属说明。因此当时正确状态是：

```text
TOKEN_PLAN_TTS_HTTP = PROVEN
TOKEN_PLAN_NATIVE_WS = NOT_YET_PROVEN
```

不能把 `NOT_YET_PROVEN` 写成 `UNSUPPORTED`。

### C. Owner-shell bounded probe

HTTP control 使用：

```text
POST https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer
model = qwen-audio-3.0-tts-plus
```

观察到 HTTP 200、`text/event-stream`，并通过 bounded output 验证 TTS response。probe 不打印 key、Authorization、完整 response body 或音频。

### D. Candidate native WS 后续实测通过

实测 candidate：

```text
wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
```

第一次 probe 因 frame/finish sequencing 问题未得到完整结果；修正 probe 后 Owner 观察到 upgrade、auth、model entitlement、task start、binary audio、result-generated sentence lifecycle、task-finished 和正常 close。故该 endpoint 当前标记为 `PROBE_PROVEN / REAL_RUNTIME_PROVEN`，而不是仅凭某个页面把它宣称为 Token Plan TTS 专属官方 endpoint。`OFFICIAL_DOC_SUPPORTED` 只支持 protocol family，entitlement 由 probe/runtime 支持。

## 13. Realtime-plus transcript seam 与 Token Plan policy correction

本节修正上一轮 architecture preflight 的两个证据偏差：Token Plan Personal 的 custom-app/API 使用政策，以及 Qwen-Audio-Realtime 在 push-to-talk 模式下的 transcript-first seam。

### A. Token Plan Personal policy

当前中国站官方公开规则不是“所有自研交互应用都未分类”，而是明确规定 Token Plan Personal 仅供个人在指定的 AI coding / agent tools 中交互使用，并明确不支持自定义应用程序直接在自动化脚本或应用后端调用 API。`more-tools` 页面进一步把工作流/自动化平台、API 测试工具和自定义应用程序列为不支持类型；FAQ 也把生产自动化、批量脚本和后台定时任务列为不允许场景。[Token Plan Personal overview](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)、[更多工具](https://help.aliyun.com/zh/model-studio/more-tools)、[Token Plan Personal FAQ](https://help.aliyun.com/zh/model-studio/token-plan-personal-faq)（`OFFICIAL_DOC_SUPPORTED`）。

因此本项目不得再把政策状态写成简单的 `NOT_YET_CLEARED`：

```text
TOKEN_PLAN_CUSTOM_AIRI_POLICY = OFFICIAL_POLICY_CONFLICT_FOR_CUSTOM_APP_API_USE
```

这不是法律意见，也不自行判断 AIRI 是否属于官方所称的“agent tool”。如果要继续把 Token Plan Personal 用于 AIRI，自研应用是否可被 provider 明确认定为允许类别必须取得 provider explicit confirmation；在确认前，正式架构决策为：

```text
HOLD_REAL_TOKEN_PLAN_CUSTOM_APP_CALLS
```

FAQ 同时提醒，Key、Base URL 或模型白名单不匹配可能导致 401/403、`model_not_found`，或错误进入按量计费路径；因此不能用 runtime “能通”反推政策允许，也不能用失败时的 PAYG route 兜底。

### B. push-to-talk transcript-first seam

官方 Qwen-Audio-Realtime WebSocket 文档将 `turn_detection=null` 定义为 push-to-talk/manual 模式。此模式下客户端持续发送 `input_audio_buffer.append`，说完后发送 `input_audio_buffer.commit`；`commit` 只把音频提交为用户消息，不自动触发推理，之后是否发送独立的 `response.create` 由客户端决定。[Qwen-Audio Realtime WebSocket API](https://help.aliyun.com/zh/model-studio/fun-audiochat-realtime-websocket-api)（`OFFICIAL_DOC_SUPPORTED`）。

对 AIRI 的 transcript-first 集成，协议因果链应记录为：

```text
input_audio_buffer.append
  → conversation.item.input_audio_transcription.delta (zero or more)
  → input_audio_buffer.commit
  → conversation.item.input_audio_transcription.completed
  → input_audio_buffer.committed
  → conversation.item.created
  → response.create (optional, independent inference trigger)
```

官方 client events 明确写出：`input_audio_buffer.commit` 在 push-to-talk 下创建用户消息但不会触发 inference，必须另发 `response.create` 才开始模型推理；server events 明确提供 `conversation.item.input_audio_transcription.delta`、`conversation.item.input_audio_transcription.completed`、`input_audio_buffer.committed` 和 `conversation.item.created`。[Qwen-Audio client events](https://help.aliyun.com/zh/model-studio/fun-audiochat-client-events)、[Qwen-Audio server events](https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-server-events)（`OFFICIAL_DOC_SUPPORTED`）。

证据边界也必须保留：官方页面明确保证 `commit` 与 `response.create` 的因果分离，并描述上述 server event family；不同服务端实现可能让 delta、completed、committed、item-created 的到达时间交错，不能把页面示例误读为每个事件都具有不可交错的严格总顺序。对 AIRI 足够的结论是：在不发送 `response.create` 的情况下，客户端至少有一个官方支持的 transcript delivery seam，可以把用户音频转写交给 AIRI 自己的 LLM；这不等价于 standalone ASR 产品，也不等价于 Token Plan runtime entitlement 已通过。

### C. 三个结论必须分开

```text
ARCH_C_TRANSCRIPT_ONLY_SEAM = OFFICIAL_PROTOCOL_SUPPORTED
TOKEN_PLAN_REALTIME_PLUS_ENTITLEMENT_RUNTIME_PROVEN = NOT_RUNTIME_PROVEN
TOKEN_PLAN_CUSTOM_AIRI_POLICY_ALLOWED = NOT_CONFIRMED / PUBLISHED_POLICY_CONFLICT
```

第一个结论是协议能力；第二个是账号、Key、地域和实际调用路径的运行时事实；第三个是服务使用政策。三者不能互相替代。当前既没有 Token Plan `qwen-audio-3.0-realtime-plus` 的 AIRI 专属 entitlement 实测，也没有 provider 对 AIRI custom/agent 分类的明确确认。

### D. ARCH_A、ARCH_C' 与 ARCH_B

#### ARCH_A

```text
qwen-audio-3.0-asr-flash-streaming (PAYG standalone ASR)
  → AIRI transcript
  → AIRI streaming LLM
  → AIRI TTS
```

这是当前已验证的分层方式。它保留 AIRI 的 transcript、persona、history、memory、tools、LLM token authority、`StageTtsSession`、speaking、lipsync 和 cancellation。不得因为 realtime-plus 出现在 Token Plan model catalog 中就替换这条已通过 baseline 的路径。

#### ARCH_C'

```text
Qwen-Audio-Realtime input audio/transcript events
  → AIRI streaming LLM
  → AIRI TTS
  （push-to-talk/manual；不发送 response.create）
```

ARCH_C' 的 transcript-first seam 在协议层为 `OFFICIAL_PROTOCOL_SUPPORTED`，是上一轮 `ARCH_C = NOT_SUPPORTED_BY_PROTOCOL` 的修正。它仍然需要确认 Token Plan Personal 对 AIRI custom application 的政策适用性与 realtime-plus 的实际 entitlement；在这两项解决前，不得作为生产路线选择。

#### ARCH_B

```text
Qwen-Audio-Realtime
  → vendor text/audio response
```

ARCH_B 是官方支持的端到端 speech-to-speech 形态：模型同时接收 Audio/Text 并输出 Audio/Text，支持 Function Calling；但它会让 vendor realtime session 成为主要的 response、turn、history 和 audio authority。若要保持 AIRI persona、memory、tools 和本地会话语义，就需要显式同步或重建这些语义，不能把它当成当前 `StageTtsSession` 的透明替换。

本任务不在 ARCH_A 与 ARCH_C' 之间作生产路线选择，也不批准 ARCH_B 替代 AIRI LLM。当前唯一有效的下一步裁决是：

```text
HOLD_REAL_TOKEN_PLAN_CUSTOM_APP_CALLS
```

直到取得 provider 明确允许，或改用允许 custom application API 的计费/credential route。

### E. server_vad、smart_turn 与 interruption

官方文档说明：

- `server_vad`：服务端检测语音结束并自动触发推理。
- `smart_turn`：结合声学/语义判断 turn，某些无意义声音不会触发对话轮。
- `turn_detection=null`：关闭 VAD，进入手动 push-to-talk。
- `response.cancel`：取消当前 response；服务端返回 cancelled 状态。
- realtime response 也可能因用户新语音而被 server 侧打断。

因此 server-side VAD、turn detection 和 response cancellation 可以减少未来自研 endpointing、自然停顿和部分 barge-in 状态机工作，尤其适合 ARCH_B 或需要 vendor-managed turn 的路线。但它们不自动提供完整 AEC；官方 capability matrix 明确 WebSocket 没有内建回声消除/降噪，AOQ 与 WebRTC 才有相应能力。[Realtime API overview](https://help.aliyun.com/zh/model-studio/realtime-api-overview)（`OFFICIAL_DOC_SUPPORTED`）。

如果 AIRI 只要 transcript，push-to-talk/manual 是最干净的协议 seam：AIRI 决定何时 commit，也决定是否发送 `response.create`。当前未找到一种同时使用 server endpointing、又由官方配置完全阻止 vendor inference 的 realtime-plus 模式，因此该组合标记为 `NOT_YET_PROVEN`。

### F. 当前 capability 裁决

| 项目 | 裁决 | 证据级别 |
| --- | --- | --- |
| `qwen-audio-3.0-realtime-plus` 在 Token Plan Personal model catalog | YES | `OFFICIAL_DOC_SUPPORTED` |
| realtime-plus 的 AOQ/WebRTC/WebSocket protocol matrix | YES | `OFFICIAL_DOC_SUPPORTED` |
| ARCH_C' transcript-before-`response.create` seam | YES | `OFFICIAL_DOC_SUPPORTED` |
| Token Plan realtime-plus AIRI custom-app runtime entitlement | NOT_YET_PROVEN | `OPEN` |
| Token Plan Personal 对 AIRI custom-app API 的政策允许 | NOT_CONFIRMED / `OFFICIAL_POLICY_CONFLICT_FOR_CUSTOM_APP_API_USE` | `OFFICIAL_DOC_SUPPORTED` |
| realtime-plus 等价替换 standalone ASR | NO | model/protocol semantics differ |
| realtime-plus 作为 current Token Plan TTS adapter | NO / NOT_YET_PROVEN | 未发现 incremental TTS-only contract |

## 14. Token Plan Native WS Protocol Lessons

当前被 runtime 证明的 flow：

```text
socket open
  → run-task
  → task-started
  → zero or more continue-task
  → finish-task
  → continue receiving audio/result
  → task-finished
  → close
```

`run-task` 关键字段：`task_group=audio`、`task=tts`、`function=SpeechSynthesizer`、`streaming=duplex`、`model=qwen-audio-3.0-tts-plus`；parameters 使用 `PlainText`、canary voice、`format=pcm`、`sample_rate=24000`、`volume=50`、`rate=1.0`、`pitch=1.0`、`enable_ssml=false`，`input={}`。`SOURCE_PROVEN` + `PROBE_PROVEN`。

`continue-task` 使用同一个 `task_id`、`streaming=duplex`，payload 为 `input.text`。没有必须等待的 continue-task ACK；downstream audio/result 证明其功能性接受。`finish-task` 也使用同一个 task ID、`streaming=duplex`、`input={}`；发送后仍必须接收 audio/result。

取消使用本地立即停止 + 远端 cancel directive 的 route-specific 处理，不等同 graceful finish。remote task-finished 只表示远端生成完成，不能清掉本地播放 tail。

## 15. Token Plan Probe Schema Failure

第一次 WS probe 的错误不是 provider unsupported，而是 probe 自身与协议不一致：

- `run-task` 缺少 `volume`、`rate`、`pitch`、`enable_ssml`。
- `continue-task` 缺少 `streaming=duplex`。
- `finish-task` 缺少 `streaming=duplex` 或 `payload.input={}`。
- `task-failed` 只输出泛化 `provider_error: server error`，没有正确保留 `error_code` / `error_message`。
- 旧 sequencing 先等待 audio 再发送 finish-task，违反短句 probe 应立即 finish 的控制流。

修正后 probe：`task-started → continue-task → finish-task → continue receive audio/result → task-finished`，实际得到 binary audio 和完整 lifecycle。`a3a9dc1dadc1f4a6360070efea2dfd99ba56bed0` 修复 AIRI runtime 的同类 crossws frame-kind 问题；probe 复核经验本身属于可复用的 `PROBE_PROVEN` lesson。

## 16. Provider Detail Page vs Active Runtime Selection

一次真实失败清楚地说明：Token Plan detail page 能显示 `qwen-audio-3.0-tts-plus` / `longanlingxin`，不等于它已成为 active speech source。Stage 实际仍可能运行旧的 `qwen3-tts-realtime` / `qwen3-tts-flash-realtime`，最终报 `Qwen3 realtime TTS API key is unavailable`。

正式 runtime truth 是：

```text
activeSpeechProvider
activeSpeechModel
activeSpeechVoiceId
activeSpeechVoice
```

而不是 detail page 的视觉内容。`SOURCE_PROVEN` + `REAL_RUNTIME_PROVEN`。

## 17. Runtime Voice Hydration Lesson

`activeSpeechVoiceId` 和 resolved `activeSpeechVoice: VoiceInfo | undefined` 是不同层次。Streaming snapshot 使用 resolved voice object 的 id；只恢复 string ID 而没有从当前 provider catalog hydrate object，仍会在 session creation 前 fail closed。

所有跨窗口、cold start、provider switch、persisted restore、model reload 流程都必须最终证明：

```text
provider + model + voiceId + voice object
```

四者一致。不能在 `Stage.vue` 里用 Cherry 或其他 voice 做硬编码 fallback。`SOURCE_PROVEN` + `CURRENT_DESIGN_DECISION`。

## 18. Token Plan Silent Runtime / Instrumentation

曾出现：persistent provider/model/voice 看起来正确、`muted=false`，但没有声音、没有表面 error、也没有 transport success/failure log。静态 UI 不足以证明 session entry。

因此加入 bounded、content-free milestones：

Renderer/Stage：

```text
STAGE_BEFORE_MESSAGE
STAGE_PROVIDER_SELECTED
STAGE_MODEL_SELECTED
STAGE_VOICE_ID_SELECTED
STAGE_VOICE_OBJECT_RESOLVED
STAGE_MUTED
STAGE_TRANSPORT_RESOLVED
STAGE_AUDIO_CONTEXT_AVAILABLE
STAGE_SNAPSHOT_READY
STAGE_SESSION_CREATED
TOKEN_PLAN_RENDERER_START_REQUESTED
TOKEN_PLAN_RENDERER_START_RESOLVED
TOKEN_PLAN_FIRST_APPEND_REQUESTED
TOKEN_PLAN_FINISH_REQUESTED
```

Main：

```text
MAIN_SESSION_START_RECEIVED
TOKEN_PLAN_CREDENTIAL_PRESENT
SOCKET_CREATED
SOCKET_OPEN
RUN_TASK_SENT
TASK_STARTED
FIRST_CONTINUE_TASK_SENT
FIRST_BINARY_AUDIO_RECEIVED
FINISH_TASK_SENT
TASK_FINISHED
TASK_FAILED
SOCKET_ERROR
SOCKET_CLOSE
```

原则：realtime pipeline 不能只记录 success/failure；必须记录不含内容的 pipeline milestones，且不打印 token、prompt、PCM、key 或 Authorization。`SOURCE_PROVEN`。

## 19. Critical crossws Frame-Kind Bug

### Runtime symptom

```text
RUN_TASK_SENT
  → 没有 TASK_STARTED
  → TASK_FAILED
  → audio arrived before task-started
```

### Root cause

installed `crossws` 0.4.12 Node adapter 使用近似 `message(data, isBinary)` 的 EventEmitter contract。text frame 与 binary frame 的 `data` 都可能是 Node `Buffer`；旧逻辑按 JavaScript payload shape 把 `Buffer`/TypedArray 自动当成 PCM，从而把 JSON `task-started` Buffer 错认成 audio。`SOURCE_PROVEN`：installed implementation/type audit、fake regression 和真实错误形态一致。

### Rule

显式 frame-kind metadata 是 authority：

```text
isBinary = false → UTF-8 JSON text
isBinary = true  → PCM binary
```

只有 metadata 缺失的 test/legacy seam 才允许 bounded shape inference；production crossws path 必须保留第二个 callback argument。`a3a9dc1dadc1f4a6360070efea2dfd99ba56bed0` 修复。

### General Node WebSocket portability rule

不要把 Buffer/Uint8Array/ArrayBufferView 的 JavaScript 类型当作 frame kind。Node/WebSocket adapter 可能用相同 payload representation 表示 text 和 binary；任何 provider/backend port 都必须保留并测试显式 frame metadata。

## 20. Token Plan Short Runtime Baseline

`QWEN_AUDIO_TOKEN_PLAN_NATIVE_WS_TTS_MACOS_CANARY_BASELINE_V1`，proof HEAD 为 `a3a9dc1dadc1f4a6360070efea2dfd99ba56bed0`。`REAL_RUNTIME_PROVEN` + `PROBE_PROVEN`。

| Metric | Value |
| --- | ---: |
| `CONNECT` | 603 |
| `TASK_STARTED` | 102 |
| `FIRST_SENT_TEXT_TO_FIRST_AUDIO` | 662 |
| `FINISH_TO_TASK_FINISHED` | 1012 |
| `AUDIBLE` | PASS |
| `CHINESE_CLEAR` | PASS |
| `CONTINUITY` | PASS |
| `TAIL_COMPLETE` | PASS |
| `VISIBLE_ERROR` | NO |
| `SOCKET_CLOSE` | 1000 |

## 21. Token Plan Real Streaming Overlap Baseline

`QWEN_AUDIO_TOKEN_PLAN_NATIVE_WS_TTS_MACOS_STREAMING_OVERLAP_BASELINE_V1`，proof HEAD 为 `def22aded10d6b7f8ae1c35c5ef13c4036590e4e`。`REAL_RUNTIME_PROVEN`。

| Metric | Value |
| --- | ---: |
| `CONNECT` | 409 |
| `TASK_STARTED` | 123 |
| `FIRST_SENT_TEXT_TO_FIRST_AUDIO` | 611 |
| `FINISH_TO_TASK_FINISHED` | 12713 |
| `FIRST_LLM_TEXT_TO_TEXT_APPEND` | 0 |
| `FIRST_LLM_TEXT_TO_AUDIO_EVENT` | 611.60 |
| `FIRST_LLM_TEXT_TO_PLAYBACK_SCHEDULE` | 611.90 |
| `FIRST_AUDIO_EVENT_RELATIVE_TO_INPUT_FINISH` | -127.00 |
| `FIRST_AUDIO_SCHEDULED_RELATIVE_TO_INPUT_FINISH` | -126.70 |
| `REMOTE_FINISH_TO_LOCAL_DRAIN` | 39626.10 |
| `REAL STREAMING OVERLAP` | PASS |

负 overlap 值证明第一块 audio 已在 LLM input stream 完成前进入 audio event/playback schedule。它不能被改写成“第一音频等待了 126.7ms”；signed overlap 和 first-audio latency 是不同指标。

## 22. Long Local Drain Is Not Automatically a Bug

PAYG 和 Token Plan 都曾观察到 remote generation finished 后，本地 playback 仍 drain 数十秒。原因可能是 provider 生成 audio 的速度高于人类播放速度，本地已经排队了大量 PCM。

因此：

```text
remote finish ≠ audible finish
```

正常结束必须是 remote finish + local owned source drain；cancel/error 才立即 stop。本规则由 PCM bridge、Stage adapter tests 与 real runtime tail completion 共同支持。`SOURCE_PROVEN` + `REAL_RUNTIME_PROVEN`。

## 23. Token Plan Model Catalog UI Bug

Speech 主设置页曾同时显示：

```text
Current Model: qwen-audio-3.0-tts-plus
没有任何可用的模型
```

### Root cause

`packages/stage-pages/src/pages/settings/modules/speech.vue` 早期只在 `qwen3-tts-realtime` 上调用静态 Qwen model catalog helper；Token Plan detail page 自己能展示 catalog，但主 Speech page 的 persisted startup/provider-switch path 没有调用同一 authority。

### Fix

`dc76e677a6d7bfed3822f5b3493525e149bdf9ee` 增加共享的 `speech-model-catalog.ts` helper，并在主页面 mount/provider change 处理 `qwen3-tts-realtime` 与 `qwen-audio-tts-token-plan`。focused tests 覆盖 persisted startup、provider switch、switch back 和真实 empty provider 的 empty state。

### Lesson

不要通过隐藏 empty warning 掩盖 catalog 缺失；要在正确 lifecycle 加载真实静态 catalog，并保持 genuinely empty provider 的 warning。`SOURCE_PROVEN`。

## 24. Voice Catalog Clarification

AIRI 当前 Token Plan provider 静态注册的 voice 只有 `longanlingxin`，表示当前 canary UI 只暴露一个确定的系统/技术 donor voice，不表示 Alibaba server 只有一个 voice。官方 voice list 文档描述了更大的可用集合；完整 voice catalog/selection UX 是 backlog。`SOURCE_PROVEN` + `OFFICIAL_DOC_SUPPORTED` + `OPEN`。

## 25. Logging / Diagnostics Safety

允许记录：

- provider ID、model ID、voice ID；
- bounded/truncated session ID；
- numeric latency 和 state milestone；
- sanitized provider error code/message；
- close code/reason（经过长度与敏感字段过滤）。

禁止记录：

- API key、`Authorization`、Bearer value；
- raw environment、workspace value、cookies；
- user utterance、prompt、LLM response/token；
- raw PCM、base64 audio、完整 provider payload。

主进程日志应记录 bounded final summary，而不是每个 token/audio event。renderer console 只是 developer aid，不能作为 Owner audit 的唯一渠道。`CURRENT_DESIGN_DECISION` + `SOURCE_PROVEN`。

## 26. Runtime State Authority

后续 App/Android 开发必须把这些状态分开：

```text
configured state
persisted state
renderer reactive state
main-process credential state
provider transport state
remote task state
local playback state
```

任何一层的 UI 展示都不是完整 runtime truth。例如 detail page 的 voice 和 persisted voice ID 正确，不保证 renderer 已 hydrate `VoiceInfo`；remote `task-finished` 正确，不保证 speaker tail 已结束。

## 27. Session / Race Safety

所有 realtime provider 可复用的安全原则：

- stable session ID；
- renderer-scoped Eventa delivery；
- 由 originating renderer/window 持有 session target；
- strict audio sequence；
- bounded pre-ready buffer；
- finish 后拒绝 append；
- finish idempotent；
- local cancel first；
- first terminal error authoritative；
- bounded terminal-error tombstone；
- terminal/cancel 后忽略 late event；
- remote finish + local drain 后才 `onDone`；
- success telemetry exactly once；
- dispose 清除 target、queue、listeners、sources，不留下永久 session leak。

## 28. Future App Porting Checklist

- [ ] capability-scoped ASR/TTS route
- [ ] credential isolation
- [ ] billing route explicit
- [ ] no silent fallback
- [ ] PCM format verified
- [ ] WebSocket frame metadata preserved
- [ ] task-started gate
- [ ] bounded pre-ready buffering
- [ ] partial/final transcript identity
- [ ] renderer/session targeting
- [ ] cancel race handling
- [ ] remote-finish/local-drain separation
- [ ] active provider/model/voice runtime state
- [ ] cold-start catalog hydration
- [ ] cross-window state propagation
- [ ] content-free telemetry
- [ ] latency baselines
- [ ] real microphone validation
- [ ] real speaker validation
- [ ] overlap validation

## 29. Known Remaining Work

以下未完成，不得写成已完成：

1. Full real microphone `Streaming ASR → LLM → Token Plan Streaming TTS` 同一轮完整 E2E。
2. recorder-backed transcript buffer policy/latency 优化；这不是 Qwen streaming ASR sentence-end 的 blocker。
3. Streaming ASR bounded user-turn endpoint policy 的自然停顿调参与真实验证；当前已实现 V1：以最新 local VAD activity end 为锚的 500 ms grace，并跨 provider session 聚合 final，见 Section 34。
4. Barge-in。
5. VAD 与更完整的 speaking/echo coordination。
6. AEC / self-voice rejection。
7. Multi-turn realtime stability。
8. Android port。
9. Token Plan full voice catalog / voice selection UX。
10. Token Plan Personal 对 AIRI custom application API use 的 provider explicit confirmation；在确认前保持 `HOLD_REAL_TOKEN_PLAN_CUSTOM_APP_CALLS`。
11. Token Plan `qwen-audio-3.0-realtime-plus` 的 AIRI-specific runtime entitlement、credential 和 endpoint mapping。
12. ARCH_C' transcript-first seam 的 AIRI adapter 设计验证；协议 seam 已获官方支持，但不代表 Token Plan entitlement 或 policy 已通过。
13. 在不触发 vendor inference 的前提下，server endpointing 与 transcript-only 组合是否有官方配置；当前为 `NOT_YET_PROVEN`。

当前 Token Plan real TTS 与 LLM→TTS overlap 已有独立短句/长文本 PASS；这不等于第 1 项完整 ASR→LLM→TTS 已 PASS。

## 30. Chronological Incident / Commit Table

下表使用完整 SHA 和真实 commit message，便于后续定位相似事故。日期来自当前 branch 的 git history。

| Date/order | Commit | Subsystem | Symptom / change | Root cause / fix | Evidence | Reusable lesson |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-30 | `0a30c2298f901c07df3f73aa8341476e7e9329a0` — `fix(better-ws): publish the package so server-sdk installs (#2408)` | dependency baseline | realtime 实验的 WebSocket package 安装基础 | 发布 `better-ws` package | `SOURCE_PROVEN` | 先确认实际依赖版本，再判断 WebSocket 行为 |
| 2026-08-31 | `a6dba95cc4708aaf9dbe718928da3ef5701e94eb` — `feat(stage-ui): add Qwen Audio realtime ASR canary` | ASR | 初始 realtime ASR bring-up | main service、protocol、typed IPC、provider 和 tests | `SOURCE_PROVEN` | 语音 transport 先做明确安全边界 |
| 2026-08-31 | `72db28f4c8b3cf5a0f369c383f99055f19e9e38e` — `fix(stage-ui): repair Qwen realtime ASR settings view` | ASR settings | provider detail 黑屏 | 缺少 file-based detail route component | `SOURCE_PROVEN` | 注册 provider 必须同步提供 route component |
| 2026-08-31 | `6465045d8241a8faa050422b2492ef5799a573eb` — `fix(stage-ui): preserve Qwen ASR first runtime failure` | ASR lifecycle | generic inactive error 掩盖首个 WS failure | session 删除与并发 append race；error details 丢失 | `SOURCE_PROVEN` + deterministic tests | first terminal failure 必须有 authority |
| 2026-08-31 | `385e8c191265adb0f9cca744d570955bf3bea1e2` — `fix(stage-ui): surface Qwen realtime ASR partial transcription` | Hearing UI | speaking 中仍显示 waiting | status 与 partial transcript display 未接通 | `SOURCE_PROVEN` + browser tests | VAD status 不等于 transcript state |
| 2026-08-31 | `404b99648d73de7e0b674e137195d5e27a001f01` — `fix(stage-ui): deliver Qwen realtime transcript to Hearing playground` | Eventa/Hearing | main 有 partial/final，Playground 无文本 | async renderer target/consumer delivery seam | `SOURCE_PROVEN` + integration tests | 异步事件必须保存 originating window |
| 2026-08-31 | `1d40721736173f6cd98c9b3b1023992ffa5af18d` — `feat(stage-ui): add Qwen3 realtime TTS main transport` | PAYG TTS | 新建 Qwen3 realtime main route | main-owned credentials、WS protocol、renderer-scoped events | `SOURCE_PROVEN` | TTS transport 与 ASR transport 分开 |
| 2026-08-31 | `a536aff8f418a37ebe88e06678422d96cafa3844` — `feat(stage-ui): add Qwen3 realtime PCM playback bridge` | PCM | raw PCM 需要 renderer 播放 | Float32/AudioBuffer/ordered schedule/cleanup | `SOURCE_PROVEN` | raw PCM 不能走 encoded audio decoder |
| 2026-08-31 | `83f04abaf145901b5e5f413e3b1bb8c0d5727aa5` — `feat(stage-ui): bind Qwen3 realtime TTS to Stage` | Stage binding | `bidirectional-ws` provider 需要区分 Official/Qwen | provider-aware `StageTtsSession` resolver | `SOURCE_PROVEN` + fake E2E | transport label 不能代替 provider identity |
| 2026-08-31 | `454ec7404a2e093c2116ad2c83e20a533d8360c3` — `fix(stage-pages): add Qwen3 realtime TTS settings view` | PAYG settings | detail route 黑屏 | 缺少 `qwen3-tts-realtime.vue` | `SOURCE_PROVEN` | settings route 是可测试的 file contract |
| 2026-09-01 | `ba8bd88a4aa04594aa02984a9321defae45ce248` — `fix(stage-ui): bind Qwen3 canary voice selection` | speech selection | 页面 voice 正确但 runtime voice 未 resolved | static catalog 与 active VoiceInfo 没有 canonical binding | `SOURCE_PROVEN` + real failure | ID persisted 不等于 object hydrated |
| 2026-09-01 | `c502218cdfd9cd1d473e3bc6affff3bdb804d630` — `test(stage-ui): cover Qwen3 provider voice reselection` | selection tests | provider/model reload race 风险 | 为 reselection/idempotence 加 regression guard | `SOURCE_PROVEN` | 测试 provider switch 与 model watcher race |
| 2026-09-01 | `38c5a7ae435a40545ded6e18cf6b22e2be6d51b5` — `feat(stage-ui): expose Qwen3 streaming latency telemetry` | PAYG telemetry | 需要证明 audio 是否早于 LLM stream end | 增加 renderer-clock input-finish 与 signed overlap | `SOURCE_PROVEN` + real overlap | overlap 必须用 signed same-clock metric |
| 2026-09-01 | `ae14679e78db436ca613bb7cdad19c43a4a57e0e` — `fix(stage-ui): bridge Qwen3 stage telemetry to main` | PAYG diagnostics | renderer console 不在 Owner inspected target | summary 通过 typed renderer→main sink | `SOURCE_PROVEN` | owner audit path 应在 main/Bash |
| 2026-09-01 | `8a855078e81f2ef418c1d1a3e0e6133e0d22f94c` — `feat(stage-ui): add Token Plan Qwen Audio TTS` | Token Plan TTS | 新 route | explicit provider/credential/native task protocol/Stage adapter | `SOURCE_PROVEN` + later real runtime | billing route 必须显式 |
| 2026-09-01 | `e1c0d34b196a998a68c4979207d7538b259668a9` — `test(stage-ui): cover Token Plan speaking state` | Token Plan tests | 验证播放期间 speaking state | shared speaking hooks regression | `SOURCE_PROVEN` | 不另建 Qwen speaking store |
| 2026-09-01 | `cf31e2a0e37de871b065c2c51dd01378362cea20` — `fix(stage-ui): instrument Token Plan TTS silent entry` | Token Plan diagnostics | provider state 看似正确但无声音/无日志 | 增加 content-free renderer/main milestones | `SOURCE_PROVEN` | silent pipeline 需要 boundary milestones |
| 2026-09-01 | `a3a9dc1dadc1f4a6360070efea2dfd99ba56bed0` — `fix(stage-ui): respect Token Plan WebSocket frame kind` | Token Plan/crossws | `task-started` 被当成 audio | Buffer shape 覆盖 explicit `isBinary=false` | `SOURCE_PROVEN` + real failure pattern | 显式 frame metadata 优先 |
| 2026-09-01 | `def22aded10d6b7f8ae1c35c5ef13c4036590e4e` — `feat(stage-ui): bridge Token Plan TTS stage telemetry` | Token Plan telemetry | 需要 real overlap audit | provider-specific stage summary main sink | `SOURCE_PROVEN` + real overlap | PAYG/Token Plan telemetry identity 分离 |
| 2026-09-01 | `dc76e677a6d7bfed3822f5b3493525e149bdf9ee` — `fix(stage-pages): load Token Plan speech model catalog` | Token Plan settings | model 当前值存在但列表显示 empty | 主 Speech page 未触发 Token Plan static catalog lifecycle | `SOURCE_PROVEN` + Owner UI | 加载 catalog，不隐藏 empty state |

## 31. Baseline Status Summary

| Baseline / capability | Status | Notes |
| --- | --- | --- |
| Qwen streaming ASR macOS | PASS | two real runs；partial/final visible |
| Qwen PAYG realtime TTS | PASS | short audible canary |
| Qwen PAYG LLM→TTS overlap | PASS | signed overlap `< 0` |
| Token Plan native WS TTS | PASS | native WS full task/audio lifecycle proven |
| Token Plan real audible runtime | PASS | Chinese clear、continuity、tail complete |
| Token Plan real LLM→TTS overlap | PASS | signed scheduled overlap `-126.70` |
| realtime-plus transcript-before-`response.create` seam | PROTOCOL SUPPORTED | push-to-talk/manual transcript-first seam；不代表 Token Plan entitlement |
| Token Plan realtime-plus AIRI custom-app runtime | NOT YET PROVEN | policy/credential/endpoint confirmation pending |
| Token Plan model catalog UI | PASS | persisted startup/provider switch repaired |
| Full ASR→LLM→TTS voice E2E | PENDING | not run as one unified accepted baseline |
| Barge-in | PENDING | not implemented/validated |
| AEC | PENDING | not implemented/validated |
| Android | NOT STARTED | outside current branch scope |

### Official references

以下是本笔记核对过的 Alibaba 中国站 primary references。文档页面会变化；引用它们时应同时记录访问日期和具体 model/region/protocol 语义。

- [Token Plan Personal overview](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)：Personal region、model catalog、工具/调用限制。
- [更多工具](https://help.aliyun.com/zh/model-studio/more-tools)：第三方工具兼容范围与 custom application 限制。
- [Token Plan Personal FAQ](https://help.aliyun.com/zh/model-studio/token-plan-personal-faq)：Key/Base URL/model entitlement 错误与使用规则。
- [Token Plan Personal quick start](https://help.aliyun.com/zh/model-studio/token-plan-personal-quick-start)：Token Plan key 与 compatible API 使用说明。
- [Realtime API overview](https://help.aliyun.com/zh/model-studio/realtime-api-overview)：realtime API capability matrix。
- [Qwen-Audio Realtime WebSocket API](https://help.aliyun.com/zh/model-studio/fun-audiochat-realtime-websocket-api)：workspace endpoint、session、VAD 与 push-to-talk 流程。
- [Qwen-Audio client events](https://help.aliyun.com/zh/model-studio/fun-audiochat-client-events)：`input_audio_buffer.commit` 与独立 `response.create`。
- [Qwen-Audio server events](https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-server-events)：transcription、conversation item 和 response events。
- [Qwen Audio realtime user guides](https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-user-guides)：`qwen-audio-3.0-realtime-plus` 的 realtime audio/VAD/session capability。
- [ASR model](https://help.aliyun.com/zh/model-studio/asr-model)：`qwen-audio-3.0-asr-flash` 与 `qwen-audio-3.0-asr-flash-streaming` 的差异。
- [TTS model](https://help.aliyun.com/zh/model-studio/tts-model)：Qwen3 realtime TTS model 与 WebSocket capability。
- [Realtime TTS user guide](https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide)：Qwen Audio TTS native WebSocket task protocol、音频格式和事件。
- [Qwen Audio TTS HTTP API](https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api)：HTTP/SSE TTS endpoint、`X-DashScope-SSE` 与 output event。
- [Qwen Audio TTS voice list](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)：server voice catalog；AIRI 当前只暴露 canary subset。
- [Qwen TTS realtime synthesis](https://help.aliyun.com/zh/model-studio/interactive-process-of-qwen-tts-realtime-synthesis)：PAYG Qwen3 realtime WebSocket route，与 Token Plan route 分开。

### Security note

本文档有意只记录环境变量名称、非秘密 model/provider/voice IDs、bounded telemetry 和 sanitized evidence。没有真实 API key、Bearer credential、workspace ID value、用户 prompt、用户语音、LLM response 或音频内容。

## 32. Full voice E2E telemetry contract

这一节定义后续完整 voice turn 的观测契约；本阶段只改变 streaming ASR → chat 的
endpoint handoff，不改变 ASR wire、`createTranscriptBuffer`、LLM、`StageTtsSession`、
TTS、PCM 播放或本地 drain 语义。当前只有 synthetic/focused tests，尚未执行一轮完整真实
`ASR → LLM → TTS` runtime，因此不能把本节测试结果写成 real runtime PASS。

### Turn identity

ASR final 发生在 chat runtime 生成其 `roundId` 之前，所以 renderer 在 ASR
final 时创建 bounded、opaque 的 `telemetryTurnId`。同时显式记录
`transcriptIngressMode`：`streaming-sentence-end` 由
`handleStreamingSentenceEnd()` 设置，`buffered-recorder` 由 recorder 的
`onTranscriptionResult()` 设置。该 mode 随语音 transcript buffer flush 或直接
chat boundary 一起传入 `ChatSendPayload`，再经过 `ChatOrchestratorSendOptions` 到
`ChatStreamEventContext`；同一 context 会被 `onBeforeMessageComposed`、
`onTokenLiteral`、`onStreamEnd` 和 Stage TTS 生命周期复用。这个 ID 只用于
correlation，不进入 prompt、消息正文或 provider request。

streaming ASR 的 final 先进入 bounded endpoint controller；一个逻辑 turn 可跨越
多个 local VAD/provider session。controller 以最新的 VAD activity end 为 grace 锚，
而不是以 provider final 到达时间重新追加固定等待。只有 endpoint decision 才记录
`transcriptFlushRequestedAt` 并向 chat 释放聚合文本；`endpointReason` 使用闭集合
`vad-grace-expired | explicit-flush`。recorder fallback 则继续使用现有
`createTranscriptBuffer({ flushDelayMs: 1200, maxBufferedTextLength: 90 })`，在
buffer flush callback 记录释放时刻。`asrFinalToTranscriptFlushMs` 的准确含义是：
当前 ingress path 的 first final 到产品 boundary release 的时间；streaming path
可能包含 VAD-anchored 500 ms grace，buffered-recorder path 可以包含 1200 ms。没有稳定的
`speechEnd` timestamp 时，
`speechEndToFirstTtsPlaybackScheduleMs` 保持 unavailable，不作估算。

### Renderer-clock milestones and metrics

每个 turn 记录 first-final、latest-final 和 first-only milestones：

```text
t_asr_final_received
t_last_asr_final_received
t_endpoint_decision
t_transcript_flush_requested
t_chat_submission
t_first_llm_text
t_first_tts_append
t_first_tts_audio_event
t_first_tts_playback_schedule
```

由同一个 renderer monotonic clock 计算：

```text
asrFinalToTranscriptFlushMs
firstAsrFinalToEndpointDecisionMs
lastAsrFinalToEndpointDecisionMs
endpointDecisionToChatSubmissionMs
endpointDecisionToFirstTtsPlaybackScheduleMs
lastSpeechActivityEndToEndpointDecisionMs
transcriptFlushToChatSubmissionMs
asrFinalToChatSubmissionMs
chatSubmissionToFirstLlmTextMs
firstLlmTextToFirstTtsAppendMs
firstLlmTextToFirstTtsAudioEventMs
firstLlmTextToFirstTtsPlaybackScheduleMs
asrFinalToFirstTtsPlaybackScheduleMs
```

各指标只在两个 finite timestamp 都存在时输出；合法的零值、亚毫秒值和
负值保留原样。Qwen Stage 的已有 renderer telemetry（包括
`firstAudioScheduledRelativeToInputFinishMs`）仍是它自己的 provider-stage
authority；本契约不把 renderer 时间戳与 Electron main transport 时间戳直接
相减。

### Success gate and main sink

只有同一 `telemetryTurnId` 到达 chat submission、first LLM text 和 first
TTS playback schedule，并且 Stage 已按既有规则完成 remote finish + local
playback drain，才构成 successful E2E summary。failure/cancel、缺少必需
milestone、过期事件和重复 report 都不会生成成功摘要。renderer 通过 typed
`realtimeVoiceE2eTurnTelemetry` invoke 把已计算的数值交给 Electron main；
main 以 bounded 64-ID remembered set 去重，输出唯一的：

```text
[Realtime Voice E2E] turn finished
```

日志还包含闭集合 `transcriptIngressMode`：`streaming-sentence-end` 或
`buffered-recorder`。这只是 renderer-clock 派生数据的 main-process sink，不是重新测量 transport
或 acoustic onset。`turnId` 截断，所有数值先做 finite filtering；sink 不接收
transcript、prompt、LLM output、PCM、Base64、credential 或 raw provider
payload。diagnostic sink 不可用时不得影响语音完成。

### Evidence status

`SOURCE_PROVEN`：turn ID 贯通 chat hooks；两个 ingress mode 在各自 source path
显式赋值；streaming endpoint controller 的跨 segment 聚合、VAD-anchored 500 ms
grace、explicit flush/cancel 与 endpoint reason 已由 focused tests 守护；1200/90 buffer 未修改；E2E state machine 的
success/failure/cancel/duplicate/finite-number 规则和 main sink
的 bounded exactly-once 行为由 focused tests 覆盖。

`OPEN / NOT_YET_PROVEN`：完整真实麦克风到扬声器的一轮仍未执行；因此目前没有
可发布的 real `asrFinalToFirstTtsPlaybackScheduleMs` 基线。下一次真实 streaming
ASR 验证应分别观察 VAD-anchored endpoint grace 与 `asrFinalToTranscriptFlushMs`，
不能预先写成 1200 ms；recorder 验证则单独保留 1200 ms buffer attribution。两者都要
与 chat 首 token、TTS 首 audio event 和首 playback schedule 分开记录，不能用 ASR
模型指标替代产品层 buffer 指标。

## 33. ASR sentence final vs user-turn endpoint authority

本节记录为什么 sentence final 不能直接等同 user-turn end，以及 V1 endpoint layer
如何修复跨 VAD segment 的 handoff 风险。它不改变 Qwen ASR wire protocol。

### 已证明的两层边界

Alibaba ASR 文档把 `result-generated` 中的 `sentence_end=true` 定义为当前识别句
已经结束的 final result，把 `sentence_end=false` 定义为 intermediate result；文档另
行定义 `task-finished` 为任务正常结束。因此 `sentence_end` 是识别稳定性/句段边界，
不是用户明确交棒的 conversational turn 信号。当前裁决为
`SENTENCE_FINAL_EQUALS_USER_TURN_END = NO_NOT_EQUIVALENT`（`OFFICIAL_DOC_SUPPORTED`）。
参见 [ASR server events](https://help.aliyun.com/zh/model-studio/fun-asr-server-events)
和 [ASR WebSocket API](https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api)。

当前 Qwen main session 以 `sentence_id` 保存和替换句段更新；多个
`sentence_end=true` 结果在同一个 provider task 内会在 `task-finished` 时聚合为一次
ordered final，再交给 renderer。因此 raw provider 的多个 sentence final 不会直接各自
触发 chat。可是 `createVadStreamingSession` 的 authority 是“一段 detected speech 一个
provider session”；在 V1 之前，当一个物理发言被当前 VAD 分成两个 session 时，每个
session 的 final 都进入 Stage 的 direct handoff。该结论由源码与 deterministic tests
(`SOURCE_PROVEN`) 支持。V1 在这两个 authority 之间加入 endpoint controller：provider
final 只作为稳定文本输入，最终 chat release 由 VAD-anchored endpoint decision 决定。

### 当前 AIRI chat 触发链

```text
Qwen result-generated(sentence_end)
  → main sentence map / ordered partial snapshots
  → task-finished 时 onFinal(aggregate)
  → renderer final snapshot / stream completion
  → StreamingTranscriptionConsumers.onSentenceEnd
  → handleStreamingSentenceEnd(finalText)
  → streamingVoiceTurnEndpoint.finalTranscript(finalText)
  → VAD activity end + 500ms grace / explicit flush
  → sendVoiceInputTextToChat(aggregatedText)
  → chatStore.send() / runtime.ingest()
```

`handleStreamingSentenceEnd()` 仍不经过 `voiceTranscriptBuffer`，但 VAD-backed path
不再直接调用 chat。一个 bounded controller 在同一个 pending logical turn 中按到达顺序
保存非空 final；新 speech 在 grace 内开始会取消旧 timer 并继续聚合。单 final 的
deterministic control 为 `CHAT_SEND_COUNT=1`；两个相邻 VAD/provider segment 的 final
现在为 `CHAT_SEND_COUNT=1`、`CHAT_TURN_COUNT=1`。真实自然停顿的产品效果仍未做
runtime validation。

重复行为也必须分层理解：Qwen main 的相同 `sentence_id` 更新会被 Map 替换，
在 renderer final callback 前只保留一次（`SOURCE_PROVEN`）；但 Stage direct callback
自身没有去重，若上游真的交付两个相同 final callback，会产生两个 chat send。不能把
上游已去重误写成 Stage 层具备通用重复保护。

### Endpointing authority matrix

| Event / signal | ASR stability authority | Acoustic-end authority | User-turn-end authority | Current chat trigger |
| --- | --- | --- | --- | --- |
| partial transcript | intermediate/stable recognition update | 无 | 无 | 不触发 |
| `result-generated`, `sentence_end=true` | 当前句段 final | 可能反映 provider segmentation/pause，但未证明是完整声学结束 | 无官方保证 | 在当前 Qwen task 中进入 endpoint aggregate |
| `task-finished` | task 内 aggregate final 可交付 | provider task lifecycle 结束 | 仍不等于用户 conversational intent | 触发 main `onFinal`，随后 renderer final stream handoff |
| VAD speech end | 当前本地 speech segment boundary | VAD silence/segment signal | 不自动等于用户交棒 | 更新 endpoint grace anchor，不直接 chat |
| recorder flush boundary | recorder result 已进入 app buffer | 无 | 无 | `voiceTranscriptBuffer` flush callback 触发 chat |

当前 recorder 路径仍是 `createTranscriptBuffer({ flushDelayMs: 1200,
maxBufferedTextLength: 90 })`；它不能被借作 streaming ASR endpointing authority，也不能把
streaming path 的 direct boundary 改写成 1200 ms。

### Endpoint controller V1

当前实现位于 `packages/stage-ui/src/libs/audio/streaming-voice-turn-endpoint.ts`，
把 sentence final 当作识别稳定性输入，而不是直接当作用户 turn end。`speechActivityStart`
和 `speechActivityEnd` 由 Hearing VAD 经 `StreamingTranscriptionConsumers` 以无文本
activity callback 传给 Stage；不注册这些 callback 的旧 consumer 不受影响。

`STREAMING_VOICE_ENDPOINT_GRACE_MS = 500` 的 deadline 锚定最新 local VAD
`speechActivityEnd`。final 在 deadline 前到达只等待剩余时间；final 晚到且没有新的
speech 时立即决定；新的 speech 会取消 timer 并保留已有 final。一个 controller 只持有
一个 bounded pending logical turn，使用稳定的 `telemetryTurnId` 跨 provider session
聚合，不按文本相等去重；中文相邻片段保持相邻，Latin 片段用确定性单空格规则连接。
旧 timer 通过 generation check 不能提交新 turn。

`explicit-flush` 用于安全 teardown 时释放已有 pending text；`cancel` 丢弃 pending
endpoint state，不产生空 chat。controller 的状态与文本只在 renderer 内用于构造
chat message，telemetry 只含 turn ID、reason 和数值。

### Future endpointing alternatives

| 方案 | 延迟 | 自然停顿容忍度 | false split / false merge | barge-in 兼容性 | Android portability |
| --- | --- | --- | --- | --- | --- |
| 1. 短的 bounded post-final aggregation window | 可控增加 | 取决于窗口 | split 降低、merge 风险上升 | 可在窗口内取消/打断 | 高 |
| 2. provider acoustic/VAD speech-end authority | 可能最低 | 依赖 provider | 依赖 provider segmentation | 可直接连接 speech-end，但仍需取消竞态 | 中/低 |
| 3. explicit user-turn/end signal | 近零额外等待 | 由用户显式控制 | split/merge 语义最清晰 | 最容易与 PTT/主动打断配合 | 高 |
| 4. hybrid sentence-final + VAD/endpoint timer | 中等、可调 | 通常最好 | 需要调参，兼顾两类错误 | 可把 VAD、cancel、barge-in 分层 | 中/高 |

当前 V1 采用 option 4 的 bounded 子集：VAD activity end + 500 ms grace，并保留
explicit flush/cancel seam。它不是 recorder 的 1200 ms；自然停顿的 false split/merge
权衡必须在后续真实 runtime 中重新测量。`endpointDecisionAt` 已作为 renderer-clock
milestone 放在 ASR final 与 chat submission 之间，并同时保留 first/last final 的
latency 口径。

sentence final 不等于 VAD speech end；VAD speech end 也不等于 AEC。VAD/endpointing
可以决定何时提交或停止一轮，barge-in 可以决定何时取消 TTS/LLM，但 AEC 仍负责回声
路径与自声抑制，三者不能互相替代。
