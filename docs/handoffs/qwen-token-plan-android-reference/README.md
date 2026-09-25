# Android agent：开始前读取

请完整阅读同包的 `QWEN_TOKEN_PLAN_ANDROID_IMPLEMENTATION_HANDOFF.md`，再读取 `source_manifest.json`。`protocol_examples.synthetic.json` 是可转成测试的**合成协议样例**，不是真实Provider抓包，也不包含真实音频或凭据。

## 任务定位

这是将 macOS 已验收的 Qwen Token Plan 模块经验迁移到 Android 的参考，不是恢复 macOS Controller，也不是要求你继续操作 macOS PR15。请先确认你自己的Android仓库、分支、现有开发计划和实际实现；不要根据任何历史“Android未开始”的文字猜当前状态。

macOS读取基准：

```text
repo=DeadfishShin/airi
ref=7ef071c791483aa362872e473cea676d2f248fa9
tree=1904fbfc5e0ddf4ee9fab5fcf4dbd05fa45914c9
PR15在最终报告时仍OPEN/DRAFT/UNMERGED
```

Owner已在exact candidate完成一次real-mic E2E：用户消息1条、AIRI回复正常、Token Plan TTS正常可听、停止监听正常；该candidate已部署到macOS日常App。不要再让Owner为这条macOS链路重复测试。

## 必须保留的产品方向

用户已选择Token Plan路线B：

```text
Android真实麦克风/本地VAD
→ PCM16 LE mono 16kHz
→ Token Plan realtime-plus /api-ws/v1/realtime
→ manual session、append、commit、completed transcript
→ 不发送response.create，不用vendor回答/音频/工具
→ Android App原有角色/历史/记忆/工具/LLM链
→ Token Plan TTS /api-ws/v1/inference
→ qwen-audio-3.0-tts-plus / longanlingxin
→ PCM16 LE mono 24kHz正常播放与drain
```

TTS模型目录是Token Plan GET /compatible-mode/v1/models返回与本地兼容表的交集。当前只实现qwen-audio-3.0-tts-plus兼容性。599音色仍是随包官方快照，绝不是动态账号音色，modelSource和voiceSource必须独立。

ASR/TTS共用一份Token Plan安全凭据，不新建第二ASR Key，不静默切Workspace/PAYG。Mac safeStorage密文和daily profile不可复制到Android；Android首次配置须走自身正常安全入口。

## 不要重走的弯路

- 不重试已结束的qwen-audio-3.0-asr-flash + chat/completions HTTP400假设。
- 不把input_audio_transcription.delta写成event.delta：用text/stash。
- 不把input_audio_buffer.committed或匹配的user conversation.item.created当错误。
- 不把WS text Buffer当PCM，不把raw PCM当WAV/MP3。
- 不把task-finished当播放结束；保留本地drain。
- 不把Hearing页面显示转写当Chat E2E已通过；isFinal必须及时交接一次，不能等teardown。
- 不把旧文档HOLD/pending、单个voice历史文字当最终状态；主交接已标明冲突。
- 不把isAvailable的darwin/Electron gate照搬进Android。
- 不因GUI自动化失窗无限调导航；使用现有合适的受控测试入口，但真正E2E走产品路径。

## 工作方式

先给出Android现有模块与主交接职责的精确映射，再沿当前项目单任务协议推进最小实现。复用既有网络/安全存储/语音/聊天框架，不新建第二套管理体系。无需重新批准普通工程实现、测试或受控内部机制；真实凭据录入、系统权限、真人发声和重大路线变更按Owner/Controller既有边界处理。

优先synthetic transport、audio、final-handoff集成测试，然后仅做必要的Android真实设备验收。不要把macOS协议已证明扩大成Android已验收；也不要重新探索已证明的网络协议。任何新发现明确标记为Android事实或移植建议，不能伪写成macOS既有结论。

主交接§12列出当前macOS源码比报告承诺更宽松的细节，尤其correlation、generic complete()、语言选项和日志范围，请先阅读，不能照着更强的报告用语跳过测试。