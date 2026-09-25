# Qwen Token Plan：macOS 已验收实现与 Android 移植参考

**版本：1.0 · 整理日期：2026-09-25**  
**用途：交给另一个 Android App 开发 agent 的工程交接资料。**  
**不是 Android 仓库状态快照，不是要求照搬 Electron 工程，也不是新一轮能力探索任务。**

## 0. 先读结论与适用边界

本次 macOS 开发已经完成 Token Plan 入口、共享安全凭据、TTS、账号模型查询、音色选择、realtime-plus 仅输入转写、转写进入 AIRI 原聊天链、真实麦克风端到端验收及日常部署。

最终主链是：

```text
真实麦克风
  → AIRI 自有 VAD / 语句边界
  → PCM16 little-endian / 单声道 / 16 kHz
  → Token Plan qwen-audio-3.0-realtime-plus WebSocket
  → 仅接收用户输入转写，不发送 response.create
  → completed transcript
  → AIRI 自己的语音输入 / Chat / 角色 / 历史 / 记忆 / 工具 / LLM
  → AIRI 生成的回复文本
  → Token Plan qwen-audio-3.0-tts-plus 原生 WebSocket TTS
  → PCM16 little-endian / 单声道 / 24 kHz
  → 本地播放、口型和说话状态
```

用户已经选择 **路线 B：继续基于 Token Plan**，不是自动退回标准 Model Studio / Workspace 按量 ASR；也不是让 realtime-plus 接管整条对话。Android agent 应移植这条已经证明可用的协议与职责分离，而不是从失败的 Flash HTTP 猜测路线重新开始。[E01][E02][E03][S02][S08][S09][S10]

**六个不可混淆的事实：**

1. TTS 使用 `/api-ws/v1/inference` 的 task 协议；ASR 使用 `/api-ws/v1/realtime` 的 realtime event 协议。两者不是同一个 socket contract。
2. ASR 复用 realtime-plus 的输入转写能力，但 **不调用 `response.create`**，也不接受供应商的回答、音频或工具调用作为 AIRI 回复。
3. TTS 可展示模型 = **账号 `/models` 返回结果与本地已支持 TTS 型号的交集**。当前实现兼容表只有 `qwen-audio-3.0-tts-plus`，不能把“只显示一个”解释成“账号永远只授权一个”。
4. 音色仍为 **2 个系统目录项 + 597 个基础音色 = 599 个随包官方快照条目**。不是实时账号音色 API，不是 599 个都已逐一调用成功。
5. macOS 完成验收不等于 Android 完成验收。协议不必重新猜，Android 的采集、凭据、生命周期、播放、真实设备 E2E 仍须验证。
6. 以下所有 PASS 都有范围：一次已验收的语音链不等于无限多轮稳定性、完整 AEC、所有设备/声线、后台监听或商业使用条款已验证。[S02][S05][S06][S08][S09][E01][E02]

---

## 1. 冻结基准与证据层级

### 1.1 已验收 macOS authority

```text
SOURCE_REPOSITORY=DeadfishShin/airi
SOURCE_BRANCH=codex/macos-live2d-generic-compatibility-v1
SOURCE_PR=15
ACCEPTED_HEAD=7ef071c791483aa362872e473cea676d2f248fa9
ACCEPTED_TREE=1904fbfc5e0ddf4ee9fab5fcf4dbd05fa45914c9
PR_STATE_AT_LAST_REPORT=OPEN / DRAFT / UNMERGED
WORKTREE_AT_LAST_REPORT=clean

DAILY_APP=/Applications/airi.app
DAILY_APP_ASAR_SHA256=77134827610ca31345c6b5a3b2ff2e6ced41c5eb82cdd6b39bd84a26b884a20a
APP_VERSION=0.12.0-beta.5
BUNDLE_ID=ai.moeru.airi

ACCEPTED_CANDIDATE=/private/tmp/AIRI-PR15-realtime-chat-handoff-repaired-19a5507.app
DAILY_PROFILE=/Users/mizukinamachi/Library/Application Support/ai.moeru.airi
LATEST_BACKUP=/Applications/airi-pre-7ef071c7-deployment-backup-20260925.app
```

这些 macOS 本机路径用于解释历史与定位，不是 Android 的目标目录。最终部署/运行情况来自本对话 Owner 与 Codex 证据；本次整理只读取了冻结 SHA 的远端源码，没有访问用户 Mac 或核验 Android 当前工作树。后续远端分支可能前进，**引用本次实现时用固定 commit，不用浮动 main/PR HEAD**。[E01][E02][S11]

### 1.2 证据标记

| 标记 | 含义 | 不能推导出的事 |
|---|---|---|
| `[Sxx]` | 本次读取的固定 SHA 源码、diff 或工程笔记 | 不能自动证明实际设备运行、账号额度或主观听感 |
| `[Exx]` | 本对话完整 CODEX_REPORT 或 Owner 确认，文末有证据索引 | 不代表所有账号/版本/设备相同 |
| `[Axx]` | 本次额外核对的 Android 官方平台文档 | 不代表本 Android 项目已采用相应实现 |
| `移植建议` | 从已发生问题推导的 Android 设计建议 | 不是 macOS 已提交代码，也不是 Android 已通过测试 |
| `待 Android 核对` | 依赖目标仓库/设备/SDK 的事实 | 不能用本交接替代本地审计 |

### 1.3 历史笔记不能作为最终状态总表

冻结源码的 `qwen-audio-realtime-voice-integration.md` 是累计笔记，仍有互相不一致的历史文字：ASR pending、native entitlement 未证明、只提供一个 voice、`HOLD_REAL_TOKEN_PLAN_CUSTOM_APP_CALLS` 等。后续章节和完整报告已经更新其中一些事实，但前面的旧表未全部同步。

本交接不删除历史，也不假装它们不存在。**最终运行状态以 `[E01]–[E03]` 为准；协议行为以固定源码为准；旧笔记用于事故来源和历史经验。** 不能从旧表重新判定“ASR 未完成/Token Plan WS 不可用”。[S01][E01][E02][E03]

另：本次尝试读取冻结 SHA 下历史引用的 `docs/handoffs/QWEN_MACOS_TO_ANDROID_IMPLEMENTATION_HANDOFF.md`，GitHub 返回 404；没有把该未取得正文的文件当作证据。当前文档可独立使用，不要求用户重新上传旧 handoff。

---

## 2. 最终能力、入口与数据流

### 2.1 按能力分路，而不是全局“Qwen 开关”

| 能力 | 产品 provider ID / 实际型号 | 网络合同 | 凭据与状态 |
|---|---|---|---|
| TTS | `qwen-audio-tts-token-plan` / `qwen-audio-3.0-tts-plus` | 原生 task WS | 共享 Token Plan 安全凭据；已验收 |
| ASR | `qwen-audio-realtime-token-plan-transcription` / `qwen-audio-3.0-realtime-plus` | 手动 turn、只输入转写的 Realtime WS | 同一份 Token Plan 安全凭据；已验收 |
| TTS 模型目录 | `GET /compatible-mode/v1/models` | OpenAI-style `data[].id` | main 内带 Token Plan Bearer；已实测；做兼容交集 |
| 音色目录 | `qwen-audio-tts-token-plan-catalog.ts` | 无运行时远端全量音色查询 | 599 条公开快照；与 model API 来源分离 |
| AIRI 回复生成 | 用户原有 LLM provider | 原 AIRI Chat/LLM 链 | 不是本模块替换的对象 |
| 旧 Workspace realtime ASR | `qwen-audio-realtime-transcription` / `qwen-audio-3.0-asr-flash-streaming` | Workspace `/inference`、`run-task` | 独立保留；不是 Token Plan fallback |

来源：[S01][S02][S05][S06][S09][S10][E01]。

### 2.2 三个真正用于当前产品的网络入口

```text
# 账号模型查询
GET https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models

# Token Plan TTS
wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference

# Token Plan realtime-plus 只转写 ASR
wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus
```

认证在受信任网络层构造 `Authorization: Bearer <Token Plan credential>`。这些组合已在 Owner 账号中运行成功；这不是对所有账号未来服务行为的无条件保证。[S02][S05][S08][E03][E04]

历史还使用过 HTTP/SSE TTS 对照入口 `/api/v1/services/audio/tts/SpeechSynthesizer`，但它**不是最终 AIRI Stage 正常 TTS 路由**。不要从上一段历史说明错误移植为最终的 REST `speech()` 实现。[S01，§12、§14][S03]

---

## 3. 共享凭据：实现与权限边界

