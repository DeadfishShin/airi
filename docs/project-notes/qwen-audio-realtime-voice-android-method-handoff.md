# AIRI macOS Realtime Voice → Android 工程方法交接

状态：`METHOD_HANDOFF_ONLY`

本文是给独立 Android 任务组的 macOS 工程经验和方法参考。它记录经过真实运行时验收的 macOS realtime voice authority、故障定位方式、修复边界和可移植语义；**不是 Android 已实现状态，不是 Android 产品设计 authority，也不是要求整条实验分支 cherry-pick 的变更清单**。Android 任务组必须以自己的当前仓库、当前 native audio contract、当前生命周期和当前 provider/credential policy 为准独立适配。

本文不修改 Android 仓库，不修改 PR #61，不把任何 macOS diagnostic harness 当作 Android production dependency。`DeadfishShin/airi` 的 validated branch 仍是只读的 macOS source authority。

## 1. 冻结的 macOS authority 与证据边界

| 项目 | authority |
| --- | --- |
| Repository | `DeadfishShin/airi` |
| Validated branch | `experiment/qwen-audio-30-realtime-asr-macos-canary` |
| Validated source HEAD | `75702ed4dcb5c89947e64ac668df24485aa2c2c6` |
| Validated source tree | `c1bc44d0d433c5c0f4dea1a044b389e33e90a22a` |
| Canonical source notes | [`qwen-audio-realtime-voice-integration.md`](./qwen-audio-realtime-voice-integration.md) |
| Evidence vocabulary | `SOURCE_PROVEN`, `OWNER_RUNTIME_EVIDENCE`, `REAL_RUNTIME_PROVEN`, `OPEN` |

这条 branch 的 integrated macOS Electron runtime 已经验证了 Qwen realtime ASR、Qwen PAYG realtime TTS、完整 ASR→LLM→TTS、production VAD、single barge-in、consecutive double barge-in、stale-output suppression 和 final quiet-tail。该事实不扩张为 Android、跨设备、Token Plan custom-app 或 broader AEC certification。

### Frozen production VAD model identity

macOS validated production VAD authority 是：

```text
MODEL_ID=onnx-community/silero-vad
REVISION=ddc9a7e80d6758f6fc795a1e8a04b798eb929d3a
FILE=onnx/model.onnx
DTYPE=fp32
SHA256=a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808
SIZE_BYTES=2243022
```

该 identity 由 model authority、local asset provenance 和 offline load proof 共同约束。可移植的是 identity、input/output contract 和 config 语义；Android 必须自行证明其 asset/package、runtime 和 ABI 适配，不能直接复制 macOS 路径。

## 2. macOS 最终状态矩阵

| 能力 / 断言 | macOS 当前状态 | 证据与边界 |
| --- | --- | --- |
| Qwen streaming ASR macOS | `PASS` | 真实 realtime partial/final ingress；model 为 `qwen-audio-3.0-asr-flash-streaming` |
| Qwen PAYG realtime TTS | `PASS` | 有界 PAYG runtime；native realtime playback path |
| Full ASR→LLM→TTS | `PASS` | bounded integrated macOS Electron runtime |
| Production VAD | `PASS` | AIRI `createVAD` / `createVADStates` / AudioWorklet authority |
| Single automatic barge-in | `PASS` | 旧 TTS 取消，新 user turn 获得 authority |
| Consecutive double barge-in | `PASS` | 两个旧 assistant response 均不恢复，最新 turn 保持 authority |
| Stale-output suppression | `PASS` | generation epoch / turn identity 阻断旧 text、tool、completion、TTS side effects |
| Final quiet-tail | `PASS` | 最终回复后 mic 保持 enabled，约 20 秒静默无幽灵 turn/generation/TTS resume |
| Token Plan custom-app calls | `HOLD` | 不因 macOS PAYG 测试而解除；无 silent fallback |
| AEC / self-voice broader certification | `OPEN` | 已有 runtime 的有效 AEC setting evidence 不等于跨设备或所有输出路由认证 |
| Broader cross-device / Android | `NOT STARTED` | 本文只提供方法交接，不代表 Android 完成 |

## 3. macOS 实际数据流与生命周期

正常输入/输出主链：

```text
microphone
  → AIRI production local VAD / AudioWorklet
  → credible speech gate
  → streaming ASR
  → AIRI canonical chat/orchestrator
  → one StageTtsSession / one TTS queue
  → PCM playback
```

播放期间的 Option-B interruption 语义：

```text
credible production-VAD speech-start
  → barge-in epoch
  → old generation abort/invalidate
  → old TTS cancel
  → stale callback / stale output suppression
  → new user turn
```

需要保留两个不同 lifetime：

