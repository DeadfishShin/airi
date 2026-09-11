export type Live2DLogicalParameter
  = | 'angleX'
    | 'angleY'
    | 'angleZ'
    | 'bodyAngleX'
    | 'bodyAngleY'
    | 'bodyAngleZ'
    | 'eyeBallX'
    | 'eyeBallY'
    | 'eyeLeftOpen'
    | 'eyeRightOpen'
    | 'mouthOpen'
    | 'mouthForm'
    | 'breath'

export type Live2DSemanticMotion
  = | 'idle'
    | 'happy'
    | 'sad'
    | 'angry'
    | 'think'
    | 'surprise'
    | 'awkward'
    | 'question'
    | 'curious'

export type Live2DMotionConfidence = 'high' | 'medium' | 'low'

export interface Live2DMotionCandidate {
  group: string
  index: number
  fileName: string
  confidence: Live2DMotionConfidence
  reason: string
}

export interface Live2DMotionRequest extends Live2DMotionCandidate {
  source: 'semantic' | 'physical'
}

/**
 * The Cubism 4 motion surface used by pixi-live2d-display 0.4.0.  Keeping
 * this deliberately small lets the semantic-motion policy work without
 * reaching into Cubism's private queue objects.
 */
export interface Live2DMotionLoopSurface {
  isLoop?: () => boolean
  setIsLoop?: (loop: boolean) => void
  getIsLoop?: () => boolean
  setLoop?: (loop: boolean) => void
}

export interface Live2DMotionLoopLease {
  readonly originalLoop: boolean | undefined
  readonly changed: boolean
  restore: () => void
}

export interface Live2DCompatibilityCapabilities {
  gazeTracking: boolean
  blinking: boolean
  lipSync: boolean
  headMotion: boolean
  bodyMotion: boolean
  breath: boolean
}

export interface Live2DParameterSource {
  /** pixi-live2d-display 0.4.0's CubismModel runtime surface. */
  getModel?: () => {
    parameters?: {
      count?: unknown
      ids?: readonly unknown[]
    }
  } | undefined
  getParameterIds?: () => readonly string[]
  getParameterCount?: () => number
  getParameterId?: (index: number) => string
  parameters?: readonly (string | { id?: string, Id?: string })[] | {
    count?: unknown
    ids?: readonly unknown[]
  }
}

export interface Live2DCoreModelParameterTarget {
  getParameterValueById: (id: string) => number
  setParameterValueById: (id: string, value: number) => void
}

export interface Live2DCompatibilityProfile {
  readonly parameterMap: Readonly<Partial<Record<Live2DLogicalParameter, string>>>
  readonly motionMap: Readonly<Partial<Record<Live2DSemanticMotion, Live2DMotionCandidate>>>
  readonly capabilities: Live2DCompatibilityCapabilities
  readonly parameterIds: readonly string[]
  parameterId: (logical: Live2DLogicalParameter) => string | undefined
  hasParameter: (logical: Live2DLogicalParameter) => boolean
  getParameter: (model: Live2DCoreModelParameterTarget, logical: Live2DLogicalParameter, fallback?: number) => number
  setParameter: (model: Live2DCoreModelParameterTarget, logical: Live2DLogicalParameter, value: number) => boolean
  setPhysicalParameter: (model: Live2DCoreModelParameterTarget, id: string, value: number) => boolean
  resolveMotion: (semantic: string, requestedIndex?: number) => Live2DMotionCandidate | undefined
}

export interface Live2DCompatibilityProfileOptions {
  coreModel?: Live2DParameterSource
  parameterIds?: readonly string[]
  groups?: unknown
  motionDefinitions?: unknown
  motionOverrides?: Readonly<Record<string, string>>
  modelId?: string
}

export type Live2DMotionOverrideMap = Readonly<Record<string, string>>
export type Live2DMotionOverridesByModel = Readonly<Record<string, Live2DMotionOverrideMap>>

