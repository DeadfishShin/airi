# AIRI Live2D Compatibility: macOS → Android Handoff

## Scope and authority

~~~text
PROJECT=DeadfishShin/airi
MACOS_SOURCE_PR=15
MACOS_SOURCE_HEAD=7382e49bec4db8308eb3099c1349b167fca7765c
MACOS_SOURCE_TREE=69d12a49c9ae63a9cfad41c839001a29bca9a1c1
COMPATIBILITY_BRANCH=codex/macos-live2d-generic-compatibility-v1
~~~

This document is the Android reference for the Live2D compatibility work. The
macOS source is a reference implementation, not an Android source tree. Android
must first audit its own renderer, audio, lifecycle, storage, and conversation
code before choosing integration points.

~~~text
PROJECT_TYPE=PERSONAL_PROJECT
ANDROID_GOAL=复用 macOS Live2D 兼容经验，尽快完成 Android 端可靠实现
PRIORITY=functionality + stability + maintainability
COMMERCIAL_GRADE_SECURITY_ARCHITECTURE=NOT_REQUIRED
OVERENGINEERING=AVOID
~~~

Do not turn this handoff into a generic renderer rewrite, a new provider
framework, or an enterprise asset/security project.

## Problem

Third-party Cubism models do not necessarily use AIRI's default parameter IDs
or motion-group conventions. A model may load successfully while gaze, blink,
lip sync, body control, or idle motion silently does nothing.

The confirmed legacy shape is:

- Cubism model version 3;
- all motions under the empty group "";
- no Idle group;
- a clear wait motion such as motions/00_Wait_01.motion3.json;
- legacy IDs such as PARAM_EYE_BALL_X and PARAM_MOUTH_OPEN_Y;
- EyeBlink and LipSync groups declaring the real parameter IDs.

The compatibility layer adapts the model at runtime. It does not rewrite the
user's ZIP, .moc3, motion files, or physics files.

## Exact Cubism runtime surface

The installed macOS dependency is `pixi-live2d-display` 0.4.0. Its
`CubismModel` wrapper exposes the underlying Cubism core model through
`coreModel.getModel()`. The production parameter table is:

~~~text
coreModel
→ getModel()
→ parameters.count
→ parameters.ids
~~~

The resolver bounds iteration by `count`, keeps only non-empty strings, and
removes duplicates. It does not probe by writing unknown IDs. Do not assume
that every SDK has `getParameterIds()` or `getParameterId(index)`; those are
only compatibility/test adapters here, not the production authority.

## Model cache identity

A cached model payload must be bound to its actual source or revision. A
logical model ID alone is not sufficient cache identity: imported models may
reuse an ID while their blob source changes. The macOS OPFS cache therefore
requires a current schema and an exact recorded source URL for every hit,
including `blob:` URLs; missing source metadata and older schemas are misses
and are rebuilt from the current payload. Stale asynchronous loads must not
poison the cache for a newer source. Android should apply the same invariant
with its own persistence layer rather than copying OPFS or Electron details.

## Production flow

The platform-neutral flow is:

~~~text
pointer / touch input
→ AIRI's existing focus source and Live2DModel.focus()
→ pixi-live2d-display toModelPosition/focusController geometry
→ compatibility-bound Cubism focus targets
→ logical eyeBallX / eyeBallY
→ resolved physical parameter ID

microphone / local VAD
→ speech segment / endpointing
→ realtime ASR
→ AIRI canonical conversation pipeline
→ persona / memory / tools
→ generation provider
→ conversational TTS queue
→ realtime TTS
→ speaker playback
~~~

During assistant playback, local VAD remains active. A valid new speech
segment cancels the old generation/TTS work, invalidates the old session/token,
starts the new turn, and suppresses stale output. Keep a quiet tail and make
consecutive interruptions safe.

## Logical parameter compatibility

The upper layers use logical names, never model-specific IDs:

| AIRI logical capability | Modern ID | Legacy example |
| --- | --- | --- |
| angleX/Y/Z | ParamAngleX/Y/Z | PARAM_ANGLE_X/Y/Z |
| bodyAngleX/Y/Z | ParamBodyAngleX/Y/Z | PARAM_BODY_ANGLE_X/Y/Z |
| eyeBallX/Y | ParamEyeBallX/Y | PARAM_EYE_BALL_X/Y |
| eyeLeftOpen/rightOpen | ParamEyeLOpen/ROpen | PARAM_EYE_L_OPEN/R_OPEN |
| mouthOpen | ParamMouthOpenY | PARAM_MOUTH_OPEN_Y |
| mouthForm | ParamMouthForm | model-dependent |
| breath | ParamBreath | PARAM_BREATH |

Resolution order:

1. discover IDs from the live Cubism core model;
2. use model-declared semantic metadata when available;
3. try known aliases only when the alias actually exists;
4. mark the capability unsupported when no physical ID exists.

Do not mechanically transform ParamFoo into PARAM_FOO. A missing parameter is
a degraded capability, not a model-load failure.

EyeBlink metadata should identify the left/right open parameters. LipSync
metadata should identify the mouth parameter. If a group declares several
possible IDs, resolve by semantic side/name and actual existence; do not blindly
write to an arbitrary absent ID.

## Motion normalization

Normalize motion groups and files into candidates for AIRI semantic motions:

~~~text
Idle / idle / IDLE       → idle
wait / standby / normal  → idle candidate
Happy                    → happy
Anger / Angry            → angry
Sad                      → sad
Surprise                 → surprise
Awkward                  → awkward
Puzzle / Doubt           → low-confidence think candidate
~~~

The empty group is valid. A filename such as 00_Wait_01.motion3.json is a
high-confidence idle candidate even when its group is empty. If there is no
high-confidence candidate, leave idle unresolved and keep the existing manual
motion selection path. Never select the first Anger/Cry motion as idle merely
because it exists.

When a semantic name resolves to a candidate, the candidate's exact physical
group and index are authoritative. A caller-supplied index is only honored for
a direct physical group request; it must not turn a resolved Happy candidate
into the first Anger motion. A non-standard idle candidate owns its own
lifecycle: a finite Wait/Standby motion is restarted with the same group and
index after completion, while a looping motion is left alone and does not
create a restart storm. The canonical `Idle` group remains owned by the SDK.

Semantic emotion motions are transient actions. An asset's `Loop=true` flag is
not permission for a Happy/Angry/Sad/Surprise action to own the model forever:
the runtime takes a temporary one-shot loop lease, then restores the author's
loop flag after completion, cancellation, or replacement. Completion hands off
to the exact resolved idle candidate (for example `""[14]` Wait), never to a
random member of a mixed source group. A newer semantic action invalidates the
older completion, so a late callback cannot interrupt the newer owner. Direct
physical/runtime-picker playback keeps its original user/asset loop policy.

Never promote a mixed source group such as `""` to the SDK Idle group. Idle
eye-curve suppression is applied only to the resolved idle motion object, so
sibling Happy/Angry/Sad/Surprise motions retain their authored eye curves.
Manual runtime motion selection remains higher priority, and disabling idle
animation prevents automatic restarts.

Semantic mappings are candidates, not facts. Opaque filenames remain
unresolved. Existing runtime motion selection and persistence remain the
override path: `settings/live2d/current-motion` and the selected runtime motion
keys remain unchanged. `settings/live2d/motion-map` is now a model-scoped map:

Expression clips can be listed beside body motions and may contain words such
as `Sad` or `Anger`. Treat those filename matches as lower-confidence than a
matching authored body motion, so an expression clip does not replace the
model's actual semantic action candidate.

~~~text
modelId → motion filename → semantic motion
~~~

The renderer resolves only the requested model's bucket. A missing model ID
resolves to no manual overrides, so another model's mapping is never reused as
fact. A legacy flat map is migrated once only when the renderer supplies an
explicit current model ID; after that all reads are model-scoped. Manual
overrides take precedence over group and filename heuristics, and the same
filename can map independently for two model IDs.

This is a small storage-shape migration, not a second persistence framework.

## Model compatibility profile

The macOS resolver produces a small profile containing:

~~~text
parameterMap
  angleX, angleY, angleZ
  bodyAngleX, bodyAngleY, bodyAngleZ
  eyeBallX, eyeBallY
  eyeLeftOpen, eyeRightOpen
  mouthOpen, mouthForm, breath

motionMap
  idle, happy, sad, angry, think
  surprise, awkward, question, curious

capabilities
  gazeTracking, blinking, lipSync
  headMotion, bodyMotion, breath
~~~

Upper-level plugins call this profile. They do not need to know whether the
model is modern or legacy. Physics remains model-native and continues through
the Cubism runtime; this layer does not reimplement physics.

## Pointer focus ownership

The pointer path deliberately calls `Live2DModel.focus(x, y)` exactly once and
does not re-derive normalized coordinates from `model.x`, `model.y`, width, or
height. The compatibility layer binds the resolved physical IDs to
`Cubism4InternalModel.idParamEyeBallX/Y` (and corresponding head/body focus
targets) so the existing `focusController` state is written by the SDK's
normal `updateFocus()` stage. This keeps scale, offset, model movement, and
render scale in one geometry chain and avoids idle focus competing with active
pointer focus.

## Qwen and voice lessons relevant to Android

The accepted macOS speech authority is:

~~~text
ASR provider = qwen-audio-realtime-transcription
ASR model    = qwen-audio-3.0-asr-flash-streaming
TTS provider = qwen3-tts-realtime
TTS model    = qwen3-tts-flash-realtime
validated voice = Serena
~~~

For Android, use one shared Qwen PAYG profile for ASR and TTS, native secure
storage, public readiness state, and runtime-only credential resolution. Do not
store a secret long-term in ordinary SharedPreferences or a normal config
file. Do not copy Electron safeStorage APIs literally.

Provider voice ID is not the same thing as display label. The value sent to a
provider must be the provider ID, not a translated or human-readable label.
Serena has passed real macOS runtime validation.

## Barge-in invariants

Keep these invariants independent of Pixi or Electron:

- microphone/VAD stays active while the assistant speaks;
- a valid speech onset cancels the old generation and TTS;
- session/token identity invalidates old work;
- stale audio after cancellation or completion is discarded;
- only one current conversational output is eligible for playback;
- the quiet tail prevents immediate re-trigger loops.

## Do not port literally

DO_NOT_PORT_LITERALLY:

- macOS TCC and launch attribution;
- LaunchServices /usr/bin/open -n;
- Electron safeStorage;
- Electron IPC/Eventa plumbing;
- APP_USER_DATA_PATH test profiles;
- macOS bundle IDs and CDHashes;
- macOS speaker/output implementation details;
- the temporary owner-sync diagnostic seam unless Android tests genuinely need
  an equivalent synchronization point;
- Vue, Pinia, Pixi-specific component wiring;
- browser localStorage as an Android persistence implementation.

Port the architecture, lifecycle, invariants, capability degradation, and
failure lessons. Bind them to Android's renderer, pointer/touch source,
persistence, audio lifecycle, and cancellation primitives.

## Android implementation order

| Step | Goal | macOS reference | Android acceptance signal |
| --- | --- | --- | --- |
| A1 | Audit existing capture, VAD, AIRI chat, TTS, storage, and cancellation | Model.vue, stage conversation/audio owners | Current Android ownership map exists before edits |
| A2 | Add shared Qwen PAYG configuration | Qwen secure profile and public readiness contract | One profile is visible to ASR and TTS without secret leakage |
| A3 | Implement realtime Qwen ASR adapter | ASR provider/model adapter and segment lifecycle | One segment has start/partial/final/error/finish ownership |
| A4 | Implement Qwen3 realtime TTS and catalog | TTS adapter, model catalog, voice ID catalog | Serena/provider ID is selected and audio deltas are lifecycle-owned |
| A5 | Bind Android VAD → ASR → AIRI → TTS | canonical Stage flow | A real user turn reaches existing conversation and returns to TTS |
| A6 | Add barge-in and stale-output cancellation | session/token invalidation and playback queue | Repeated interruptions do not play old audio |
| A7 | Run real-device full-chain acceptance | Owner macOS runtime evidence | Owner hears one complete response and can interrupt it |

Android must audit its own repository first. Do not cherry-pick the macOS
branch wholesale.

## Compact macOS source map

| Capability | PR15 / compatibility source | Android concept |
| --- | --- | --- |
| Logical parameter, runtime discovery, focus binding, and motion resolver | packages/stage-ui-live2d/src/utils/live2d-compatibility.ts | Runtime model profile |
| Compatibility tests and synthetic fixtures | packages/stage-ui-live2d/src/utils/live2d-compatibility.test.ts | Real-runtime-shape/modern/legacy/partial/ambiguous test fixtures |
| Parameter application and model lifecycle | packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue | Renderer model binder |
| Motion plugins, blink, lip sync, breath, beat sync, exact idle ownership | packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts | Frame/update control layer |
| Idle eye focus and pointer-compatible gaze | packages/stage-ui-live2d/src/composables/live2d/animation.ts and eye-tracking.ts | Touch/pointer focus adapter |
| Motion selection persistence | packages/stage-ui-live2d/src/stores/model-parameters.ts and packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue | Model-identity mapping storage/UI |
| Archive/model validation | packages/stage-ui-live2d/src/utils/live2d-validator.ts and live2d-zip-loader.ts | Android import validation |
| Existing expression semantics | packages/stage-ui-live2d/src/composables/live2d/expression-controller.ts | Preserve existing expression ownership |
| Source-bound OPFS model cache | packages/stage-ui-live2d/src/utils/opfs-loader.ts and opfs-loader.test.ts | Bind cached payloads to source/revision; invalidate stale entries |

## Synthetic fixtures and tests

Use metadata-only fixtures; do not commit Aqua files. The minimum fixture set
is:

1. modern IDs and an Idle group;
2. legacy PARAM_* IDs, EyeBlink, LipSync, and empty-group
   00_Wait_01/emotion motions;