- local listening lane：microphone、production VAD、AudioWorklet 和 local speech activity；assistant `nowSpeaking=true` 不能停止这一 lane。
- remote transcription lane：realtime ASR session 与 audio upstream authorization；assistant playback 本身不能开启它，只有 credible production-VAD speech-start 才能授权。

在 streaming ASR path 中，user-turn endpoint authority 仍是最新 local VAD `speechActivityEnd` 加 `500ms` grace；sentence final 不是 user-turn-final。VAD 的 production `speechPadMs=360` 已在内存态 segment 中提供 bounded leading audio，不需要另建数秒级 microphone cache，也不得把音频写盘。

## 4. Production authority 与 diagnostic authority

### 4.1 实际 AIRI production runtime

下列代码是 macOS validated branch 中应优先理解的 production seams：

- [`packages/stage-ui/src/workers/vad/model-authority.ts`](../../packages/stage-ui/src/workers/vad/model-authority.ts)：production VAD model ID、immutable revision、`onnx/model.onnx`、`fp32` 与 custom config。
- [`packages/stage-ui/src/workers/vad/config.ts`](../../packages/stage-ui/src/workers/vad/config.ts)：唯一 production VAD config resolver；threshold `0.52`、exit `0.156`、silence `1200ms`、pad `360ms`、minimum speech `300ms`、sample rate `16000`。
- [`packages/stage-ui/src/workers/vad/vad.ts`](../../packages/stage-ui/src/workers/vad/vad.ts)、[`index.ts`](../../packages/stage-ui/src/workers/vad/index.ts) 与 [`process.worklet.ts`](../../packages/stage-ui/src/workers/vad/process.worklet.ts)：VAD state machine、production worker/AudioWorklet path 和 speech event authority。
- [`packages/stage-ui/src/stores/ai/models/vad.ts`](../../packages/stage-ui/src/stores/ai/models/vad.ts)：normal hearing store 对 `createVAD`、`createVADStates` 和 production config 的组合。
- [`packages/stage-ui/src/libs/audio/vad-streaming-session.ts`](../../packages/stage-ui/src/libs/audio/vad-streaming-session.ts)：由 local VAD speech boundary 管理 remote ASR session 的 gate。
- [`packages/stage-ui/src/libs/audio/streaming-voice-turn-endpoint.ts`](../../packages/stage-ui/src/libs/audio/streaming-voice-turn-endpoint.ts)：以 local VAD activity end 为锚的 `500ms` user-turn endpoint。
- [`packages/stage-ui/src/libs/speech/tts-session.ts`](../../packages/stage-ui/src/libs/speech/tts-session.ts)、[`qwen-tts-stage-session.ts`](../../packages/stage-ui/src/libs/speech/qwen-tts-stage-session.ts)、[`qwen-tts-pcm-playback.ts`](../../packages/stage-ui/src/libs/speech/qwen-tts-pcm-playback.ts)：一条 TTS session、PCM queue、真实 cancel 和本地尾音 drain。
- [`packages/stage-ui/src/libs/speech/barge-in.ts`](../../packages/stage-ui/src/libs/speech/barge-in.ts)、[`packages/stage-ui/src/stores/speech-output-control.ts`](../../packages/stage-ui/src/stores/speech-output-control.ts) 与 [`packages/stage-ui/src/stores/chat.ts`](../../packages/stage-ui/src/stores/chat.ts)：bounded barge-in counter/epoch、TTS stop request 和 generation cancel/invalidation seam。
- [`packages/stage-ui/src/components/scenes/Stage.vue`](../../packages/stage-ui/src/components/scenes/Stage.vue)：当前 Stage 的唯一 TTS host、playback cancel、stale callback protection 与 chat hook binding。
- [`apps/stage-tamagotchi/src/renderer/pages/index.vue`](../../apps/stage-tamagotchi/src/renderer/pages/index.vue)：voice input lifecycle、local VAD/remote ASR gate、streaming transcript ingress、500ms endpoint 和 barge-in 调用方。
- [`apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime/`](../../apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime/)：Qwen realtime ASR 的 main-side transport、credential boundary、task protocol 与 renderer-targeted events。

### 4.2 仅用于诊断的代码

下列内容用来建立证据，不是 production API，也不应成为 Android 产品依赖：

- [`apps/stage-tamagotchi/scripts/local-duplex-aec-vad-smoke.mjs`](../../apps/stage-tamagotchi/scripts/local-duplex-aec-vad-smoke.mjs)、`local-duplex-aec-vad-smoke-renderer.ts` 和对应 logic/test：local-only smoke harness。
- `local-duplex-chromium-harness.mjs`、`local-duplex-chromium-harness-logic.mjs` 与 `local-duplex-production-host-boot-probe.mjs`：system Chromium 或 production Electron 的 boot/measurement probes。
- `apps/stage-tamagotchi/scripts/assets/production-vad/`：diagnostic harness 使用的本地 model asset 镜像；Android 应使用自己受控的 production-appropriate packaging seam。
- `macos-local-speech`、`/usr/bin/say + /usr/bin/afconvert`：macOS 本地 speech stimulus；不是 production TTS provider，也不是 Android audio source。
- synthetic numeric fixtures、no-media preflight、CSP/local-server、phase reports：只用于证明 wiring、状态机和安全边界。