### 3.1 macOS 实际做法

`qwenAudioTtsTokenPlanCredentials` 虽然名字带 TTS，最终 ASR 与 TTS 都复用这份 Token Plan authority。不要因名字而给 ASR 再建一套 Key。[S04][S09]

分为两个接口面：

```text
getPublicProfile / getPublicDiagnostic
  → hasApiKey / ready / source / secureStorageAvailable / reason 等非秘密状态

getRuntimeProfile
  → 只在 Electron main 内获取 apiKey，用于固定路由请求
```

macOS 保存格式是 `version: 1` 加 `apiKeyCiphertext`，通过 Electron `safeStorage` 加密，临时文件写入后 rename，文件权限 0600。**这个持久化格式只供理解，不能把 macOS 密文文件复制到 Android。** `[S04]` 还保留 `TOKEN_PLAN_API_KEY` 环境回退：secure-store 不可形成 runtime profile 时可使用显式 Token Plan 环境变量；它不是 PAYG 回退，public source 会区分。Android 没有必要照搬桌面环境变量机制。[S04]

### 3.2 “密钥不进 renderer”的准确含义

调用 ASR/TTS/model-list 时，UI 只提交 provider/model/voice/session/audio/text 等业务数据，**不再传送已保存的 Key**。但用户首次在设置页输入 Key 的保存流程，本来就包含一次短暂的 UI 输入和 typed save 请求；不能把“renderer 从来不接触任何输入密钥”写成不可能满足的绝对事实。保存后不要回显/持久化到普通 UI 状态；运行时解析留在原生受信任层。[S04][S07][S10]

### 3.3 诊断不能只有 missing

曾出现“凭据文件存在，但页面显示 Not configured”。最后证明不是 Key 遗失，而是候选包 identity 错误引起 safeStorage 解密失败。现在保留以下非秘密原因：

```text
RECORD_ABSENT
RECORD_PRESENT
ENCRYPTION_UNAVAILABLE
PAYLOAD_PARSE_FAILED
SCHEMA_INVALID
DECRYPT_FAILED
PROFILE_NOT_FOUND
PROFILE_PRESENT_CONFIGURED
ENVIRONMENT_CONFIGURED
UNKNOWN_ERROR
```

不要输出 Key 前缀、密文、完整 payload、Authorization 或原始 Keychain 数据。`Configured` 只表示本地可解析，不等于云端额度、所有型号权限或计费已经验证。[S04][E09]

### 3.4 用户授权边界

本项目 Owner 明确要求普通代码实现、测试、构建、受控内部凭据使用、既定路线内诊断由 Controller 调度，不要每一步问“是否允许加 IPC/内部解密/实现 probe”。但这不等于允许跨 Provider 使用 Key、绕过工具拒绝或批量真实调用。明确的真人权限弹窗、Key 首次录入、真人发声/听感，以及开发方向变更，才保留相应人类步骤。[E10]

---

## 4. TTS：已验证的完整实现合同

### 4.1 上层接口不要与网络协议耦合

上层使用 `StageTtsSession`：`appendText`、`appendSpecial`、`finishInput`、`end`、`cancel`。Token Plan 有专用 adapter `createQwenAudioTtsTokenPlanStageSession`；不能仅把 provider 标为 `bidirectional-ws` 就复用其他供应商的消息协议。[S01，§9–10][S03]

```text
AIRI LLM 文本流
  → provider-aware StageTtsSession resolver
  → Token Plan Stage adapter
  → typed start / textAppend / finish / cancel
  → main Token Plan TTS session
  → 原生 WebSocket
  → binary PCM + 序号
  → 本地 PCM playback bridge
  → speaker / analyser / lipsync
```

生成模型与 TTS 可以流式重叠，不要求等整段 LLM 回复全部生成后才开始语音。过早 finish 和 finish 后继续 append 都需要明确状态约束。[S02][S03]

### 4.2 Wire 示例：固定于本次已验收实现

以下是结构示例；`task_id` 每个 TTS task 生成一次并在其所有帧保持一致。示例不含凭据。[S02]

```json
{
  "header": {"action": "run-task", "task_id": "TASK_ID", "streaming": "duplex"},
  "payload": {
    "task_group": "audio",
    "task": "tts",
    "function": "SpeechSynthesizer",
    "model": "qwen-audio-3.0-tts-plus",
    "parameters": {
      "text_type": "PlainText",
      "voice": "longanlingxin",
      "format": "pcm",
      "sample_rate": 24000,
      "volume": 50,
      "rate": 1.0,
      "pitch": 1.0,
      "enable_ssml": false
    },
    "input": {}
  }
}
```

等待 `task-started` 后：

```json
{"header":{"action":"continue-task","task_id":"TASK_ID","streaming":"duplex"},"payload":{"input":{"text":"需要朗读的 AIRI 回复文本"}}}
```

输入结束后：

```json
{"header":{"action":"finish-task","task_id":"TASK_ID","streaming":"duplex"},"payload":{"input":{}}}
```

本地取消时，macOS 另有同 route 的 cancel builder：`finish-task`、`input: {"directive":"cancel"}`。取消是“立即停止本地播放并终止本轮”，不是正常 finish/drain。[S02][S03]

### 4.3 正确状态机

```text
created_local → connecting → waiting_task_started → ready
                    │                            │
                    └── error → failed           ├── appendText*
                                                 └── finishRequested → finishing
                                                         │
                                         继续接收 binary audio / result-generated
                                                         │
                                                    task-finished
                                                         │
                                               本地播放队列排空
                                                         │
                                                       done
```

关键规则：

- `task-started` 之前只做有界文本排队；按顺序 flush。
- 所有 `continue-task` / `finish-task` 都保留 `task_id` 和 `streaming=duplex`。
- 短句输入结束后可以立即 finish；**不要先等第一块音频，等不到就不 finish**。
- `finish-task` 发出后仍继续接收音频；不能立即关 socket。
- `task-failed` 从 `header.error_code/error_message` 取有限诊断，不用泛化的 session-inactive 覆盖真正原因。
- main 服务与 adapter 队列都需要有界；本次 main pre-ready 文本限制 32×1024 字符，Stage pending 文本限制 64×1024 字符。这是应用限制，不是阿里云规格。[S02][S03][S01，§14–15]

### 4.4 Text 与 binary 帧必须按协议种类区分

曾经 `task-started` JSON 以 Node Buffer 到达，被旧代码误当 PCM，导致“audio arrived before task-started”。**Buffer/Uint8Array 不是帧类型。** crossws 路径必须保留 `message(data, isBinary)` 的第二个参数：false 作为 UTF-8 JSON，true 作为 PCM。Android agent 应使用自己的 WebSocket 库所提供的 text/binary 分离回调，不按字节容器类型猜。[S01，§19][S02]

TTS 控制事件：`task-started`、`result-generated`（sentence-begin/synthesis/end）、`task-finished`、`task-failed`。二进制 PCM 不应送入 JSON parser；JSON 不应送播放器。[S02]

### 4.5 播放与尾音

返回的是 **raw PCM16LE，mono，24 kHz**，不是 WAV/MP3。macOS 通过 PCM→Float32→AudioBuffer 调度，不用 `decodeAudioData` 猜容器，也不需要给每块 PCM 包 WAV。[S01，§9–10][S03]

必须区分：

```text
远端合成完成 ≠ 本地已播放完
```

正常 `onDone` 要等待 remote finished **且**本地 owned audio sources drain。取消/错误才立即 stop。曾观察到远端比播放快很多，remote-finish 后仍有数十秒本地排队；这个现象本身不是故障，不能为了缩短该间隔剪掉尾音。历史延迟样本也不能变成 Android SLA。[S01，§20–22][S03]

---

## 5. 模型、声线、设置：不能伪装动态能力

### 5.1 实际模型来源是“动态交集 + bundled fallback”

```text
用户手动刷新 / secure credential 保存成功后的有界刷新
  → main GET Token Plan /models
  → 验证 {data:[{id:string}]}
  → main 已支持 TTS ID 过滤
  → 与本地 ModelInfo 兼容表相交
  → token-plan-account-api model options
```

目前 main 的 `TTS_MODEL_IDS` 只有 `qwen-audio-3.0-tts-plus`，catalog 的本地模型定义也只有这一项。所以更准确的表达是：**动态发现账号返回中的已支持模型，而不是自动支持任意未来型号。** 扩型号需要同时核对协议支持和本地兼容注册；不能仅因名称带 audio 就归为 TTS。[S05][S06]