export interface Live2DFocusParameterTarget {
  idParamAngleX?: string
  idParamAngleY?: string
  idParamAngleZ?: string
  idParamEyeBallX?: string
  idParamEyeBallY?: string
  idParamBodyAngleX?: string
}

const parameterAliases: Record<Live2DLogicalParameter, readonly string[]> = {
  angleX: ['ParamAngleX', 'PARAM_ANGLE_X'],
  angleY: ['ParamAngleY', 'PARAM_ANGLE_Y'],
  angleZ: ['ParamAngleZ', 'PARAM_ANGLE_Z'],
  bodyAngleX: ['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X'],
  bodyAngleY: ['ParamBodyAngleY', 'PARAM_BODY_ANGLE_Y'],
  bodyAngleZ: ['ParamBodyAngleZ', 'PARAM_BODY_ANGLE_Z'],
  eyeBallX: ['ParamEyeBallX', 'PARAM_EYE_BALL_X'],
  eyeBallY: ['ParamEyeBallY', 'PARAM_EYE_BALL_Y'],
  eyeLeftOpen: ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'],
  eyeRightOpen: ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'],
  mouthOpen: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'],
  mouthForm: ['ParamMouthForm', 'PARAM_MOUTH_FORM'],
  breath: ['ParamBreath', 'PARAM_BREATH'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(value => value.length > 0))]
}

function readStringIds(values: readonly unknown[], count?: unknown): string[] {
  const boundedCount = typeof count === 'number' && Number.isFinite(count) && count >= 0
    ? Math.min(values.length, Math.floor(count))
    : values.length
  const ids: string[] = []
  for (let index = 0; index < boundedCount; index++) {
    const value = values[index]
    if (nonEmptyString(value))
      ids.push(value)
  }
  return uniqueStrings(ids)
}

export function discoverLive2DParameterIds(source?: Live2DParameterSource): string[] {
  if (!source)
    return []

  // This is the production path for pixi-live2d-display 0.4.0. Its
  // CubismModel wrapper exposes the underlying Cubism core model through
  // getModel(), whose stable parameter table is { count, ids }.
  if (typeof source.getModel === 'function') {
    try {
      const parameters = source.getModel()?.parameters
      if (parameters && Array.isArray(parameters.ids))
        return readStringIds(parameters.ids, parameters.count)
    }
    catch {
      // Fall through to test/future-runtime compatibility surfaces below.
    }
  }

  // Retain these adapters for isolated tests and future SDKs, but production
  // code never depends on them when the real Cubism surface is available.
  if (typeof source.getParameterIds === 'function') {
    try {
      const ids = source.getParameterIds()
      if (Array.isArray(ids))
        return uniqueStrings(ids.filter(nonEmptyString))
    }
    catch {
      // Continue to the next compatibility surface.
    }
  }

  if (typeof source.getParameterCount === 'function' && typeof source.getParameterId === 'function') {
    const ids: string[] = []
    try {
      const count = Math.max(0, Math.floor(source.getParameterCount()))
      for (let index = 0; index < count; index++) {
        const id = source.getParameterId(index)
        if (nonEmptyString(id))
          ids.push(id)
      }
    }
    catch {
      return []
    }
    return uniqueStrings(ids)
  }

  if (Array.isArray(source.parameters)) {
    return uniqueStrings(source.parameters.flatMap((parameter) => {
      if (typeof parameter === 'string')
        return parameter
      return [parameter.id, parameter.Id].filter(nonEmptyString)
    }))
  }

  if (isRecord(source.parameters) && Array.isArray(source.parameters.ids))
    return readStringIds(source.parameters.ids, source.parameters.count)

  return []
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function readGroupEntries(value: unknown): Array<{ name: string, ids: string[] }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (!isRecord(entry))
        return []
      const name = entry.Name ?? entry.name
      const ids = entry.Ids ?? entry.ids
      if (!nonEmptyString(name) || !Array.isArray(ids))
        return []
      return [{ name, ids: uniqueStrings(ids.filter(nonEmptyString)) }]
    })
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([name, ids]) => {
      if (!Array.isArray(ids))
        return []
      return [{ name, ids: uniqueStrings(ids.filter(nonEmptyString)) }]
    })
  }

  return []
}

