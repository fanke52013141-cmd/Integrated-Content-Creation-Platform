import { ValidationError } from './errors.mjs'

export function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} must be a non-empty string`, { field })
  }
  return value.trim()
}

export function optionalString(value, field, fallback = '') {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`, { field })
  }
  return value.trim()
}

export function plainObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`, { field })
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ValidationError(`${field} must be a plain object`, { field })
  }
  return value
}

export function jsonObject(value, field) {
  plainObject(value, field)
  return cloneJson(value, field)
}

function cloneJson(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidationError(`${path} contains a non-finite number`, { field: path })
    return value
  }
  if (Array.isArray(value)) {
    return Array.from(value, (item, index) => cloneJson(item, `${path}[${index}]`))
  }
  if (typeof value === 'object') {
    plainObject(value, path)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new ValidationError(`${path} contains a reserved key`, { field: path, key })
      }
      return [key, cloneJson(item, `${path}.${key}`)]
    }))
  }
  throw new ValidationError(`${path} must contain JSON-compatible values only`, { field: path })
}

export function stringArray(value, field) {
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`, { field })
  const items = value.map((item, index) => requiredString(item, `${field}[${index}]`))
  if (new Set(items).size !== items.length) {
    throw new ValidationError(`${field} must not contain duplicates`, { field })
  }
  return items
}

export function booleanValue(value, field) {
  if (typeof value !== 'boolean') throw new ValidationError(`${field} must be a boolean`, { field })
  return value
}

export function revisionValue(value, field = 'expectedRevision') {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError(`${field} must be a positive integer`, { field })
  }
  return value
}

export function isoDate(value, field) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${field} must be a valid date`, { field })
  return date.toISOString()
}

export function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}