本次账号查询曾得到 15 个模型，经当前过滤保留 1 个 TTS。15 是本次有限响应的观测，不是永久常数；源码只返回有界 model IDs，不能把截断后的数量无条件称总数。[E04][S05]

### 5.2 当前请求限制与回退

源码：timeout 10 s，最大读取 512 KiB，最多输出 128 个 model IDs，每个 ID 最长 128 字符；redirect:error，不自动重试。401/403/404/405、empty、非目录 payload、malformed、timeout、network 要区分，但失败不自动判 Key 全局失效。[S05]

刷新失败/空结果/无兼容 TTS 时保留官方快照与有效选择。首次打开设置主要加载 bundled 目录；账号 source 不保证跨进程保持。重启后显示 bundled、尚未刷新，不构成动态查询回归。[S07][E01]

### 5.3 两套来源状态必须独立

```text
modelCatalogAuthority = account | bundled
voiceCatalogAuthority = bundled       # 本次没有动态 voice API
```

曾使用一个 `catalogSource` ref 同时驱动 model 与 voice，导致模型刷新成功后把 599 静态音色也标成账号 API。修复后两者独立，并在同一实机画面验证：model=账号 API、voice=随应用官方快照。[S07][E05]

### 5.4 音色数据模型与搜索

每个 voice 保留 canonical ID、name、description、languages、gender（有则保留）、compatibleModels、catalogKind、catalogSource/sourceUrl/updatedAt。当前快照日期为 **2026-07-23**；音色试听文件未随列表全部打包。[S06][S01]

当前查询逻辑是 trim/lowercase 后在 **ID、name、description** 中做子串匹配。并没有证据表明支持任意中文别名、拼音或别家模型 voice 名映射。因此中文展示/别名搜索是可单独定义的 UI 能力，不能靠“有英文目录”假定支持。[S07]

`longanlingxin` 有本次 Owner 实际成功证据；`longanlufeng` 是目录项但没有本次同等实测；“已验收某声线”与“整个声线集合来自账号 API”完全不同。不要把之前回答中对 `longanlufeng` 的无条件可用表述扩展为测试证明。[E02][E05][S06]

`longfeifei_v2` 的跨模型声线需求本轮由 Owner 暂缓。Android 第一阶段不应强行塞入当前 Qwen-Audio-TTS 兼容列表，也不应把它当验收必需项。需要新的 voice family 时另核对对应 model/voice 合同，不延伸本次证明。

### 5.5 浏览、选择、持久化、运行时解析是四件事

只打开其他 provider 的设置、搜索或刷新，不应暗中切换 active provider。主动选择后要保证：

```text
activeSpeechProvider
activeSpeechModel
activeSpeechVoiceId
resolved activeSpeechVoice
```

四者一致。只恢复 voice 字符串但未 hydrate `VoiceInfo`，运行时仍可能失败；不能用 `?? 'Cherry'` 或另一个默认 voice 掩盖错配。cold start、provider 切换、目录刷新、跨窗口同步均需覆盖。[S01，§16–17][S07]

### 5.6 异步 ownership

目录请求序号与共享 loading/error 的 owner 必须分开。旧 provider 的晚失败不能污染当前 provider；同 provider 的“只浏览、不追踪共享状态”的请求不能让 loading 永久悬挂。刷新 model 的 error/loading 也不能串到 voice 列表。[E05]

---

## 6. ASR：realtime-plus 仅转写的最终协议

### 6.1 为什么不是 Flash HTTP 或 vendor 全对话

最初尝试 `qwen-audio-3.0-asr-flash` 配 `/compatible-mode/v1/chat/completions` + input_audio Data URI，唯一一次实测返回 HTTP 400，未取得可用 transcript，也未展示具体 Provider code/message。因此只证明**这一固定请求失败**，不能仅凭 400 断定 Key 错、套餐无 ASR或所有 HTTP 路由不支持。该假设已停止，不重试/枚举。[E06]

随后 Owner 选择继续 Token Plan。realtime-plus 是语音对话模型，但可以只用其输入转写 seam：手动 commit 后不发送 response.create，把 transcript 交回 AIRI。该组合最初为复合文档推断，后来在本账号实际取得 completed transcript，再通过生产麦克风 E2E；现在不再是“仅理论上可能”。[E03][E02]

### 6.2 客户端事件

WSS 握手和 `session.created` 后发送：[S08]

```json
{"type":"session.update","session":{"modalities":["text"],"input_audio_format":"pcm","turn_detection":null}}
```

`session.updated` 后，每块音频：[S08]

```json
{"type":"input_audio_buffer.append","audio":"BASE64_OF_RAW_PCM_ONLY"}
```

AIRI 本地 VAD 判定语句结束、flush 完后：[S08][S09]

```json
{"type":"input_audio_buffer.commit"}
```

**本路线永不发送** `response.create`；不配 server_vad、tools、供应商回答 instructions、供应商历史或输出音频。`modalities=[text]` 本身不能替代 no-response-create 约束；必须在发送路径中排除回答生成事件。[S08][S09]

### 6.3 服务器事件与处理表

| Wire event | 关键字段 | 行为 |
|---|---|---|
| `session.created` | type | 发送 session.update；非终态 |
| `session.updated` | type | 允许发送/flush 音频；非终态 |
| `input_audio_buffer.committed` | event_id、item_id、previous_item_id（可空/省略） | 正常 ack；保存本轮 item；不是错误，也不是成功 |
| `conversation.item.created` | item.id、type=message、role=user、content 含 input_audio | 用户项 lifecycle；不是 AI 回答；继续 |
| `conversation.item.input_audio_transcription.delta` | text、stash、可选 item_id/content_index | progress；不终止、不发 chat |
| `conversation.item.input_audio_transcription.completed` | transcript、相关 item/content | 本路线唯一 final 成功来源 |
| `conversation.item.input_audio_transcription.failed` | error.code/message、相关 item/content | sanitized terminal failure；不发 chat |
| `error` | error.code/message | terminal failure |
| `response.*`、assistant item、output_audio 等 | type/role | unexpected vendor generation；丢弃并结束，不播放、不进 AIRI |

来源：[S08][S09]。官方 server-event 页面亦定义上述事件族；实际事件先后不要从单个示例推成不可交错的全序。[W01]

### 6.4 两次 parser 事故必须一次性避免

第一处：把输入转写 delta 错当其他 realtime 的 `event.delta`。本协议是 **text + stash**，两者可以为空；这是当前转写状态，不是可无脑追加到历史的文本 delta。[S08][E07]

第二处：只处理 transcript，却漏了正常 `input_audio_buffer.committed`，把它标为 unsupported/malformed 后关连接，永远等不到 completed。还要支持 matching user `conversation.item.created`，不能把用户音频项当供应商回答。[S08][E07]

允许未知 optional fields；能安全忽略的 malformed partial 不必立刻杀整轮；整体 JSON/envelope 失效与真正的 assistant generation 仍应明确终止。不能用“所有未知事件都忽略”掩盖错误。[S08]

### 6.5 音频数据不是 WAV 容器

生产链直接送 raw PCM16LE / mono / 16 kHz。当前 AIRI VAD 每块 512 samples，约 32 ms、1024 bytes。对约 0.937 s 的诊断 fixture，实际文件 **34080 bytes**，raw PCM data **29984 bytes**，分 30 个 append；不要假定 WAV 永远只有 44 字节头部。[E03][S08]

RIFF parser 需遍历 chunk，处理奇数长度 padding，只取 data chunk；验证 fmt 为 PCM16/mono/16 kHz。fixture 是诊断材料，不是生产输入来源。Android 录音若已经给 raw PCM 就不要再包/拆 WAV。[S08]

### 6.6 生命周期、缓冲和限额

每个 AIRI VAD utterance 一个短 WebSocket session：speech start 建连，未 ready 时暂存，session.updated 后顺序 flush，speech end commit once，completed/failed/timeout 后 close。这样不跨句累积 vendor conversation history。[S09][E03]

冻结源码中可见的数值：

| 项目 | 值 | 性质 |
|---|---:|---|
| 生产 pre-start PCM buffer | 256 × 1024 bytes | 应用自身上限，不是 Provider 限额 |
| 握手阶段 timeout | 10 s | 当前实现 |
| session.updated timeout | 10 s | 当前实现 |
| commit 后 transcript timeout | 15 s | 当前实现 |
| final transcript 输出截断 | 2000 字符 | 当前实现 |
| sanitized error 上限 | 240 字符 | 当前实现 |
| VAD 本地语段 ceiling | 30 s | 本次源码审计报告给出的本地边界 |

