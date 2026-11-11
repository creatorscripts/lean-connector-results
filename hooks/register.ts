import type { Register } from 'claude-code'
import {
  MIN_CHARS,
  idsIn,
  isProtectedTool,
  isReadTool,
  leanText,
  type Stats,
} from './lean'

type TextBlock = { type: 'text'; text: string; [field: string]: unknown }

const isTextBlock = (b: unknown): b is TextBlock =>
  typeof b === 'object' &&
  b !== null &&
  (b as { type?: unknown }).type === 'text' &&
  typeof (b as { text?: unknown }).text === 'string'

const add = (a: Stats, b: Stats): Stats => ({
  empty: a.empty + b.empty,
  metadata: a.metadata + b.metadata,
  kept: a.kept + b.kept,
})

/**
 * The result in the shape it came in (a string, text blocks, or an object
 * holding `content` blocks), each JSON text made lean; `undefined` when
 * nothing changed.
 */
function leanResult(
  result: unknown,
  edited: ReadonlySet<string>,
): { result: unknown; stats: Stats; saved: number } | undefined {
  if (typeof result === 'string') {
    const lean = leanText(result, edited)

    return lean && { result: lean.text, stats: lean.stats, saved: result.length - lean.text.length }
  }

  if (Array.isArray(result)) {
    let stats: Stats = { empty: 0, metadata: 0, kept: 0 }
    let saved = 0
    const blocks = result.map((block: unknown) => {
      if (!isTextBlock(block)) return block

      const lean = leanText(block.text, edited)

      if (!lean) return block
      stats = add(stats, lean.stats)
      saved += block.text.length - lean.text.length

      return { ...block, text: lean.text }
    })

    return saved > 0 ? { result: blocks, stats, saved } : undefined
  }

  if (typeof result === 'object' && result !== null) {
    const { content } = result as { content?: unknown }

    // A structured result is checked against the tool's output schema, which
    // a stripped copy could fail: only its text blocks are made lean.
    if (!Array.isArray(content)) return undefined

    const lean = leanResult(content, edited)

    return lean && { ...lean, result: { ...result, content: lean.result } }
  }

  return undefined
}

export const register: Register = on => {
  // Ids this session has written to: those records are being edited, so they
  // come back whole wherever they turn up later.
  const edited = new Set<string>()

  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    const ran = await next(e)
    const { tool, tool_use_id: _id, ...args } = e as Record<string, unknown> & { tool: string }

    if (!isReadTool(tool)) {
      idsIn(args, edited)

      return ran
    }

    if (ran.deny !== undefined || ran.isError === true) return ran
    if (isProtectedTool(tool)) return ran
    if ((ran.text?.length ?? MIN_CHARS) < MIN_CHARS) return ran

    const lean = leanResult(ran.result, edited)

    if (!lean || lean.saved < MIN_CHARS / 10) return ran

    const { stats, saved } = lean
    const note =
      `${$.plugin.name} removed ${stats.empty} empty fields (null, "", [], {}) and ` +
      `${stats.metadata} metadata keys from this ${tool} result (${saved} characters). ` +
      'A field missing from a record is empty, not absent from the schema.' +
      (stats.kept > 0 ? ` ${stats.kept} records edited in this session were left whole.` : '')

    return { result: lean.result, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => next(e))
}