诊断结果可以证明 production seam 的使用和测量条件，但不能把 diagnostic renderer、localhost server、browser boot probe 或测试音频误报为 production feature。

### 4.3 Portability classification

| 分类 | macOS validated branch 中的精确文件 / surface | 交接结论 |
| --- | --- | --- |
| `SHARED_PRODUCTION_REUSABLE` | `packages/stage-ui/src/workers/vad/{config.ts,model-authority.ts,vad.ts,index.ts,process.worklet.ts}`；`packages/stage-ui/src/libs/audio/{vad-streaming-session.ts,streaming-voice-turn-endpoint.ts}`；`packages/stage-ui/src/libs/speech/{barge-in.ts,tts-session.ts,qwen-tts-stage-session.ts,qwen-tts-pcm-playback.ts}`；`packages/stage-ui/src/stores/chat.ts`、`speech-output-control.ts`、`apps/stage-tamagotchi/src/renderer/pages/index.vue` 中对应 shared semantics | 可复用的是 production contract、VAD/endpoint/barge-in/generation/TTS/stale-output 语义；先按 Android 当前 source 独立重建 adapter，不搬桌面生命周期。 |
| `DESKTOP_ELECTRON_ONLY` | `apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime/`；`apps/stage-tamagotchi/src/main/services/airi/qwen-tts-realtime/`；`apps/stage-tamagotchi/src/main/services/airi/qwen-audio-tts-token-plan/`；Electron main/preload/IPC、Window/permission 与 runtime-env seams | 仅属于 macOS Electron host；Android 不应复制 main/preload/IPC 或 `process.env` credential transport。 |
| `DIAGNOSTIC_ONLY_DO_NOT_PORT` | `apps/stage-tamagotchi/scripts/local-duplex-aec-vad-smoke.mjs`、`local-duplex-aec-vad-smoke-renderer.ts`、`local-duplex-chromium-harness*.mjs`、`local-duplex-production-host-boot-probe.mjs`、`scripts/assets/production-vad/`、`macos-local-speech`、synthetic fixtures | 只用于 bounded evidence、offline preflight、CSP/local server、phase measurement；不构成 Android production dependency。 |
| `PROVIDER_OR_CREDENTIAL_ROUTE_SPECIFIC` | `apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime/`、`qwen-tts-realtime/` 与 `packages/stage-ui/src/libs/providers/providers/qwen-audio-realtime/`、`qwen3-tts-realtime/`；`packages/stage-ui/src/libs/providers/qwen-audio-realtime-ipc.ts` 等 typed bridge | provider contract 可以作为参考，但 Qwen/PAYG transport、model/voice catalog、credential injection 和 Token Plan policy 必须按目标平台/授权重新核验；macOS bounded PAYG 不是 Android 默认授权。 |

这一分类避免两种误读：shared semantics 不等于 shared file，diagnostic evidence 也不等于 production implementation。Android 任务组应只抽取已证明的语义，并在当前 Product main 上重做 source-level ownership 与安全边界证明。

## 5. Android 可以复用的语义

这些是应保持不变的运行时不变量，而不是让 Android 直接复制桌面文件：

1. `ONE_CONVERSATION_AUTHORITY`：用户 turn 进入唯一 AIRI canonical chat/orchestrator。
2. `ONE_CHARACTER_RUNTIME`：persona、memory、tools、LLM 仍由同一个 AIRI character runtime 管理。
3. `ONE_TTS_QUEUE`：所有 assistant speech 进入一个 TTS authority/queue；不创建 Android-only speech queue。
4. local VAD owns credible-speech decision；amplitude heuristic 不能取代 production VAD。
5. remote ASR 不得永久常开；assistant playback 不能单独授权 remote ASR 或上传 microphone。
6. native layer 只提供 OS/device primitives：capture、AEC/NS/AGC、bounded PCM transport 和 lifecycle；共享 AIRI runtime 拥有 VAD、endpoint、provider gate、chat 和 barge-in semantics。
7. barge-in 必须同时取消当前 TTS 并使旧 generation 失效；只静音或隐藏 UI 不算 cancel。
8. stale text、audio、tool、completion callback 都必须受 generation/turn epoch 保护。
9. `speechActivityEnd → 500ms grace → user-turn commit` 的 endpoint authority 不能被 sentence-final 或 provider timing 偷换。
10. raw PCM 不持久化、不打印、不上传到 telemetry；pre-roll（若架构需要）只能 bounded、内存态、一次性消费。
11. provider 与计费 route 必须显式隔离；不得 silent Token Plan ↔ PAYG fallback，也不得把一次 macOS bounded PAYG 授权推广为 Android 默认授权。