16 kHz×mono×16 bit = 32000 bytes/s，256 KiB 约容纳 8.192 s 音频，**并不是 30 s 的完整语段缓存**。Android agent 必须将“建连前缓存上限”和“整句长度上限”分开，不得把报告中的两个数字合并为不存在的保证。[S09][E08；容量为直接计算]

---

## 7. 从 ASR 转写到 AIRI Chat：最后一个真正影响体验的坑

### 7.1 内部桥接不等于远端 SSE

macOS 生产 provider 用 Eventa 把 main 转写消息送回 renderer，再包装成 `text/event-stream` Response，以适配 AIRI 既有 `streamTranscription` 接口。这个 SSE 是**本地接口桥**；远端仍是 WebSocket，不要据此在 Android 实现一个不存在的远端 ASR SSE API。[S10]

```text
main onTranscription(text, isFinal)
  → session-scoped typed IPC
  → AIRI transcript.text.snapshot {text, isFinal, locale,...}
  → Hearing stream consumer
```

当前 provider 包含 Electron/macOS 平台 gate：`isStageTamagotchi`、`isElectronWindow`、`window.platform === 'darwin'`。直接复制 TypeScript provider 到 Android 会不可用；应复用合同，改写平台适配层。[S10]

### 7.2 UI 看见文字不代表已经发送聊天

真实测试中 Hearing UI 出现 4 条转写，但 Chat 中没有这些新用户消息，LLM/TTS 没被触发。不是 ASR 未识别，不应重新调 PCM、Key 或 WS；也不是 TTS 故障。第一个失败边界是 completed→Chat handoff。[E11]

旧实现把 final snapshot 保存到 UI，主要在 stream reader teardown/finally 阶段结算；stop/abort 与交接存在竞争，UI 已显示但 chat 未触发。最终修复加了 `createStreamingTranscriptionFinalConsumer`：[S11][S12][S13]

```text
snapshot/delta → onUpdate（只更新文字展示）
isFinal=true snapshot → 立即 publishFinalOnce → onFinal → onSentenceEnd
normal stream EOF → complete()，作为通用流的结算路径
abort/error → 不以 incomplete text 执行 complete()
```

### 7.3 实现要点（非网络代码）

```typescript
// 对冻结源码 final-consumer 的语义摘录，不是新的 Android 实现。
let fullText = ''
let finalPublished = false

function publishFinal() {
  const text = fullText.trim()
  if (!text || finalPublished) return
  finalPublished = true
  onFinal(text)
}

// snapshot：替换当前文本；isFinal=true 时立即 publishFinal()
// delta：追加到当前 UI 文本，不直接调用 chat
// complete：仅正常 EOF 调用；publishFinal() 去重
```

`finalPublished=true` 要在调用下游前设置。同一 final、close、normal EOF 或 stop 重复到达，不得重复发送。[S11]

### 7.4 不能夸大的两个结论

**第一，通用 final consumer 不是“任何 delta-only 流永远不能发送”。** 冻结测试明确支持 delta-only 流在正常 EOF 调用 complete 后结算一次；这服务于既有 provider 的兼容性。Token Plan 生产 provider 的可信成功仍来自 completed，然后正常结束。Android 需要区分 provider 的 final authority 和通用流适配行为，防止网络断流被误当正常完成。[S10][S11][S12]

**第二，ASR final 到 Chat 还有应用 turn endpoint。** 工程笔记记录 streaming path 使用约 500 ms、VAD 驱动的 turn 聚合窗口；recorder path 则有 1200 ms 文本 buffer。不要把后者延迟算成 Qwen streaming 模型延迟，也不要机械规定“每个 provider final 立刻独立一条 chat”。最终目标是每个已接受逻辑用户轮次正确交接一次，不是无条件每个网络片段发一次。[S01，§8]

### 7.5 必测 race

- final 已接受 → stop：已接受 handoff 应完成一次。
- stop → late final：不再发布。
- provider 切换 → 旧 session 回包：不污染新 provider。
- listening generation 改变：旧 generation 不进入新聊天。
- delta 多次 → final → EOF：Chat 只接收一次 final，不把 partial 逐条发送。
- empty/failed/真正的 abort：不把错误信息或 incomplete transcript 当用户聊天。

上述是移植时要保留的合同；本次 macOS Owner 已证实一轮真实 E2E 的用户消息恰好 1 条、AIRI 回复正常且 TTS 可听，不等于所有并发 race 都已经做了实机穷举。[E02][S11][S12]

---

## 8. macOS 打包与运行身份：为什么曾耗费大量调试

### 8.1 双层 out：字符串在包里不等于正在运行

手工重建 app.asar 曾形成：

```text
/out/renderer       # 旧文件，Electron 实际加载
/out/out/renderer   # 新文件，仅能被静态搜索找到
```

所以静态 grep 看到 ASR probe 字符串、data-testid，并不证明运行页面有按钮。修复是清晰的单一 `/out`，main/preload/renderer 同一份 fresh build，核验实际 renderer URL 指向的 chunk。[E09]

**移植启示：** APK 里含某资源/某类不等于实际加载的 WebView bundle/入口用了它。验证运行入口与构建产物关联，不止搜字符串。

### 8.2 bundle ID 相同仍可能不是同一加密身份

错误候选 root `package.json.name` 为 `@proj-airi/stage-tamagotchi`；日常包为 `ai.moeru.airi`。尽管 CFBundleIdentifier 相同，Electron app name/safeStorage authority 不同，原密文解密失败。恢复官方 `extraMetadata.name=ai.moeru.airi` 后，既有 credential 立即识别为 saved，不用重新输 Key。[E09][S04]

**移植启示：** Android 中检查实际 applicationId、安装身份、Keystore alias 与恢复策略，不照搬 safeStorage 原因，更不能复制 macOS 密文解决。

### 8.3 userData 路径必须是真实观察

`APP_USER_DATA_PATH` 被设置不等于 main 实际用了它；绑定需早于 app.ready、credential service 初始化和路径缓存。最后通过 main 的 `app.getPath('userData')` public preflight 才证明确实为 daily。[E09]

### 8.4 同版本、同 bundle、多个临时 App

多份产物都显示 0.12.0-beta.5，不能靠版本号、Dock 图标判定正在测谁。Finder/LaunchServices 有时重开到 `/Applications/airi.app`，而不是目标 `/private/tmp/...app`。每次 runtime authority 应绑定 path + source HEAD + asar hash + actual process/renderer path。[E01][E09]

### 8.5 daily profile 冲突

同一 profile 被旧 AIRI/hidden candidate 占用时不能并行启动另一实例。正常 Quit 精确实例；不要泛匹配 killall/pkill，不杀无关 Electron。正常启动会触碰 cache/log/IndexedDB metadata，**“无主动配置修改”不等于“绝对零磁盘写入”**。[E09]

### 8.6 GUI 自动化不可靠，不等于产品协议失败

多次在 Settings→Qwen detail 丢失 CUA window handle，导致还没点按钮就停止；这些尝试的 WS 请求数是 0，不能记成 Provider 失败。不能无限重做同一导航，也不能以此改动已通过 parser。[E09]

最终加了 App 自身 main-process one-shot runner：

```text
--token-plan-realtime-transcript-probe-once
--probe-dry-run                 # 仅检查，无连接
```

它复用正式 credential 和协议 service，不开 renderer 窗口，输出带 run-id 的 sanitized JSON，原子写入、0600、执行后退出。普通启动不触发。它不是 curl、外部 Node WS、DevTools 注入或密钥导出旁路。生产 ASR 后普通 UI 的临时 diagnostic 控件已退休；runner 仅保留显式诊断入口。[E03][E09][S01]

**移植建议：** Android 可以在既有 instrumentation/debug 环境做等价的一次性诊断入口；不要把 macOS CLI 参数照抄进手机，也不要为绕过某工具明确拒绝而另造旁路。最终 E2E 仍走正常产品 UI、真实麦克风。

### 8.7 构建环境失败与代码错误分开

曾反复遇到 EMFILE watcher 限制、GitHub DNS/依赖下载失败、Volar/字体警告。项目使用 polling、CI 模式/隔离 renderer build、临时 build-only watcher workaround 和 fresh-output 重建包完成验证。这些手段解决的是已识别的构建环境问题，不允许忽略新的 type error/test assertion。

最严重的后果恰好来自“等价手工打包”——双层 out 与错误 root metadata。因此 Android 的 APK/AAB 重建也必须有完整 provenance，不能一句“本地等价验证”替代实际产物与运行身份核对。[E09][E12]

---

