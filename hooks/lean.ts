// Pure logic: no engine calls, so the tests and the hook share it.

/** A result shorter than this (as the model reads it) is left alone. */
export const MIN_CHARS = 6000
/** A rewrite that saves less than this share of the text is not worth it. */
export const MIN_SAVING = 0.1

const READ_VERBS = new Set([
  'get', 'list', 'search', 'query', 'fetch', 'find', 'read', 'show', 'lookup',
])
const WRITE_VERBS = new Set([
  'update', 'upsert', 'create', 'add', 'delete', 'remove', 'edit', 'patch',
  'send', 'post', 'put', 'set', 'publish', 'convert', 'assign', 'move',
  'rename', 'trash', 'label', 'upload', 'import', 'run', 'execute', 'invoke',
  'activate', 'deactivate', 'book', 'reschedule', 'clone', 'install', 'call',
  'replace', 'manage', 'mark', 'apply', 'share', 'copy', 'restore', 'empty',
])

/** Tool names that carry Deluge or a blueprint: never touched. */
const PROTECTED_TOOL = /deluge|blueprint|script|function|custom_?api|workflow|scenario|\.ds\b/i

/** Keys whose presence means the payload is a Make blueprint or code. */
const PROTECTED_KEY = /^(blueprint|flow|mapper|deluge|script|workflow|source_?code|code|function_?(body|code)?|on_(load|user_input|validate|success|add|edit))$/i

/** What Deluge looks like inside a string value. */
const DELUGE = /\bzoho\.(crm|creator|books|desk|cliq|sheet|writer|loginuser(id)?|adminuser(id)?|currentdate|currenttime|appname)\b|\binvokeurl\b|\bifnull\s*\(|\.toLong\s*\(|\bfor each\s+\w+\s+in\b|\binsert into \w+\s*\[|\binput\.\w+\s*=|\binfo\s+[\w.]+\s*;/i

/** Keys that are transport/system metadata, not the record's own data. */
const METADATA_KEY = /^(\$.*|@.*|_links?|links|_meta|meta|_?metadata|_?etag|kind|self|href|request_?id|trace_?id|api_?version|response_?headers)$/i

/** Inside metadata, anything paging needs is kept. */
const PAGING_KEY = /page|cursor|next|prev|more|token|count|total|offset|limit/i

const ID_KEY = /^(id|ID|.*_id|.*Id|.*ID|record_?ids?|ids)$/

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export type Stats = { empty: number; metadata: number; kept: number }

function words(tool: string): string[] {
  const name = tool.split('__').slice(2).join('__') || tool

  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map(w => w.toLowerCase())
    .filter(Boolean)
}

/** A read tool: the first verb in its name is a read verb. */
export function isReadTool(tool: string): boolean {
  for (const w of words(tool)) {
    if (WRITE_VERBS.has(w)) return false
    if (READ_VERBS.has(w)) return true
  }

  return false
}

export function isProtectedTool(tool: string): boolean {
  return PROTECTED_TOOL.test(tool)
}

/** The record ids a write call names, however deep in its arguments. */
export function idsIn(args: unknown, out: Set<string>, key = '', depth = 0): void {
  if (depth > 5 || args === null || args === undefined) return

  if (typeof args === 'string' || typeof args === 'number') {
    const s = String(args)

    if ((ID_KEY.test(key) && s.length >= 4) || /^\d{10,}$/.test(s)) out.add(s)

    return
  }

  if (Array.isArray(args)) {
    for (const item of args) idsIn(item, out, key, depth + 1)

    return
  }

  if (typeof args === 'object') {
    for (const [k, v] of Object.entries(args)) idsIn(v, out, k, depth + 1)
  }
}

function isEmpty(v: Json | undefined): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v).length === 0

  return false
}

/** True when the payload holds Deluge or a blueprint anywhere. */
export function isProtectedPayload(v: Json, depth = 0): boolean {
  if (depth > 12) return true // too deep to judge: leave it alone
  if (typeof v === 'string') return v.length > 20 && DELUGE.test(v)
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return v.some(item => isProtectedPayload(item, depth + 1))

  for (const [k, child] of Object.entries(v)) {
    if (PROTECTED_KEY.test(k) && !isEmpty(child)) return true
    if (isProtectedPayload(child, depth + 1)) return true
  }

  return false
}

/** True when some array holds two or more records: a list, not one record. */
export function hasRecordList(v: Json, depth = 0): boolean {
  if (depth > 12 || v === null || typeof v !== 'object') return false

  if (Array.isArray(v)) {
    const records = v.filter(i => i !== null && typeof i === 'object' && !Array.isArray(i))

    return records.length >= 2 || v.some(i => hasRecordList(i, depth + 1))
  }

  return Object.values(v).some(child => hasRecordList(child, depth + 1))
}

function isEdited(record: { [key: string]: Json }, edited: ReadonlySet<string>): boolean {
  if (edited.size === 0) return false

  for (const [k, v] of Object.entries(record)) {
    if ((typeof v === 'string' || typeof v === 'number') && ID_KEY.test(k) && edited.has(String(v))) {
      return true
    }
  }

  return false
}

function pagingOnly(v: Json): Json | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined

  const kept: { [key: string]: Json } = {}

  for (const [k, child] of Object.entries(v)) {
    if (PAGING_KEY.test(k) && !isEmpty(child) && (typeof child !== 'object' || child === null)) {
      kept[k] = child
    }
  }

  return Object.keys(kept).length > 0 ? kept : undefined
}

/** A copy without empty fields and metadata; edited records come back whole. */
export function prune(v: Json, edited: ReadonlySet<string>, stats: Stats): Json {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(item => prune(item, edited, stats))

  if (isEdited(v, edited)) {
    stats.kept += 1

    return v
  }

  const out: { [key: string]: Json } = {}

  for (const [k, child] of Object.entries(v)) {
    if (METADATA_KEY.test(k)) {
      const paging = PAGING_KEY.test(k) && (typeof child !== 'object' || child === null) ? child : pagingOnly(child)

      stats.metadata += 1
      if (paging !== undefined && !isEmpty(paging)) out[k] = paging
      continue
    }

    const next = prune(child, edited, stats)

    if (isEmpty(next)) {
      stats.empty += 1
      continue
    }

    out[k] = next
  }

  return out
}

/**
 * One text of a connector result, made lean; `undefined` means "leave it":
 * not JSON, one record and not a list, Deluge or a blueprint inside, or too
 * little saved.
 */
export function leanText(
  text: string,
  edited: ReadonlySet<string>,
): { text: string; stats: Stats } | undefined {
  const trimmed = text.trim()

  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return undefined

  let parsed: Json

  try {
    parsed = JSON.parse(trimmed) as Json
  } catch {
    return undefined
  }

  if (!hasRecordList(parsed) || isProtectedPayload(parsed)) return undefined

  const stats: Stats = { empty: 0, metadata: 0, kept: 0 }
  const lean = JSON.stringify(prune(parsed, edited, stats))

  if (stats.empty + stats.metadata === 0) return undefined
  if (lean.length > text.length * (1 - MIN_SAVING)) return undefined

  return { text: lean, stats }
}