## 6. 不得直接移植

以下内容明确排除在 Android product port 之外：

- Electron main、preload、IPC、BrowserWindow 生命周期和 Electron-specific renderer targeting。
- 用 `process.env` 读取或传递 credential 的桌面实现；Android 必须沿用自己的 secure credential authority。
- macOS `/usr/bin/say` fixture、`afconvert` 以及 `macos-local-speech` profile。
- Chromium localhost harness、Electron diagnostic window、standalone boot probe 和 no-media browser fixture。
- macOS-specific model/wasm/asset path；只能复用已核验的 model identity/semantic contract，不能复用路径假设。
- 整条 `experiment/qwen-audio-30-realtime-asr-macos-canary` branch；严禁 blind whole-branch cherry-pick、merge 或复制 diagnostic harness。
- Token Plan custom-app route；当前仍为 `TOKEN_PLAN_CUSTOM_APP=HOLD`，不能因 macOS 实测成功而恢复。

## 7. Android 任务组的 ownership 边界

建议将职责按能力而不是按平台复制：

| 层 | 只负责的内容 | 不应拥有的内容 |
| --- | --- | --- |
| Android native | microphone capture、Android AEC/NS/AGC、bounded PCM transport、foreground/lifecycle primitive | chat store、persona/memory、LLM、第二套 VAD、TTS queue、billing fallback |
| Shared AIRI runtime | local VAD、credible-speech gate、user-turn endpoint、ASR provider authority、canonical chat、barge-in epoch、generation invalidation、TTS authority、stale-output suppression | Android-only conversation or character runtime |
| Secure credential layer | 明确的 Android secure storage / injection seam | Electron `process.env` 假设、日志回显、隐式 PAYG fallback |

Android 目标语义与 macOS 一致：assistant 播放期间 capture/local VAD 继续工作；playback-only 不产生 user turn；credible VAD speech-start 才授权 remote ASR；barge-in 取消旧 TTS 并失效旧 generation；新 user turn 回到同一个 AIRI chat authority。

## 8. 事故与修复方法

每个事故使用同一结构：Symptom、Incorrect assumption、Root cause、Minimal repair、Verification、Reusable lesson、Android relevance。

### 8.1 Provider detail route 缺失导致 settings 页面异常

- **Symptom**：进入 Qwen provider detail 后出现黑屏或 404。
- **Incorrect assumption**：provider registry 存在就会自动提供 file-based settings page。
- **Root cause**：file-based route 需要对应 Vue component；缺失的 `packages/stage-pages/src/pages/settings/providers/transcription/qwen-audio-realtime-transcription.vue` 使 route 无法解析。
- **Minimal repair**：补齐最小 provider detail page，遵循现有 settings component 约定，不重做 provider registry。
- **Verification**：settings/browser regression 与 route resolution 检查通过；对应修复记录在 canonical notes 的 ASR debugging lessons。
- **Reusable lesson**：UI route existence、provider metadata 和 runtime provider selection 是三件事，必须分别验证。
- **Android relevance**：Android 不能假定桌面 file-based route 适用；应独立验证自己的 settings/navigation seam。

### 8.2 Electron main 与 renderer credential boundary

- **Symptom**：renderer 侧无法安全建立 Qwen session，或调试时容易把 key/workspace 带入 UI。
- **Incorrect assumption**：把 provider credential 注入 renderer 最快，也等价于 provider configuration。
- **Root cause**：authenticated WebSocket 与 secret credential 属于 Electron main authority；renderer 只应拥有非秘密 provider/model/voice choice 与受控 session identity。
- **Minimal repair**：main-only credential resolution 与 WebSocket/task protocol；renderer 通过 typed IPC 请求能力。
- **Verification**：provider/service/fake tests、secret scans、payload 结构检查；日志无 Authorization、cookie 或 raw environment。
- **Reusable lesson**：credential boundary 是架构边界，不是临时环境变量技巧。
- **Android relevance**：Android 必须绑定现有 secure credential storage/keystore seam，不得移植 `process.env` 或把 key 放入 shared UI state。

### 8.3 Originating renderer/window event targeting