## 9. 踩坑总表：症状 → 原因 → 修复 → 移植防线

| 编号 | 踩坑/错误判断 | 真实修复或最终结论 | Android 应保留的防线 | 依据 |
|---|---|---|---|---|
| P01 | 把 Token Plan Key 与普通 DashScope Key 混用 | 按 capability/provider 分路，禁止静默 PAYG fallback | 独立 route 与 credential authority | S02/S04/E04 |
| P02 | 未发送请求就说接口不支持/404 | 0 request 只能 UNPROVEN | 统计 attempted、connected、accepted、completed 分层 | E04 |
| P03 | 反复只查文档或无限猜 endpoint | 对有依据假设做单次有界实验，修客户端事实错误后再验证 | 实验有固定 endpoint/model/schema/budget | E06/E07 |
| P04 | Flash + chat/completions HTTP 400 被泛化 | 固定假设失败，不证明所有 ASR 不可用 | 不自动改 body/切路由/重试 | E06 |
| P05 | 认为 realtime-plus 必然替代 AIRI 大脑 | 使用 manual commit 的 input transcription，零 response.create | 只交回 transcript，不接受 vendor 回答 | E03/S08 |
| P06 | ASR delta 误用 event.delta | Qwen-Audio 用 text/stash | 带真实官方形状的合成 parser 测试 | S08/E07 |
| P07 | committed ack 被当 malformed | 正常 nonterminal ack，保留 item | 完整 lifecycle event 表，不只测 transcript | S08/E07 |
| P08 | user item created 被当 assistant | 按 role/type/content 区分 | 用户 lifecycle 与供应商生成分开 | S08 |
| P09 | 文本 WS frame 的 Buffer 被当音频 | 显式 text/binary metadata | Android WS text/binary 回调分离 | S01 §19 |
| P10 | TTS run/continue/finish 字段不完整 | 同 task_id、duplex、正确 input 与参数 | 固定 wire fixtures | S02/S01 §15 |
| P11 | 短句先等音频再 finish | 输入结束及时 finish，继续收音频 | finish 发送与音频接收互不阻塞 | S01 §15 |
| P12 | task-finished 时立刻停播放 | remote finished + local drain 才正常结束 | 播放队列 drain 与 cancel 分开 | S03 |
| P13 | 页面展示模型/声线就当 active | 4 元组 provider/model/voiceId/VoiceInfo 同步 | 浏览不切换，主动选择才生效 | S07/S01 §16–17 |
| P14 | 保存 voiceId 但没恢复 voice object | 从当前目录 hydrate | 冷启动、切回 provider、重载测试 | S01 §17 |
| P15 | “当前模型”存在但主设置空列表 | detail 与主设置共用 catalog lifecycle | 不隐藏 empty 警告掩盖加载遗漏 | S01 §23 |
| P16 | 599 数组被称动态账号音色 | 公开快照明确来源和日期 | API/source/实测权限三层分离 | S06/E05 |
| P17 | model 与 voice 共用 source ref | 独立 authority，实机同屏验证 | model refresh 不污染 voice source | S07/E05 |
| P18 | 旧 provider 晚返回污染 loading/error | 请求 sequence 与 owner 分离 | stale 结果不得发布/改选择 | E05 |
| P19 | settings 注册 provider 但无 detail route | 文件路由与 component 一起补齐 | Android 选项、页面、实际 adapter 联动 | S01 §6/10 |
| P20 | IPC 事件广播导致丢错窗口 | 保存 originating target，按 session 发 | 多 Activity/WebView owner 与生命周期隔离 | S01 §6/S09 |
| P21 | first error 被后续 session inactive 覆盖 | bounded first-terminal-error retention | 记录第一失败边界，不掩盖 auth/transport 原因 | S01 §6/27 |
| P22 | 建连前 PCM 直接丢掉 | 有界 queue，ready 后顺序 flush | 测句首不丢、overflow 明确失败 | S09 |
| P23 | snapshot 当 delta 追加，文本重复 | snapshot replace，delta interim，final 去重 | 全词替换与字符增量不得混用 | S10/S11 |
| P24 | Hearing 见到文字就宣称 E2E PASS | 最后还须确认 chat/LLM/TTS | 分层验收，第一断点修复 | E11 |
| P25 | final 等到 stream finally 才交 chat | isFinal 立即 publish once | final-before-stop 与 stop-before-final 双 race | S11/E12 |
| P26 | 旧 app.asar 中有新字符串就算新版本 | stale /out 与 fresh /out/out 被纠正 | 验实际入口、单一产物树、source hash | E09 |
| P27 | bundle id 相同就算 credential 相同 | root package name/app identity 必须匹配 | 不复制密文，不靠重输掩盖身份错配 | E09/S04 |
| P28 | userData 环境变量等同实际 profile | main runtime path 才是证据 | runtime authority 从原生实际状态返回 | E09 |
| P29 | 同版本/同图标识别错误候选 | path+hash+source+process 多重 identity | applicationId/versionCode/artifact hash/签名核对 | E01/E09 |
| P30 | CUA 失窗反复跑同个流程 | 一次性正式 main runner，不靠 GUI | 提供受控诊断，但不替代产品 E2E | E09 |
| P31 | 常规 cache 写入被报告“profile零写入” | 区分启动写入与主动配置 mutation | 不为伪零写入清 profile/回滚 | E01/E09 |
| P32 | 已验收源码直接宣称用户日常 App 完成 | candidate→Owner验收→完整部署→身份 smoke | 安装、配置保存、包身份必须分开 | E01/E02 |
| P33 | 修复后为了各种形式反复真人发声 | 充分证据复用，仅真实受影响链路复验 | agent 做准备，Owner 只做必要设备输入 | E02/E10 |
| P34 | 无完整 error code/message 就继续改协议 | sanitized 诊断须可观察，不泄露 raw body | 错误类别、阶段、code/message 足够区分 | E06/S05 |
| P35 | 把旧 policy 笔记当永久禁止或永久免费许可 | 记录文档冲突、用户客服反馈及适用边界 | 不作新法律断言，不自动换按量方案 | E10/S01 |
| P36 | 测试通过数量等同完整 E2E/所有 race 已覆盖 | 区分 helper/source-contract/集成/runtime/Owner | 报告实际覆盖而不是只报 test 总数 | S12/E12 |

---

## 10. 开发时间线：保留因果，不重演过程

以下为关键可追溯节点，不是要求 Android 按旧任务数量逐一执行。[E04–E12]

| 节点 | 关键 source / task | 结果 |
|---|---|---|
| 初期 TTS 原生 WS | 工程笔记 §12–22；历史 `a3a9dc1d…` 等 | 修复 task 帧/finish/二进制分类；发声、尾音、流式重叠 |
| Token Plan 设置产品化 | `8b2d7dee…` | Key 专用保存、选择、试听、正常会话发声 |
| 599 公开快照 | `d37478a…` | 1 model + 599 voices；不是账号全量授权 |
| 刷新及共享状态修复 | `b6178d178…` → `01c1a8ddd…` | 浏览/选择分离、loading/error ownership |
| 正式 model-list 只读入口 | `b4314dade…` | main-only 请求、sanitized IPC；后续一次 HTTP200 |
| 动态模型与来源分离 | `40aef5f0…` → `8c8a5e0f…` | model API + voice snapshot 同屏正确；第一次 daily 部署 |
| Flash HTTP ASR 假设 | `4869d1a…` 等诊断任务 | 多次请求前阻塞；最终唯一 HTTP400；该假设结束 |
| 打包/凭据 authority | `6360e675…` → `eeed39d7…` | 修复双 out、root metadata、可观察 public reason |
| Route B realtime-plus probe | `c10d42b11…` | handshake/audio/commit 可达；delta parser 未覆盖 |
| delta parser | `55ac2b734…` | text+stash，继续等待 completed |
| committed / user item | `5f97f8bc0…` | ack nonterminal；后续受 GUI失窗阻塞，未消耗请求 |
| main one-shot runner | `a6555931…` | dry-run 通过；随后一次真实 WS 取得最终转写 |
| production ASR provider | `19a5507d…` | 接正常 microphone/VAD/Hearing；不再用 fixture |
| final→Chat handoff | `7ef071c7…` | isFinal 立即发布一次；解决 UI有字但 Chat无消息 |
| Owner E2E 与最终部署 | `[E02]` → `[E01]` | 一条用户消息、AIRI回复、TTS可听、正常停止；日常包已同步 |