3. a partial model without eye-ball or breath parameters;
4. an opaque-motion model with no defensible idle candidate.

The resolver tests must assert parameter IDs, capability flags, motion
confidence, empty-group/index selection, semantic-index ownership, direct
physical-index behavior, exact finite-idle restart decisions, mixed-group eye
ownership, safe unsupported writes, manual override precedence, and the actual
runtime-shaped `getModel().parameters` fixture. The runtime-shaped fixture intentionally has no
`getParameterIds()`/`getParameterId()` helpers. Add a two-model same-filename
mapping test whenever the mapping contract is ported.

## Failure lessons

1. A packaged identity and a development identity can have different
   permissions and profiles.
2. Mixing forced test userData with normal userData creates false persistence
   failures.
3. A live microphone track does not imply a VAD-positive speech segment.
4. An observer missing an event is not proof that the product did not run.
5. Provider voice IDs and display names must stay separate.
6. Credential readiness and provider configuration are separate public states.
7. Cancelled TTS sessions must suppress stale output.
8. Diagnostic harnesses must not become production dependencies.
9. Full-chain acceptance must include real-device audibility and interruption,
   not only provider lifecycle telemetry.
10. Synthetic mocks that expose convenient SDK methods can give false
    confidence; fixtures must match the installed runtime object shape.
11. Semantic emotion playback must be one-shot even when third-party motion
    metadata says `Loop=true`; returning to idle must use the exact resolved
    candidate rather than randomizing a mixed source group.
12. A stale motion completion must not reclaim ownership from a newer motion.

## Evidence and known limits

Source and synthetic package tests cover modern, legacy, partial, and
ambiguous models. The Owner's earlier macOS runtime acceptance covered real
microphone speech, Qwen ASR, AIRI generation, DeepSeek V4 Flash, Serena
playback, and barge-in. An instrumented observer previously produced a
false-negative speech observation; it must not override Owner product evidence.

The current PR15 candidate has completed Owner validation on the original,
unmodified Aqua runtime for persistence/reload, idle/wait stability, semantic
Happy/Angry/Sad/Surprise playback, Angry-to-Wait face release, physics,
hand/chest reference matching, and idle-gaze ownership. The checklist below is
retained as a reusable Android-port validation guide rather than an open PR15
gate:

~~~text
OWNER_RUNTIME_REQUIRED=COMPLETED_CURRENT_PR15_OWNER_VALIDATION
~~~

Shortest validation:

1. Build/run the candidate from this branch.
2. Import the original Aqua ZIP without editing it.
3. Confirm idle motion starts without manual ZIP repair.
4. Move the pointer and confirm legacy eye-ball tracking.
5. Trigger conversational TTS and confirm mouth movement.
6. Trigger Happy, Angry, Sad, and Surprise semantics.
7. Confirm physics/hair/clothing behavior remains intact.

Known limitations:

- a missing parameter cannot be invented;
- a missing motion cannot be generated by mapping;
- opaque motion filenames cannot be reliably assigned an emotion;
- low-confidence mappings must remain manually correctable;
- physics stays model-native;
- a model without eye-ball parameters cannot gain gaze tracking; it is marked
  unsupported while other capabilities continue;
- automated focus tests cover canonical focus ownership and source
  render-scale/offset mapping, but not a full GPU visual assertion;
- visual quality and physics preservation cannot be truthfully marked PASS by
  automated source tests alone.

## Async model-load ownership

Model loading is asynchronous. Every load request receives a generation and
captures the requested model identity. A loaded result may attach only when its
generation, model source/id, component, PIXI application, and stage are still
current. A late result after model replacement or unmount is discarded and its
newly-created model is destroyed. The latest model selection is authoritative;
stale completions must never attach, install listeners, or reclaim the stage.

Android should preserve this lifecycle invariant with its own coroutine/job or
generation mechanism rather than copying Vue, Pixi, or Electron plumbing.
Every terminal stale, invalid-target, error, or successful path must also
release the loading latch; a late result must not leave the model loader
permanently waiting.

The renderer-facing model identity is a single resolved ownership unit: the
model ID and its resolved source must be committed together after source
resolution. A requested selection must not be exposed as the active render
identity before its source is ready, and a superseded asynchronous load failure
must not surface as the current user-visible render error. Durable selection
state remains separate from this resolved runtime pair.

## Motion curve traversal compatibility

Third-party `motion3.json` assets can contain noncontiguous target sections.
An implementation that assumes contiguous `Model`, `Parameter`, and
`PartOpacity` sections can silently skip valid authored curves. Android must
audit its Cubism motion traversal and either visit every curve by target type
or apply an equivalent generic compatibility repair. Do not rewrite
third-party motion assets merely to satisfy a runtime ordering assumption.