function groupIds(groups: Array<{ name: string, ids: string[] }>, name: string): string[] {
  const wanted = normalizeKey(name)
  return groups.find(group => normalizeKey(group.name) === wanted)?.ids ?? []
}

function pickExisting(ids: ReadonlySet<string>, candidates: readonly string[]): string | undefined {
  return candidates.find(candidate => ids.has(candidate))
}

/**
 * Returns only the overrides belonging to the requested model. A missing
 * identity deliberately returns no overrides, so another model's mapping is
 * never treated as the current model's fact.
 */
export function resolveModelMotionOverrides(
  value: unknown,
  modelId?: string,
): Record<string, string> {
  if (!nonEmptyString(modelId) || !isRecord(value))
    return {}

  const modelOverrides = value[modelId]
  if (!isRecord(modelOverrides))
    return {}

  return Object.entries(modelOverrides).reduce<Record<string, string>>((result, [fileName, semantic]) => {
    if (nonEmptyString(semantic))
      result[fileName] = semantic
    return result
  }, {})
}

/**
 * Updates the model-scoped map without mutating the caller's state. This also
 * acts as the small persistence contract used by the store and tests.
 */
export function setModelMotionOverride(
  value: Live2DMotionOverridesByModel | unknown,
  modelId: string | undefined,
  fileName: string,
  semantic: string,
): Record<string, Record<string, string>> {
  const next: Record<string, Record<string, string>> = {}
  if (isRecord(value)) {
    for (const [key, modelOverrides] of Object.entries(value)) {
      if (!isRecord(modelOverrides))
        continue
      const sanitized = Object.entries(modelOverrides).reduce<Record<string, string>>((result, [fileName, candidate]) => {
        if (nonEmptyString(candidate))
          result[fileName] = candidate
        return result
      }, {})
      next[key] = sanitized
    }
  }

  if (nonEmptyString(modelId) && nonEmptyString(fileName) && nonEmptyString(semantic)) {
    const modelMap = next[modelId] ?? {}
    modelMap[fileName] = semantic
    next[modelId] = modelMap
  }

  return next
}

/**
 * One-time compatibility migration for the old flat motion map. It requires
 * an explicit current model identity and never applies the flat map when the
 * identity is missing. After migration, all reads are model-scoped.
 */
export function migrateLegacyMotionOverrides(
  value: unknown,
  modelId?: string,
): Record<string, Record<string, string>> | undefined {
  if (!nonEmptyString(modelId) || !isRecord(value))
    return undefined

  const entries = Object.entries(value)
  if (entries.length === 0 || entries.some(([, candidate]) => isRecord(candidate)))
    return undefined

  const legacy = entries.reduce<Record<string, string>>((result, [fileName, semantic]) => {
    if (nonEmptyString(semantic))
      result[fileName] = semantic
    return result
  }, {})
  return Object.keys(legacy).length > 0 ? { [modelId]: legacy } : undefined
}

/**
 * Binds Cubism4InternalModel's built-in focus targets to resolved physical
 * IDs. Live2DModel.focus() and focusController remain the sole coordinate and
 * interpolation authority; this only changes where that canonical state is
 * written for a legacy model.
 */
export function bindLive2DFocusParameterTargets(
  target: Live2DFocusParameterTarget,
  profile: Pick<Live2DCompatibilityProfile, 'parameterId'>,
): void {
  const bindings: Array<[keyof Live2DFocusParameterTarget, Live2DLogicalParameter]> = [
    ['idParamAngleX', 'angleX'],
    ['idParamAngleY', 'angleY'],
    ['idParamAngleZ', 'angleZ'],
    ['idParamEyeBallX', 'eyeBallX'],
    ['idParamEyeBallY', 'eyeBallY'],
    ['idParamBodyAngleX', 'bodyAngleX'],
  ]

  for (const [key, logical] of bindings) {
    const id = profile.parameterId(logical)
    if (id)
      target[key] = id
  }
}