重要：此前若干长报告中存在 SHA/hash 尾字符漏写、计数字段命名混淆或旧状态复制。Android agent 不得从某一条截断短写重新构造 hash。冻结 authority、源文件链接和完整 owner/deployment 证据见本文件及 `source_manifest.json`。

---

## 11. Android 应如何移植，而不是复制 macOS 目录

本节是 **移植建议**，不代表已检查目标 Android App。先读取 Android 仓库现有计划、技术栈和权限实现，再映射下列职责；不要自动改成新框架。

### 11.1 职责映射

| macOS 实现职责 | Android 建议对应位置 | 不应照搬 |
|---|---|---|
| Electron main 持有 Key、网络、session | Android 原生受信任 credential/network/session 模块 | JS renderer 长期保存 Key、macOS safeStorage 文件 |
| Eventa typed IPC | 项目已有 native bridge / 类型化内部事件 | 任意 JS eval、通用“传 URL+Key”代理 |
| VAD PCM16 16 kHz | 当前 Android audio capture+VAD；必要时明确转换 | 假设所有麦克风原生输出就是16k/mono |
| AudioContext PCM24k 播放/drain | 项目现有原生 PCM 播放器，或 AudioTrack 对等实现 | raw PCM 当 MP3/WAV 解码、收到 task-finished 就 stop |
| Vue provider/settings/store | 当前产品的 provider registry、UI/state | 另造平行配置系统、直接保留 darwin gate |
| session-targeted IPC | 当前 Activity/WebView/session owner 关联 | 向所有页面广播完成转写/音频 |
| .app path+asar+identity | APK/AAB hash、实际安装包身份、build variant/签名 | “versionName相同所以一定是刚打包的版本” |
| main one-shot runner | 仅在需要时用现有 instrumentation/debug 入口 | 正常启动自动上传音频、生产常驻诊断按钮 |

### 11.2 原生凭据：Key 的含义要分清

Android Keystore 保存的是加密密钥材料；应用可以用它保护 Token Plan API Key 的加密存储。**API Bearer 字符串要形成网络请求时仍会短暂存在于应用受信任内存**，不能宣传“API Key 永远不进入进程”。不把 Token Plan API Key 硬编码进 APK、不写到日志或普通 WebView storage。[A01]

建议优先复用目标项目已有的安全存储，保留 public status / reason；不要新建一套企业级凭据平台。debug/release、重装/恢复、多个包名的凭据行为须在目标安装身份下核对。macOS “别重输 Key”是禁止用重输掩盖同机候选身份错误，**不是禁止新 Android 安装通过其正常安全 UI 首次配置凭据**；绝不从 Mac 导出/迁移已有密文。[S04][E09；Android 行为属于移植建议]

### 11.3 音频与权限

Android 原生 AudioRecord 提供音频采集接口，AudioTrack 提供流式 PCM 播放接口；具体使用现有项目的哪一层由目标 agent 决定。采集参数必须实际检查，读取错误/部分读取和播放写入进度都应作为状态处理，不能仅设置16k/24k就假定设备路径正确。[A02][A03]

`RECORD_AUDIO` 是运行时敏感权限；需要用户授权，不应通过系统数据库绕过。若项目要后台麦克风或前台服务，必须按实际 target SDK 与 Android 当前限制另核对；本次 macOS 验收没有证明 Android 后台监听。[A04][A05]

### 11.4 生命周期和回声：本轮未替 Android 验证

至少验证页面切换、Activity 重建、停止监听、provider切换、应用切到后台时，旧 session 的音频和 final 不会发给新页面/新会话。网络所有权不要被临时 UI 导航误伤，也不要让旧音频无限驻留。[S09][S10；移植建议]

回声消除、耳机/蓝牙切换、扬声器播音回灌麦克风、全双工打断的实际效果依赖 Android 音频路径。**ASR/TTS 均能调用不等于 AEC/barge-in 都完成。** 工程笔记有早期其他路线打断实验，但不能把它继承为此 Android Route B 的已完成验收。[S01]

---

## 12. 冻结源码与报告不完全一致的细节：不要照着更强承诺实现

### 12.1 Correlation 的现有实现比报告描述更宽松

生产 main service 保存了 committedItemId；`user.item.created` 会对其检查。后续 `matchesCorrelation()` 主要使用 transcriptionItemId/contentIndex，且 parser 允许部分 correlation 字段省略。**不能把该源码描述为“任何情况下 completed 都必须先有 matching user.item.created、且直接对 committedItemId 严格验证”。** 真实成功 trace 的匹配已经证明；更严格的乱序/缺字段/不匹配承诺需要目标实现与测试明确覆盖。[S08][S09]

移植建议：每个独立 session 只有一个 utterance；明确记录 commit/item 关联；对合理乱序做有界暂存，避免凭空发明服务端不保证的总顺序；对无法归属的 final 不进入聊天。不要一边说强一致，一边让测试只覆盖成功顺序。

### 12.2 生产代码仍复用名为 probe 的协议文件

`qwen-audio-realtime-token-plan/index.ts` 从 `...transcript-probe/protocol.ts` 导入 socket builder/event parser。它是已复用的生产依赖，不可按文件夹名字“清理诊断代码”时一起删掉。Android 可按当前工程结构组织公共 protocol 模块，但不要因此大规模重构 macOS。[S08][S09]

### 12.3 `requiresCredentials:false` 不表示匿名调用

renderer provider 不收单独 ASR Key，所以 registry 写 `requiresCredentials:false`；main 仍要求既有共享 Token Plan runtime credential。Android UI 不应据此隐藏实际的凭据缺失/解密失败。[S09][S10]

### 12.4 ASR language 设置不等于已传服务端参数

renderer 配置含 auto/zh/en，并把 language 放入 start payload；当前 main session 使用固定 endpoint 和最小 session.update，所读源码没有将 language 变成服务端识别语言字段。报告中的 CURRENT_ASR_LANGUAGE=auto 只能说明应用选择，不能证明实现了强制 zh/en 识别。[S08][S09][S10]

### 12.5 一般性 safety 建议不等于所有代码路径已实现

例如 ASR WS constructor 明确 `followRedirects:false`，models fetch 是 `redirect:error`；所读 TTS constructor 本身只显式传 headers，没有相同选项。Android 应明确所有带 credential 的网络客户端 redirect 策略，但本交接不会伪称三条现有 macOS 路径均显式实现了同一项设置。[S02][S05][S08]

### 12.6 日志规则与当前语音 telemetry

项目要求日志不常态保存完整用户语音/文本/Key；但所读 hearing diff 仍使用 `ASRText` trace attribute。不能据报告就承诺“整个应用所有日志绝无转写内容”。Android agent 应核对目标项目的 telemetry 开关、脱敏与保留策略，不把 macOS 的诊断 trace 无条件带入生产。[S13]

### 12.7 测试报告应按实际层级读取

最终 handoff 修复报告的 integration result 实际是 helper tests + source-contract tests；真正 E2E 则来自后续 Owner 实机确认。二者共同支撑目前结果，但不能把 helper/source字符串断言说成从 provider 到真实网络/扬声器的自动集成测试。[S12][S14][E02][E12]

---

## 13. Android 开发顺序：跳过旧探索，保留必要平台验证

以下是建议阶段，不是同时下发多项 Codex 指令；由 Android agent 按自身 Controller 的单任务协议推进。

| 阶段 | 范围 | 出口证据 |
|---|---|---|
| A. 本地映射 | 核对 Android repo/branch、现有 provider、native bridge、安全存储、音频与聊天入口 | source mapping；不改路线，不猜 Android已有能力 |
| B. 基础入口/TTS | 共享 Token Plan Key、原生TTS task协议、播放drain、canonical选择 | fake transport 与 PCM playback 测试；无意外按量回退 |
| C. catalog UX | models动态交集、599快照、独立source、搜索与选择保持 | 网络成功/失败/stale/persistence测试 |
| D. transcript-only ASR | 原生WS、PCM16、manual commit、完整事件表、session/cancel | 合成事件全链测试；不重复macOS endpoint猜测 |
| E. Chat handoff | final立即接受一次、turn endpoint、stop/provider race | 从provider final入口到mocked正常chat入口的集成测试 |
| F. Android runtime | 安装identity、权限、真实mic→一个chat→AIRI回复→TTS | 有界真实设备E2E，区别协议和平台故障 |
| G. 部署收尾 | 正常安装/升级、保配置、已验收包identity | 安装后最小smoke，不重复无关实测 |

真人只做真实权限/密钥输入/一次有意义的发声与听感检查。不能让用户在多份旧 APK/临时包里猜当前版本，也不应把安全前置检查拆成无穷授权往返。[E10；其余为移植建议]

