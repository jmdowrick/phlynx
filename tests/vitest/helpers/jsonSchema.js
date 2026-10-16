/**
 * A minimal JSON Schema (2020-12) checker for tests: the keywords circulatory_autogen's vendored schemas use, and no
 * more. It says only whether a value is valid.
 */

const typeOf = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

const isType = (value, type) => type === typeOf(value) || (type === 'number' && typeOf(value) === 'integer')

const resolve = (root, ref) => ref.replace(/^#\//, '').split('/').reduce((node, key) => node[key], root)

/**
 * Whether `value` is valid against `schema`, `$ref`s resolved in `root`.
 *
 * @param {Object|boolean} schema
 * @param {*} value
 * @param {Object} [root]
 * @returns {boolean}
 */
export function isValid(schema, value, root = schema) {
  if (schema === true) return true
  if (schema === false) return false
  const check = (sub, v = value) => isValid(sub, v, root)
  const isObject = typeOf(value) === 'object'
  const isArray = Array.isArray(value)
  const s = schema
  if (s.$ref && !check(resolve(root, s.$ref))) return false
  if (s.type && ![s.type].flat().some((type) => isType(value, type))) return false
  if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(value)) return false
  if (s.enum && !s.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) return false
  if (typeof value === 'string') {
    if (s.pattern && !new RegExp(s.pattern, 'u').test(value)) return false
    if (s.minLength !== undefined && [...value].length < s.minLength) return false
  }
  if (isObject) {
    if (s.required?.some((key) => !(key in value))) return false
    const keys = Object.keys(value)
    if (s.minProperties !== undefined && keys.length < s.minProperties) return false
    if (s.maxProperties !== undefined && keys.length > s.maxProperties) return false
    for (const key of keys) {
      if (s.properties && key in s.properties) {
        if (!check(s.properties[key], value[key])) return false
      } else if (s.additionalProperties !== undefined && !check(s.additionalProperties, value[key])) {
        return false
      }
    }
  }
  if (isArray) {
    if (s.minItems !== undefined && value.length < s.minItems) return false
    if (s.maxItems !== undefined && value.length > s.maxItems) return false
    const prefix = s.prefixItems ?? []
    if (prefix.some((sub, i) => i < value.length && !check(sub, value[i]))) return false
    if (s.items !== undefined && value.slice(prefix.length).some((item) => !check(s.items, item))) return false
  }
  if (s.allOf && !s.allOf.every((sub) => check(sub))) return false
  if (s.anyOf && !s.anyOf.some((sub) => check(sub))) return false
  if (s.oneOf && s.oneOf.filter((sub) => check(sub)).length !== 1) return false
  if (s.not && check(s.not)) return false
  if (s.if) {
    const branch = check(s.if) ? s.then : s.else
    if (branch !== undefined && !check(branch)) return false
  }
  return true
}