function pickEyeGroupParameter(
  ids: readonly string[],
  parameterIds: ReadonlySet<string>,
  side: 'left' | 'right',
): string | undefined {
  const sidePattern = side === 'left'
    ? /eye(?:blink)?(?:left|l)open/i
    : /eye(?:blink)?(?:right|r)open/i
  return ids.find(id => parameterIds.has(id) && sidePattern.test(normalizeKey(id))) ?? ids.find(id => parameterIds.has(id))
}

function resolveParameterMap(parameterIds: readonly string[], groups: Array<{ name: string, ids: string[] }>) {
  const available = new Set(parameterIds)
  const eyeBlinkIds = groupIds(groups, 'EyeBlink')
  const lipSyncIds = groupIds(groups, 'LipSync')
  const result: Partial<Record<Live2DLogicalParameter, string>> = {}

  for (const logical of Object.keys(parameterAliases) as Live2DLogicalParameter[])
    result[logical] = pickExisting(available, parameterAliases[logical])

  result.eyeLeftOpen = pickEyeGroupParameter(eyeBlinkIds, available, 'left') ?? result.eyeLeftOpen
  result.eyeRightOpen = pickEyeGroupParameter(eyeBlinkIds, available, 'right') ?? result.eyeRightOpen
  result.mouthOpen = lipSyncIds.find(id => parameterIds.includes(id) && /(?:mouth|lip).*open/i.test(id))
    ?? lipSyncIds.find(id => parameterIds.includes(id))
    ?? result.mouthOpen
  return result
}

function motionFileName(value: unknown): string {
  if (!isRecord(value))
    return ''
  const file = value.File ?? value.file
  return nonEmptyString(file) ? file : ''
}

function motionBaseName(fileName: string): string {
  return fileName.split(/[\\/]/).pop()?.replace(/\.(?:motion3\.json|mtn)$/i, '') ?? fileName
}

function normalizeSemanticMotion(value: string): Live2DSemanticMotion | undefined {
  const key = normalizeKey(value)
  if (key === 'idle' || key === 'wait' || key === 'standby' || key === 'normal' || key === 'breath')
    return 'idle'
  if (key === 'happy')
    return 'happy'
  if (key === 'sad')
    return 'sad'
  if (key === 'angry' || key === 'anger')
    return 'angry'
  if (key === 'think')
    return 'think'
  if (key === 'surprise' || key === 'surprised')
    return 'surprise'
  if (key === 'awkward')
    return 'awkward'
  if (key === 'question')
    return 'question'
  if (key === 'curious')
    return 'curious'
  if (key === 'puzzle' || key === 'doubt')
    return 'think'
  return undefined
}

function semanticFromFile(fileName: string): { semantic: Live2DSemanticMotion, confidence: Live2DMotionConfidence } | undefined {
  const key = normalizeKey(motionBaseName(fileName))
  if (/(?:^|\d)(?:idle|wait|standby|normal|breath)(?:\d|$)/.test(key))
    return { semantic: 'idle', confidence: 'high' }
  if (key.includes('happy'))
    return { semantic: 'happy', confidence: 'high' }
  if (key.includes('anger') || key.includes('angry'))
    return { semantic: 'angry', confidence: 'high' }
  if (key.includes('sad'))
    return { semantic: 'sad', confidence: 'high' }
  if (key.includes('surprise'))
    return { semantic: 'surprise', confidence: 'high' }
  if (key.includes('awkward'))
    return { semantic: 'awkward', confidence: 'high' }
  if (key.includes('puzzle') || key.includes('doubt'))
    return { semantic: 'think', confidence: 'low' }
  return undefined
}

function confidenceRank(confidence: Live2DMotionConfidence): number {
  return confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1
}