---

## 14. 可直接转成测试的验收矩阵

### 14.1 凭据与目录

| 测试 | 通过标准 |
|---|---|
| missing / decrypt-failed / configured | public reason准确；不输出 secret；不偷偷读别家 Key |
| 账号15项示例 + 1个支持TTS | 只显示兼容交集；不是硬编码账号总数 |
| 未来未知 audio ID | 不因带 audio 就进入TTS选择器 |
| 401/403/404/timeout/malformed/empty | fallback保留；不毁现有选择；不统一报Key错误 |
| model API成功 | model=account；voice仍snapshot |
| 旧provider晚返回 | 不污染新provider loading/error/selection |
| 重启/切回/目录刷新 | canonical选择和resolved对象一致 |
| 搜索 | 在已定义的ID/name/description范围工作；不伪造不存在别名 |

### 14.2 TTS

| 测试 | 通过标准 |
|---|---|
| text帧用Buffer表示 | 仍按text/binary元数据路由，task-started不被当PCM |
| pre-ready文本 | 有界且按序flush，overflow明确失败 |
| run→start→continue→finish | 同task、duplex、正确payload，finish后继续收音频 |
| final remote+local排空 | 尾音完整；done只一次 |
| cancel/error | 本地即时停止；晚音频忽略；第一错误不被inactive覆盖 |
| provider/model/voice切换 | 新请求带实际选中canonical值，旧session不改新配置 |

### 14.3 ASR/Chat

| 测试 | 通过标准 |
|---|---|
| session-created/updated gate | ready前排队，ready后按序发送 |
| WAV诊断文件 | 遍历RIFF，只发data，不假定44字节头 |
| ack / user.item.created | 非终态、正确关联，不误判供应商回答 |
| text+stash / 空partial / extra fields | 正常处理，不重复聊天 |
| malformed partial | 安全忽略时继续等final；整体坏envelope明确失败 |
| completed / failed / empty | 只有可信非空final成功；失败/空不发chat |
| mismatched item、乱序ack | 无串话/误发布；实际策略有测试 |
| response.created/audio/tools | 丢弃并关闭；零response.create |
| final→stop 与 stop→late final | 前者一次交接，后者不交接 |
| provider切换/generation变化 | 旧结果不污染新会话 |
| delta+final+EOF | 当前逻辑turn只交接一次 |
| 真实中文一轮 | 用户消息一次、AIRI原LLM回复、正常TTS、无vendor额外回答 |

这些测试是移植验收合同；不是本文件宣称所有 Android 测试已执行。macOS 最终 Owner E2E 一轮已经完成，Android 无需重新测试 macOS App。[E02][S08–S14]

---

## 15. 诊断和报告必须回答的事

不要用泛化 PASS、Configured 或“能启动”代替真实边界。建议沿现有报告格式加以下字段，不新建复杂管理系统：

```text
SOURCE_REPO / BRANCH / HEAD / TREE
BUILD_ARTIFACT_SHA256 / APPLICATION_ID / INSTALLED_BUILD_IDENTITY
RUNTIME_DEVICE / AUDIO_ROUTE / PERMISSION_STATE
CREDENTIAL_PUBLIC_SOURCE / CREDENTIAL_PUBLIC_REASON
ASR_PROVIDER / ASR_MODEL / TTS_PROVIDER / TTS_MODEL / VOICE_ID
MODEL_CATALOG_SOURCE / VOICE_CATALOG_SOURCE
SESSION_CREATED / SESSION_UPDATED / AUDIO_BYTES_SENT / COMMIT_SENT / COMMIT_ACK
TRANSCRIPTION_COMPLETED / FINAL_ACCEPTED / CHAT_HANDOFF_COUNT
RESPONSE_CREATE_COUNT / UNEXPECTED_VENDOR_OUTPUT_DROPPED
LLM_STARTED / LLM_COMPLETED / TTS_STARTED / AUDIO_PLAYBACK_DRAINED
FIRST_FAILED_BOUNDARY
NEW_PROVIDER_CALL_COUNTS / RETRY_COUNT / PAYG_FALLBACK_COUNT
USER_CONFIG_MUTATION / INSTALLATION_CHANGED
```

生产默认记录内容无关的阶段/计数/耗时；诊断 transcript 只在必要、明确有界的测试中输出。不要 dump 全部聊天、原始帧、PCM、Base64、HTTP body、header 或 Key。日志缺字段时应报告未观察，不能从“按钮点了一下”推 exact call count。[S01，§18/25/26][E03][E06]

一旦观察到第一失败边界就修那个层次：转写没到chat就不同时开启TTS debug；GUI失窗未连接就不说Provider失败；HTTP400没有错误码就不声称知道根因。真实失败可以补修/补验，但不为某种指定截图形式重复已有充分证明。[E07][E09][E11]

---

## 16. 本次已关闭与未包含范围

### 已关闭（macOS 该阶段）

Token Plan 共享凭据、TTS与当前声线、动态TTS model交集、599声线快照/source分离、Route B realtime-plus transcript-only、真实mic转写、final→chat一次交接、AIRI回复、TTS可听、最终日常部署。[E01][E02]

### 不能自动宣称完成

Android 当前repo任何实现；所有声线逐项可用；CosyVoice/longfeifei_v2；账号自定义音色管理；Token Plan Flash HTTP ASR；任意未来model动态兼容；全设备/长时/后台/AEC/蓝牙/打断稳定性；商业应用条款判断；所有计费账单复核；PR15 merge/Ready。[E01–E12]

关于权限使用：Owner 在本对话反馈已向阿里云客服咨询，得到“个人项目并没有关于这个权限使用的具体规定”的答复，并据此选择继续路线B。这是 **用户反馈与产品决策证据**，不是可替所有商业用户作出的正式许可结论。早期助手/笔记对公开文档的判断多次摇摆；Android agent 不应重新把未核实的绝对禁止当事实，也不能把客服反馈升级为永久/无限使用保证。确需商业化时单独核对适用条款，不在当前个人项目移植中偷偷切换按量路线。[E10][S01]

---

## 17. 给 Android agent 的最短执行摘要

> 先读本文件与 source_manifest.json。macOS 可用协议已固定，不要重做HTTP Flash猜测和旧probe链。检查你自己的Android仓库和现有计划，将 Token Plan shared credential、native TTS task WebSocket、realtime-plus transcript-only WebSocket、model动态交集/voice静态快照、final-once聊天交接映射到当前架构。保持原角色/记忆/工具/LLM，不发response.create，不静默fallback至Workspace/PAYG。处理Android原生凭据、PCM采集/播放、权限和生命周期；先synthetic集成测试，再一次有界真实设备E2E。只有发现实际平台差异才新增窄任务，不为复现macOS探索过程制造任务。不要改macOS已验收包、不要导出Mac凭据、不要假定本文件知道你的Android当前进度。

更完整的可复制交接提示词见 `ANDROID_AGENT_START_HERE.md`。

---

## 18. 源码阅读顺序与来源

建议阅读顺序：S04 → S02/S03 → S05/S06/S07 → S08/S09/S10 → S11/S12/S13 → S01 的对应历史章节。`source_manifest.json` 给出冻结commit、已取得的blob SHA及本次阅读范围。

下列源文件链接均固定到 `7ef071c791483aa362872e473cea676d2f248fa9`；并非浮动分支。对于仅从diff/工程笔记定位的文件，manifest已注明，没有伪称逐行审完整仓库。

