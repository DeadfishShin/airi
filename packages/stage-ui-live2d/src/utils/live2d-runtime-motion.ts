export const selectedRuntimeMotionStorageKeys = [
  'selected-runtime-motion',
  'selected-runtime-motion-group',
  'selected-runtime-motion-index',
] as const

export interface Live2DSelectedRuntimeMotion {
  path: string
  group: string
  index: number
}

export interface ReadLive2DSelectedRuntimeMotionResult {
  motion?: Live2DSelectedRuntimeMotion
  hasAnyKey: boolean
  invalid: boolean
}

export function parseLive2DMotionIndex(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value))
    return undefined

  const index = Number(value)
  return Number.isSafeInteger(index) ? index : undefined
}

export function clearSelectedLive2DMotion(storage: Pick<Storage, 'removeItem'> = localStorage) {
  for (const key of selectedRuntimeMotionStorageKeys)
    storage.removeItem(key)
}

export function writeSelectedLive2DMotion(
  storage: Pick<Storage, 'setItem'>,
  motion: Live2DSelectedRuntimeMotion,
) {
  storage.setItem('selected-runtime-motion', motion.path)
  storage.setItem('selected-runtime-motion-group', motion.group)
  storage.setItem('selected-runtime-motion-index', String(motion.index))
}

export function readSelectedLive2DMotion(
  storage: Pick<Storage, 'getItem'> = localStorage,
): ReadLive2DSelectedRuntimeMotionResult {
  const path = storage.getItem('selected-runtime-motion')
  const group = storage.getItem('selected-runtime-motion-group')
  const rawIndex = storage.getItem('selected-runtime-motion-index')
  const index = parseLive2DMotionIndex(rawIndex)
  const hasAnyKey = path !== null || group !== null || rawIndex !== null

  if (!hasAnyKey)
    return { hasAnyKey: false, invalid: false }

  if (!path || group === null || index === undefined)
    return { hasAnyKey: true, invalid: true }

  return {
    motion: { path, group, index },
    hasAnyKey: true,
    invalid: false,
  }
}