- **Symptom**：main telemetry 显示 partial/final 存在，但 Settings/Hearing renderer 看不到，或事件到了错误窗口。
- **Incorrect assumption**：异步 main emit 可以安全 broadcast，所有窗口都能消费同一 session event。
- **Root cause**：session 建立后的 originating `ipcMainEvent.sender` 没有可靠保留；多窗口时 broadcast 会丢失 target 语义。
- **Minimal repair**：session 建立时捕获 originating renderer target，partial/final/finished/error 只发回该 target。
- **Verification**：renderer/main routing、fullStream、Playground delivery tests。
- **Reusable lesson**：异步事件必须携带明确 owner；不要用全局 broadcast 隐含 ownership。
- **Android relevance**：native callback、foreground service、Activity/PiP 和 shared runtime 之间同样需要 session/owner identity，但不能复制 Electron IPC。

### 8.4 Partial/final transcript delivery

- **Symptom**：partial 不可见，或 `你好` → `你好世界` 被错误显示成重复文本；final 又重复提交。
- **Incorrect assumption**：每次 provider message 都是 delta，sentence final 就等于 user-turn final。
- **Root cause**：Qwen snapshot、AIRI transcript consumer、sentence lifecycle 与 chat-turn lifecycle 的语义被混在一起。
- **Minimal repair**：partial snapshot 用 replacement semantics；final 只在对应 lifecycle 处提交一次；streaming path 进入 VAD-anchored endpoint controller。
- **Verification**：`StreamingTranscriptionConsumers`、Hearing Playground、streaming endpoint tests；不同 ingress mode 分开记录。
- **Reusable lesson**：snapshot/delta、sentence-final/user-turn-final、provider session/chat turn 必须分别建模。
- **Android relevance**：PCM/native callback 变化不应改变 transcript ingress semantics；shared runtime 应继续拥有唯一 turn commit authority。

### 8.5 First terminal error authority

- **Symptom**：真实错误最后只显示泛化的 `session is not active`，原始 handshake/session failure 消失。
- **Incorrect assumption**：早期删除 session 并让后续 append/finish 抛一个通用错误足够。
- **Root cause**：并发 append 看到 session 已删除，覆盖了更早的 socket/task terminal failure。
- **Minimal repair**：bounded terminal-error retention/tombstone；第一 terminal failure 保持 authoritative，后续 append/finish/cancel/close 不覆盖它。
- **Verification**：race tests 检查 first-error retention、sanitized close/error details、credential/audio/transcript 不进入报告。
- **Reusable lesson**：错误也有 lifecycle ownership；先发生的 causal failure 不应被后续清理噪声覆盖。
- **Android relevance**：native capture、service stop、provider failure 必须保留首个 bounded cause，同时仍 cleanup。

### 8.6 Vite unrelated workspace scan

- **Symptom**：standalone smoke 启动时 dependency scan 触及 Web Extension popup，并因 `uno.css` 无法解析而失败或报警。
- **Incorrect assumption**：任何以 monorepo root 为 `root` 的 Vite instance 都天然只会处理 smoke renderer。
- **Root cause**：programmatic Vite 未隔离 config discovery/dependency optimizer，仓库级入口被纳入扫描。
- **Minimal repair**：让 diagnostic Vite server 关闭无关 config/plugin discovery，并只建立 bounded smoke graph；没有给 Web Extension 补装 `uno.css`。
- **Verification**：listen/startup preflight、root HTML、renderer transform、dependency graph regression；Web Extension entrypoint 不在 smoke graph。
- **Reusable lesson**：standalone diagnostics 必须隔离工作区扫描；修 unrelated package 是错误方向。
- **Android relevance**：Android build/asset graph 也应以最小 production module 为边界，不把桌面 monorepo 依赖假设带入产品。

### 8.7 Transformers / ONNX WASM external CDN dependency

- **Symptom**：production-aligned VAD 在 Electron diagnostic path 初始化时被 local-only guard 阻止，来源是 `cdn.jsdelivr.net` 的 ONNX WASM 请求。
- **Incorrect assumption**：`allowRemoteModels=false` 会自动让所有 Transformers/ONNX runtime artifacts 都走本地。
- **Root cause**：model authority 已本地化，但 browser runtime 的 ONNX WASM resolution 仍由 bundler/default loader 指向外部 CDN。
- **Minimal repair**：把 ONNX WASM resolution 显式绑定到 bundled/local asset；保留 external request fail-closed，不 whitelist CDN。
- **Verification**：no-media production-host VAD probe 完成 init + synthetic inference，external request count 为 0。
- **Reusable lesson**：model、runtime wasm、worker 和 data asset 是四个独立的 offline dependencies。
- **Android relevance**：Android 需要独立确认 native/runtime artifact 的 offline packaging，不得把“模型在本地”当作整个推理链离线的证明。

### 8.8 Model immutable revision 与 local asset

