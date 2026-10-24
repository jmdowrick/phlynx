import { TARGET_COMPATIBLE } from './constants'

export {
  findPort,
  isAnnotatedPort,
  isNamedPort,
  portDisplayName,
  portIdentity,
  portRef,
  samePort,
} from './portIdentity'

export function isCompatible(srcType, tgtType) {
  return TARGET_COMPATIBLE[srcType]?.has(tgtType) ?? false
}