function resolveMotionMap(
  value: unknown,
  motionOverrides: Readonly<Record<string, string>> = {},
): Partial<Record<Live2DSemanticMotion, Live2DMotionCandidate>> {
  if (!isRecord(value))
    return {}

  const map: Partial<Record<Live2DSemanticMotion, Live2DMotionCandidate>> = {}
  for (const [group, definitions] of Object.entries(value)) {
    if (!Array.isArray(definitions))
      continue

    definitions.forEach((definition, index) => {
      const fileName = motionFileName(definition)
      const overrideSemantic = normalizeSemanticMotion(motionOverrides[fileName] ?? '')
      const groupSemantic = normalizeSemanticMotion(group)
      const fileSemantic = semanticFromFile(fileName)
      const semantic = overrideSemantic ?? groupSemantic ?? fileSemantic?.semantic
      if (!semantic)
        return

      const confidence = overrideSemantic || groupSemantic
        ? 'high'
        : fileSemantic?.confidence ?? 'low'
      const candidate: Live2DMotionCandidate = {
        group,
        index,
        fileName,
        confidence,
        reason: overrideSemantic
          ? ['persisted motion override declares ', semantic].join('')
          : groupSemantic
            ? ['model motion group "', group, '" declares ', semantic].join('')
            : ['motion filename "', fileName, '" matches ', semantic, ' heuristic'].join(''),
      }
      const existing = map[semantic]
      if (!existing || confidenceRank(candidate.confidence) > confidenceRank(existing.confidence))
        map[semantic] = candidate
    })
  }
  return map
}

/**
 * Resolves either an AIRI semantic motion or a direct model motion request.
 *
 * A semantic candidate owns its physical group/index. The optional index is
 * only meaningful for a direct physical group request; it must not turn
 * `Happy` into another motion merely because its caller used index 0.
 */
export function resolveLive2DMotionRequest(
  profile: Live2DCompatibilityProfile | undefined,
  motionName: string,
  requestedIndex: number | undefined,
  motionDefinitions: unknown,
): Live2DMotionRequest | undefined {
  const hasPhysicalGroup = isRecord(motionDefinitions) && Object.hasOwn(motionDefinitions, motionName)

  // A declared group plus an explicit index is the runtime motion picker
  // contract. This must win over a same-named semantic candidate.
  if (hasPhysicalGroup && requestedIndex !== undefined) {
    return {
      group: motionName,
      index: requestedIndex,
      fileName: '',
      confidence: 'high',
      reason: 'direct physical motion group request',
      source: 'physical',
    }
  }

  const semanticCandidate = profile?.resolveMotion(motionName, requestedIndex)
  if (semanticCandidate)
    return { ...semanticCandidate, source: 'semantic' }

  if (hasPhysicalGroup) {
    return {
      group: motionName,
      index: requestedIndex ?? 0,
      fileName: '',
      confidence: 'high',
      reason: 'direct physical motion group request',
      source: 'physical',
    }
  }

  return undefined
}

/**
 * Reads the public loop flag exposed by the installed Cubism motion object.
 * No private `_motionData`/`_looper` probing is used by production code.
 */
export function readLive2DMotionLoopState(motion: unknown): boolean | undefined {
  if (!isRecord(motion))
    return undefined

  const surface = motion as Live2DMotionLoopSurface
  try {
    if (typeof surface.isLoop === 'function')
      return surface.isLoop()
    if (typeof surface.getIsLoop === 'function')
      return surface.getIsLoop()
  }
  catch {
    return undefined
  }
  return undefined
}

/**
 * Changes a motion's loop policy through its public runtime API, when one is
 * available. This is used only for a temporary semantic-action lease.
 */
export function writeLive2DMotionLoopState(motion: unknown, loop: boolean): boolean {
  if (!isRecord(motion))
    return false

  const surface = motion as Live2DMotionLoopSurface
  try {
    if (typeof surface.setIsLoop === 'function') {
      surface.setIsLoop(loop)
      return true
    }
    if (typeof surface.setLoop === 'function') {
      surface.setLoop(loop)
      return true
    }
  }
  catch {
    return false
  }
  return false
}