- **Symptom**：floating model ID 无法证明未来仍选择同一个 ONNX artifact。
- **Incorrect assumption**：同名 Silero model 或默认 `main` 足以作为 production identity。
- **Root cause**：model revision、exact file、dtype 和 artifact hash 没有绑定成 authority。
- **Minimal repair**：固定 `onnx-community/silero-vad`、revision `ddc9a7e80d6758f6fc795a1e8a04b798eb929d3a`、`onnx/model.onnx`、`fp32`，并使用已核验的 local asset/provenance。
- **Verification**：revision/model identity tests、hash/size/provenance checks、offline class-load/synthetic inference。
- **Reusable lesson**：模型 identity 不等于模型名称；revision、file、runtime contract 必须一起冻结。
- **Android relevance**：可复用 identity 与 hash authority，但必须由 Android 当前 packaging/ABI/lifecycle 独立证明 local load 和 fail-closed 缺失行为。

### 8.9 Chromium user activation

- **Symptom**：Chrome 已允许麦克风权限，页面仍停在 `requesting microphone`，无法进入 PHASE_1。
- **Incorrect assumption**：permission-dialog click 会被浏览器当作页面 `AudioContext` user gesture。
- **Root cause**：页面加载后自动创建/resume `AudioContext`，违反 Chromium autoplay/user-activation 时序；UI 又没有分阶段显示。
- **Minimal repair**：显式 `Start diagnostic` one-shot button；同一 gesture path 尽早创建并 resume AudioContext，再进入 getUserMedia/VAD init；每步 bounded timeout。
- **Verification**：按钮/one-shot、stage serialization、resume/mic/VAD timeout tests；Owner 可看见具体初始化阶段。
- **Reusable lesson**：权限授权与用户激活不是同一个信号，媒体初始化必须可观察且有界。
- **Android relevance**：Android permission callback、foreground service 和 audio focus 也不能被混作同一 lifecycle event；平台适配必须独立建模。

### 8.10 Phase transition silent exit

- **Symptom**：P3 后页面停住，终端没有最终 report，也没有 cleanup。
- **Incorrect assumption**：`runPhase() -> false` 后从外层 `initialize()` 直接 return 是足够的失败路径。
- **Root cause**：settle 时 `activeSpeech=true`，`settlePhase()` 返回 false，外层没有 terminal `finish()`。
- **Minimal repair**：进入 `WAITING_FOR_VAD_QUIESCENCE`，等待真实 late speech-end；`PHASE_SETTLE_TIMEOUT_MS=3200` 有界超时；timeout 必须走 finish/report/cleanup，Cancel 仍为 `CANCELLED`。
- **Verification**：idle、late end、timeout、cancel、P3→P4、P4 completion、cleanup/report guarantee regressions。
- **Reusable lesson**：每个 phase transition exit path 都必须有 terminal status、failure code 和 cleanup。
- **Android relevance**：native lifecycle stop、PiP、foreground/background 变化不能产生 silent return；共享状态机需要同样的 terminal guarantee。

### 8.11 Host / renderer verdict authority

- **Symptom**：所有 runtime evidence 都通过，但 `MACOS_CHROMIUM_LEVEL3_LOCAL_DEVICE_CANDIDATE` 仍为 `INCONCLUSIVE`。
- **Incorrect assumption**：renderer 可以计算它无法拥有的 host network counter，并把 renderer verdict 当最终 verdict。
- **Root cause**：renderer classifier 得到 `undefined` external-network count；Node host 又直接复制 legacy renderer field。
- **Minimal repair**：renderer 只提供 renderer-local evidence；host 在拥有 network counter 后用 shared pure classifier 计算最终 authority。
- **Verification**：retained scalar fixture、unknown evidence 与 network>0 negative cases；最终 host field 与 evidence 一致。
- **Reusable lesson**：最终 verdict 必须由拥有全部必要证据的一层计算，不能复制下游不完整结果。
- **Android relevance**：native telemetry、shared runtime 和 controller report 也要区分 evidence owner；不要把 UI 状态当 platform acceptance authority。

### 8.12 Local VAD credible-speech gate

- **Symptom**：assistant playback 期间若关闭整条 mic/VAD lane，就无法及时检测用户插话；若常开 remote ASR，又会上传 playback/环境音。
- **Incorrect assumption**：`nowSpeaking=true` 必须等价于 `STOP_MICROPHONE_AND_VAD`，或 microphone 存在就可以提前打开 ASR。
- **Root cause**：local listening 与 remote transcription 两种 lifetime 被合并；assistant playback/self-voice protection 被实现成粗粒度停机。
- **Minimal repair**：mic + production VAD 保持活跃；remote ASR 仅在 production-VAD `speech-start` 后授权；保留 bounded endpoint 和 phase isolation。
- **Verification**：playback-only no false trigger、user-only detection、user-during-playback detection、ASR gate counter tests。
- **Reusable lesson**：本地可信检测和远端计费 transcription 必须是两条 lane；Level-3 PASS 不能删除 speech gate。
- **Android relevance**：这是最重要的可移植语义；native capture 常驻不等于 remote ASR 常驻。

