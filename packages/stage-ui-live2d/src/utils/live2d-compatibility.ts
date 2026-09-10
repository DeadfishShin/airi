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

export interface Live2DCompatibilityCapabilities {
  gazeTracking: boolean
  blinking: boolean
  lipSync: boolean
  headMotion: boolean
  bodyMotion: boolean
  breath: boolean
}

export interface Live2DParameterSource {
  getParameterIds?: () => readonly string[]
  getParameterCount?: () => number
  getParameterId?: (index: number) => string
  parameters?: readonly (string | { id?: string, Id?: string })[]
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

export function discoverLive2DParameterIds(source?: Live2DParameterSource): string[] {
  if (!source)
    return []

  if (typeof source.getParameterIds === 'function') {
    const ids = source.getParameterIds()
    if (Array.isArray(ids))
      return uniqueStrings(ids.filter(nonEmptyString))
  }

  if (typeof source.getParameterCount === 'function' && typeof source.getParameterId === 'function') {
    const ids: string[] = []
    const count = Math.max(0, Math.floor(source.getParameterCount()))
    for (let index = 0; index < count; index++) {
      const id = source.getParameterId(index)
      if (nonEmptyString(id))
        ids.push(id)
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
    resolveMotion: (semantic, requestedIndex) => {
      const normalized = normalizeSemanticMotion(semantic)
      const candidate = normalized ? motionMap[normalized] : undefined
      if (!candidate)
        return undefined
      return requestedIndex === undefined ? candidate : { ...candidate, index: requestedIndex }
    },
  }
}
