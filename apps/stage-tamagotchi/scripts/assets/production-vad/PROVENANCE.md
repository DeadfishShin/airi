# Production VAD model provenance

| Field | Value |
| --- | --- |
| `MODEL_ID` | `onnx-community/silero-vad` |
| `UPSTREAM_REVISION` | `ddc9a7e80d6758f6fc795a1e8a04b798eb929d3a` |
| `UPSTREAM_FILE` | `onnx/model.onnx` |
| `SHA256` | `a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808` |
| `SIZE_BYTES` | `2243022` |
| `LICENSE` | `MIT` |
| `ACQUIRED_FROM` | `https://huggingface.co/onnx-community/silero-vad/resolve/ddc9a7e80d6758f6fc795a1e8a04b798eb929d3a/onnx/model.onnx` |
| `TRANSFORMERS_VERSION` | `@huggingface/transformers@3.8.1` |
| `PRODUCTION_DTYPE` | `fp32` |
| `RESOLVED_MODEL_FILE` | `onnx/model.onnx` |

The model artifact is vendored for the AIRI production-aligned local
diagnostics/offline-load proof. It is not a claim that the current duplex
smoke phases have already been re-wired to the production detector.

The public upstream `main` revision was independently checked at the time of
acquisition and reported the same artifact hash and size. The immutable
revision above remains the authority used by AIRI source and tests.