### 8.13 TTS cancellation

- **Symptom**：barge-in 后只把音量设为 0 或隐藏 UI，旧 PCM 仍可能继续排队、播放或恢复。
- **Incorrect assumption**：静音/视觉隐藏等价于停止 TTS。
- **Root cause**：TTS session、PCM playback manager、AudioBufferSourceNode 和 speaking callbacks 没有使用同一 cancel authority。
- **Minimal repair**：调用现有 `StageTtsSession.cancel()`、停止 playback manager、清理 queue，并由 Stage host 统一处理 barge-in stop。
- **Verification**：cancel count=1、queued PCM 不重播、delayed completion 不恢复 speaking state、normal tail drain 回归。
- **Reusable lesson**：取消必须是 transport + queue + playback + callback 的完整事务。
- **Android relevance**：AudioTrack/ExoPlayer/平台 TTS 的 stop、flush、callback ownership 需要映射到同一 shared TTS authority。

### 8.14 Generation abort 与 epoch invalidation

- **Symptom**：旧 assistant generation 在 barge-in 后仍能产生新 token、tool follow-up 或完成回调。
- **Incorrect assumption**：只停止当前 TTS 就足以阻断旧回答。
- **Root cause**：底层 transport 的 physical abort 与 UI/TTS side-effect authority 没有绑定。
- **Minimal repair**：优先使用现有 generation abort；即使 provider 不能可靠 abort，也推进 monotonic generation/turn epoch，让旧 generation 失去所有 side-effect authority。
- **Verification**：stale chunk、tool、completion、new-turn race tests；如物理 abort 不可靠，报告 `abort unavailable` 而不伪称已 abort。
- **Reusable lesson**：physical transport abort 和 logical output invalidation 是两个层级，必须分别诚实记录。
- **Android relevance**：shared runtime 应继续拥有 generation epoch；native layer 不得创建第二个 assistant response authority。

### 8.15 Stale output suppression

- **Symptom**：被打断的旧 text/audio/tool callback 在新 turn 后恢复 UI 或重新驱动 TTS。
- **Incorrect assumption**：取消请求发出后所有异步 callback 都会自动消失。
- **Root cause**：异步 callback 晚到是正常现象；没有按 session/turn/epoch 在 side-effect 边界再次检查 authority。
- **Minimal repair**：每个 text、tool、completion、TTS callback 在更新 UI/queue 前检查当前 turn identity/epoch；不匹配则 bounded drop 并计数。
- **Verification**：stale TTS completion、stale generation chunk、consecutive double barge-in、quiet-tail regressions。
- **Reusable lesson**：取消是未来回调的权限撤销，不是过去 promise 的魔法删除。
- **Android relevance**：service restart、Activity recreation、PiP 和 Bluetooth route change 都会制造 stale callbacks，必须沿同一原则处理。

### 8.16 Final quiet-tail

- **Symptom**：一轮回复结束后，静默期间出现 spontaneous transcription、assistant generation 或旧 TTS resume。
- **Incorrect assumption**：最后一个播放 buffer ended 就意味着所有 input/output state 都已干净。
- **Root cause**：mic/VAD、endpoint timer、provider callback、TTS tail 和 interrupted generation 的生命周期不一致。
- **Minimal repair**：保留 mic/VAD 的设计语义，同时确保旧 epoch 无效、pending endpoint/timer 清理、TTS queue drain/cancel 正确，quiet-tail 作为独立 acceptance control。
- **Verification**：Owner final quiet-tail 约 20 秒静默无幽灵事件；cleanup 与 stale-output regressions。
- **Reusable lesson**：稳定性不能只看一次 barge-in；终态后的静默窗口同样是 authority evidence。
- **Android relevance**：必须把 foreground/background、route change 和最终 quiet-tail 纳入未来设备矩阵。

## 9. 当前配置产品化状态矩阵

下表是 validated macOS canary 的当前配置边界，不是 Android 默认配置授权：