/**
 * Semantic emotion motions are transient AIRI actions even when an asset's
 * author marked the motion as looping. The lease makes that policy temporary
 * and restores the author's loop intent when the action ends or is replaced.
 */
export function acquireLive2DSemanticMotionLoopLease(motion: unknown): Live2DMotionLoopLease {
  const originalLoop = readLive2DMotionLoopState(motion)
  const changed = originalLoop === true && writeLive2DMotionLoopState(motion, false)
  let restored = false

  return {
    originalLoop,
    changed,
    restore: () => {
      if (restored || !changed || originalLoop === undefined)
        return
      restored = true
      writeLive2DMotionLoopState(motion, originalLoop)
    },
  }
}

export function shouldHandoffCompletedSemanticMotionToIdle(options: {
  enabled: boolean
  manualMotionSelected: boolean
  active?: Pick<Live2DMotionCandidate, 'group' | 'index'>
  finishedGroup?: string
  finishedIndex?: number
}): boolean {
  const { enabled, manualMotionSelected, active, finishedGroup, finishedIndex } = options
  return Boolean(
    enabled
    && !manualMotionSelected
    && active
    && active.group === finishedGroup
    && active.index === finishedIndex,
  )
}

export function shouldRestartResolvedIdleMotionOnFinish(options: {
  enabled: boolean
  manualMotionSelected: boolean
  looping?: boolean
  canonicalIdleGroup?: string
  candidate?: Pick<Live2DMotionCandidate, 'group' | 'index'>
  finishedGroup?: string
  finishedIndex?: number
}): boolean {
  const { enabled, manualMotionSelected, looping, canonicalIdleGroup, candidate, finishedGroup, finishedIndex } = options
  if (!enabled || manualMotionSelected || looping || !candidate)
    return false
  if (candidate.group === canonicalIdleGroup)
    return false
  return candidate.group === finishedGroup && candidate.index === finishedIndex
}

export function createLive2DCompatibilityProfile(options: Live2DCompatibilityProfileOptions = {}): Live2DCompatibilityProfile {
  const parameterIds = uniqueStrings(options.parameterIds ?? discoverLive2DParameterIds(options.coreModel))
  const groups = readGroupEntries(options.groups)
  const parameterMap = resolveParameterMap(parameterIds, groups)
  const motionMap = resolveMotionMap(options.motionDefinitions, options.motionOverrides)
  const available = new Set(parameterIds)

  return {
    parameterMap,
    motionMap,
    parameterIds,
    capabilities: {
      gazeTracking: Boolean(parameterMap.eyeBallX && parameterMap.eyeBallY),
      blinking: Boolean(parameterMap.eyeLeftOpen && parameterMap.eyeRightOpen),
      lipSync: Boolean(parameterMap.mouthOpen),
      headMotion: Boolean(parameterMap.angleX || parameterMap.angleY || parameterMap.angleZ),
      bodyMotion: Boolean(parameterMap.bodyAngleX || parameterMap.bodyAngleY || parameterMap.bodyAngleZ),
      breath: Boolean(parameterMap.breath),
    },
    parameterId: logical => parameterMap[logical],
    hasParameter: logical => Boolean(parameterMap[logical]),
    getParameter: (model, logical, fallback = 0) => {
      const id = parameterMap[logical]
      if (!id)
        return fallback
      const value = model.getParameterValueById(id)
      return Number.isFinite(value) ? value : fallback
    },
    setParameter: (model, logical, value) => {
      const id = parameterMap[logical]
      if (!id)
        return false
      model.setParameterValueById(id, value)
      return true
    },
    setPhysicalParameter: (model, id, value) => {
      if (!available.has(id))
        return false
      model.setParameterValueById(id, value)
      return true
    },
    resolveMotion: (semantic) => {
      const normalized = normalizeSemanticMotion(semantic)
      const candidate = normalized ? motionMap[normalized] : undefined
      return candidate
    },
  }
}
