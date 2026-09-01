# 项目工程笔记

这里记录 AIRI 当前 Qwen Audio 实时语音实验的可复用工程事实、决策、事故和后续工作。

主文档：[Qwen Audio 实时语音集成工程笔记](./qwen-audio-realtime-voice-integration.md)

范围：macOS-first 的 Electron AIRI 实验路线。本文档不替代上游产品文档，也不代表 Android 已接入。

当前状态摘要：

| 能力 | 状态 |
| --- | --- |
| Qwen streaming ASR macOS | PASS |
| Qwen PAYG realtime TTS | PASS |
| Qwen PAYG LLM→TTS overlap | PASS |
| Token Plan native WS TTS | PASS |
| Token Plan real audible runtime | PASS |
| Token Plan real LLM→TTS overlap | PASS |
| Token Plan model catalog UI | PASS |
| Full ASR→LLM→TTS voice E2E | PENDING |
| Barge-in | PENDING |
| AEC | PENDING |
| Android | NOT STARTED |

阅读主文档时，请注意每项结论旁的证据级别：

- `SOURCE_PROVEN`：当前源码、测试或提交直接证明。
- `REAL_RUNTIME_PROVEN`：Owner 在真实 AIRI runtime 中观察到并记录。
- `PROBE_PROVEN`：有界的真实协议/entitlement probe 证明。
- `OFFICIAL_DOC_SUPPORTED`：当前 Alibaba 官方文档支持。
- `CURRENT_DESIGN_DECISION`：本项目明确选择的架构规则。
- `OPEN` / `NOT_YET_PROVEN`：尚未证明或尚未完成；不等于不支持。