| 配置项 | 当前状态 | 边界 |
| --- | --- | --- |
| ASR provider | 可选择 | capability route 选择，不等于任意 provider 都有 realtime contract |
| ASR language | 可选择 | 必须按 provider/model contract 验证 |
| ASR model | 当前验证 model 固定 | `qwen-audio-3.0-asr-flash-streaming`；不可仅凭名称切换到另一个 model |
| PAYG API key / Workspace ID / Region | 当前通过环境变量提供 | names 可记录，values 不得进入文档、UI、日志或 commit |
| Settings UI credential persistence | 尚不能安全持久化 | UI 不能作为 secret store；main/secure authority 才能使用 credential |
| Endpoint | 不可自由编辑 | streaming path 使用 VAD-anchored `500ms` grace；不得把 `1200ms` recorder buffer 泛化到 streaming path |
| Qwen3 realtime TTS model/voice | 静态 catalog | 当前 validated route 的 model/voice 是窄白名单，不代表 full provider discovery |
| Token Plan model/voice | 静态 catalog | custom-app route 仍 `HOLD`，不形成默认授权 |
| macOS bounded PAYG authorization | 仅本次 integrated test | 不应迁移成 Android 默认 PAYG authorization 或 silent fallback |

## 10. Voice / model UX 状态

### 已完成

- generic model search framework；
- generic voice search framework；
- model/voice selection state；
- Qwen static catalog hydration；
- 当前验证 model/voice 的窄白名单与 runtime snapshot。

### 未完成

- full Qwen model discovery；
- ranking/recommendation engine；
- full voice pack catalog；
- arbitrary Qwen voice search/validation；
- Token Plan full voice selection UX；
- 将一次 macOS PAYG credential 测试变成 Android 或全局默认 provider policy。

“有 generic search UI”不等于“已经具备 provider-specific full catalog”；“能选择一个 model/voice”也不等于所有 model/voice 都经过 transport、entitlement、地区和计费验证。

## 11. 建议 Android 任务组采用的验证层级

这是验证层级建议，不是本任务对 Android 的实现指令；每一步都应在 Android 任务组确认自己的 source reality 后决定：

1. source contract：确认 native capture、shared VAD、chat、TTS、credential 和 lifecycle ownership。
2. deterministic tests：确认 PCM framing、generation/epoch、event ordering、cleanup 和 privacy。
3. no-network model/load check：确认 local model/runtime assets 缺失时 fail closed。
4. native audio Level-2：确认真实 Android capture 的 AEC/NS/AGC facts；不得从 macOS 或模拟输入推导。
5. playback-only control：assistant playback 不产生 user turn/remote ASR。
6. user-only detection：local VAD 能检测 user speech。
7. user-during-playback：播放期间 user speech 能被检测并获得 remote ASR authority。
8. consecutive interruption：连续打断时旧 TTS/generation/output 不恢复。
9. quiet-tail：最终回复后静默没有幽灵 turn、generation 或 TTS。
10. output-route matrix：内置扬声器、耳机、Bluetooth、route switch、foreground/background/PiP 等场景分别记录，不把一台设备的结果扩张成 Android certification。

## 12. PR #61 状态

| 项目 | 记录 |
| --- | --- |
| Repository | `DeadfishShin/AI-Companion-AIRI` |
| PR | `#61` |
| Classification | `OUT_OF_SCOPE_DRAFT_NOT_CONTROLLER_ACCEPTED` |
| Policy | 不得当作本交接文档已批准的 Android 实现 |
| 本任务动作 | 不修改、不合并、不关闭、不重新发布 |
| 后续处置 | 由 Android 任务组基于 Product 当前 source reality 独立决定 |

PR #61 与本方法交接不是同一 authority。本文也不要求 replay、rebase 或 cherry-pick 该 PR。

## 13. 安全与边界清单

- 本文不包含 API key、Workspace ID 实值、credential value、raw PCM、audio、base64 audio、transcript 原文、confidential prompt 或 LLM output。
- 本次文档任务不执行 macOS runtime rerun、microphone/speaker test、provider/API call、paid inference、Android source mutation、Android build/APK/ADB/device action 或 PR #61 mutation。
- `TOKEN_PLAN_CUSTOM_APP=HOLD`；无 silent billing/provider fallback。
- macOS 的 real-runtime PASS 只释放方法交接和后续独立 Android port gate，不自动授予 Android Level-2/Level-3 或产品化授权。
- 如需移植，先复用语义和 contract，再对 Android 当前仓库的 native capability、secure credential、lifecycle 和 output route 做 source-level 证明。

## 14. 结论

macOS 的核心可移植成果不是 Electron、Chromium、`say` 或某一条路径，而是清晰的 authority 分层：local VAD 决定可信用户语音，remote ASR 只在 gate 后授权，AIRI 保持唯一 conversation/character/TTS authority，barge-in 同时取消 TTS 与失效旧 generation，并以 epoch 保护所有迟到输出。

Android 任务组应把这些作为可验证的 shared semantics；不得把 diagnostics 当 production dependency，不得整条 branch 搬运，不得把 macOS PAYG 或 Token Plan 实验边界误读为 Android policy。下一步应由独立 Android 任务组在 Product 当前 main 上选择自己的最小 source contract slice，并另行建立 device/runtime acceptance。