- **[S01] 工程笔记（包含多处历史状态，须按正文说明判读）**：[docs/project-notes/qwen-audio-realtime-voice-integration.md](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/docs/project-notes/qwen-audio-realtime-voice-integration.md)；本次读取等级 `selected_sections_read`。
- **[S02] Token Plan TTS 原生 WS 协议、参数、音频帧判定**：[apps/stage-tamagotchi/src/main/services/airi/qwen-audio-tts-token-plan/protocol.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/apps/stage-tamagotchi/src/main/services/airi/qwen-audio-tts-token-plan/protocol.ts)；本次读取等级 `protocol_definitions_and_parser_read`。
- **[S03] Token Plan StageTtsSession 与本地播放 drain**：[packages/stage-ui/src/libs/speech/qwen-audio-tts-token-plan-stage-session.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/packages/stage-ui/src/libs/speech/qwen-audio-tts-token-plan-stage-session.ts)；本次读取等级 `lines_1_250_read`。
- **[S04] Token Plan secure credential store / 诊断 / 环境回退**：[apps/stage-tamagotchi/src/main/services/airi/qwen-audio-tts-token-plan-credentials/store.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/apps/stage-tamagotchi/src/main/services/airi/qwen-audio-tts-token-plan-credentials/store.ts)；本次读取等级 `full_read`。
- **[S05] 账号 model-list 请求与兼容性过滤**：[apps/stage-tamagotchi/src/main/services/airi/qwen-audio-tts-token-plan-models-probe/index.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/apps/stage-tamagotchi/src/main/services/airi/qwen-audio-tts-token-plan-models-probe/index.ts)；本次读取等级 `lines_1_240_read`。
- **[S06] 1 个 bundled model、599 voice 快照及动态模型交集**：[packages/stage-ui/src/libs/providers/qwen-audio-tts-token-plan-catalog.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/packages/stage-ui/src/libs/providers/qwen-audio-tts-token-plan-catalog.ts)；本次读取等级 `header_and_mapping_functions_read; voice_count_from_accepted_reports`。
- **[S07] TTS 设置页、搜索、浏览/选择、model/voice 来源分离**：[packages/stage-pages/src/pages/settings/providers/speech/qwen-audio-tts-token-plan.vue](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/packages/stage-pages/src/pages/settings/providers/speech/qwen-audio-tts-token-plan.vue)；本次读取等级 `lines_1_250_read`。
- **[S08] Realtime-plus 共用事件 parser、WAV parser、请求构造**：[apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime-plus-token-plan-transcript-probe/protocol.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime-plus-token-plan-transcript-probe/protocol.ts)；本次读取等级 `full_read`。
- **[S09] 生产 Token Plan realtime-plus ASR main service**：[apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime-token-plan/index.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/apps/stage-tamagotchi/src/main/services/airi/qwen-audio-realtime-token-plan/index.ts)；本次读取等级 `full_read`。
- **[S10] 生产 ASR renderer provider、SSE 内部桥接、平台 gate**：[packages/stage-ui/src/libs/providers/providers/qwen-audio-realtime-token-plan/index.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/packages/stage-ui/src/libs/providers/providers/qwen-audio-realtime-token-plan/index.ts)；本次读取等级 `full_read`。
- **[S11] final transcript 消费器**：[packages/stage-ui/src/libs/providers/stream-transcription/final-transcript-consumer.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/packages/stage-ui/src/libs/providers/stream-transcription/final-transcript-consumer.ts)；本次读取等级 `full_added_file_read_in_commit_diff`。
- **[S12] final transcript 消费器测试**：[packages/stage-ui/src/libs/providers/stream-transcription/final-transcript-consumer.test.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/packages/stage-ui/src/libs/providers/stream-transcription/final-transcript-consumer.test.ts)；本次读取等级 `full_added_file_read_in_commit_diff`。
- **[S13] Hearing 消费器与最终交接调用点**：[packages/stage-ui/src/stores/modules/hearing.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/packages/stage-ui/src/stores/modules/hearing.ts)；本次读取等级 `relevant_final_commit_diff_read`。
- **[S14] 渲染端 chat ingress 契约测试**：[apps/stage-tamagotchi/src/renderer/pages/index.telemetry.test.ts](https://github.com/DeadfishShin/airi/blob/7ef071c791483aa362872e473cea676d2f248fa9/apps/stage-tamagotchi/src/renderer/pages/index.telemetry.test.ts)；本次读取等级 `relevant_final_commit_diff_read`。

### 18.1 对话证据索引

- **[E01]** 最终部署 `AIRI_MACOS_TOKEN_PLAN_REALTIME_PLUS_ACCEPTED_CANDIDATE_DAILY_DEPLOYMENT_V1` 完整 CODEX_REPORT：source 7ef071c7、daily asar 771348…a20a、backup、配置保持、startup smoke PASS、无新增ASR/TTS/生成、PR仍Draft/Unmerged。
- **[E02]** Owner `OWNER_RUNTIME_RESULT`：exact repaired candidate；user message count=1；AIRI reply=true；TTS playback=true；microphone stopped=true；无错误、无ASR/TTS设置更改。后续部署报告保留该结果。
- **[E03]** `AIRI_MACOS_TOKEN_PLAN_REALTIME_PLUS_MAIN_PROCESS_ONE_SHOT_LIVE_EXECUTION_V1`：run-id `b25ff3c9-8fa1-4355-81d7-7096cf33daf5`；1 WS、30 chunks、29984 bytes、1 commit、ack/user item匹配、2合法delta、completed=true、response.create=0；文本 `Irie probe.`，预期 `AIRI probe`，这是短fixture的可理解发音变体，不是ASR准确率基准。
- **[E04]** `...ACCOUNT_CATALOG_DISCOVERY_V1` 的0请求blocked、`...SAFE_MAIN_PROCESS_MODELS_PROBE_PATH_V1`、`...OWNER_AUTHORIZED_ONE_SHOT_MODELS_PROBE_R1`：无请求不得称接口失败；真实一次HTTP200、15模型、当前兼容TTS1个。
- **[E05]** TTS目录/刷新/ownership系列、`...DYNAMIC_MODEL_SOURCE_RUNTIME_ACCEPTANCE_V1`、`...MODEL_VOICE_SOURCE_LABEL_SEPARATION_FIX_V1` 和 recheck：599快照、来源污染实际复现与修复、model/voice选择保持。
- **[E06]** `...ASR_FLASH_ONE_SHOT_LIVE_PROBE_V2`：唯一Flash HTTP假设返回400；Provider code/message未被UI暴露；无重试、无回退、能力UNPROVEN。
- **[E07]** `...TRANSCRIPT_ONLY_LIVE_REPROBE_V2`、`...TRANSCRIPTION_EVENT_PARSER_REPAIR_V1`、`...COMMIT_ACK_AND_LIVE_REPROBE_V3`：delta字段和committed ack两个客户端parser漏项；后续GUI阻塞不等于新Provider失败。
- **[E08]** `...ASR_PROTOCOL_AND_PIPELINE_COMPATIBILITY_DISCOVERY_V1`：AIRI原采集、VAD、PCM与30秒本地buffer ceiling映射；旧Workspace路径非Token Plan证据。
- **[E09]** ASR visibility/credential preflight/authority repair和main runner系列：双out、错误root package identity、userData绑定、daily冲突、GUI失窗、headless one-shot诊断与结果artifact。
- **[E10]** Owner 明确选择 `TOKEN_PLAN_ROUTE_B`；Owner关于客服回复、普通工程无需逐项授权的最新指示。不是另一份Android仓库授权或商业条款证明。
- **[E11]** `...PRODUCTION_ASR_OWNER_MIC_CHECKPOINT_PREP_V1` 的初步真人结果与 `...POST_MIC_CHAT_TTS_E2E_DIAGNOSTIC_V1`：4条只在Hearing可见，Chat为0；不重复mic后定位CHAT_SEND_NOT_TRIGGERED。
- **[E12]** `...COMPLETED_TRANSCRIPT_CHAT_HANDOFF_REPAIR_V1`：7ef071c7最终修复，helper/source-contract tests与新candidate；后续真正E2E见E02。

以上 E 编号指向本次用户提供的完整对话记录，不是伪造的仓库文件/远端日志链接。交接时本文件已提取足够的结论与关键字段，不要求 Android agent 再重读整段聊天。

### 18.2 额外官方平台参考（仅支撑移植建议）

- [A01] Android Keystore：<https://developer.android.com/privacy-and-security/keystore>。本次核对其保护加密密钥、应用私有访问与使用边界；不据此宣称API Bearer不会进入内存。
- [A02] AudioRecord：<https://developer.android.com/reference/android/media/AudioRecord>。供目标agent映射原生PCM采集。
- [A03] AudioTrack：<https://developer.android.com/reference/android/media/AudioTrack>。供目标agent映射流式PCM播放与排空。
- [A04] Microphone权限说明：<https://developer.android.com/media/platform/mediarecorder>。支撑RECORD_AUDIO运行时权限说明，不要求改用MediaRecorder作为PCM实现。
- [A05] Foreground service types：<https://developer.android.com/develop/background-work/services/fgs/service-types>。后台麦克风行为应按目标SDK/设备核对；本次不扩大为后台监听实现。
- [W01] Qwen-Audio Realtime server events：<https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-server-events>。协议事件族辅助来源；本次成功请求的实际参数以冻结源码和E03为准。

公开页面会更新，后续若官方变化，与冻结实现对比记录差异即可；不要把新页面覆盖已发生的历史运行事实，也不要把本次可用当所有未来版本保证。