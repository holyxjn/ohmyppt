import log from 'electron-log/main.js'

const getRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const readField = (record: Record<string, unknown>, key: string): unknown => {
  const direct = record[key]
  if (direct !== undefined) return direct
  const kwargs = getRecord(record.kwargs)
  return kwargs?.[key]
}

export const previewStr = (value: unknown, max = 240): string => {
  const source =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value)
          } catch {
            return String(value)
          }
        })()
  const compact = source.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max)}...` : compact
}

export function logAgentToolEvents(
  data: unknown,
  seen: Set<string>,
  options: { tag: string; source: 'updates' | 'messages' }
): void {
  const { tag, source } = options

  const visitMessage = (msg: unknown): void => {
    const record = getRecord(msg)
    if (!record) return

    const toolCallsSources = [
      readField(record, 'tool_calls'),
      readField(record, 'tool_call_chunks'),
      getRecord(readField(record, 'additional_kwargs'))?.tool_calls
    ]
    for (const calls of toolCallsSources) {
      if (!Array.isArray(calls)) continue
      for (const call of calls) {
        const callRecord = getRecord(call)
        if (!callRecord) continue
        const fnRecord = getRecord(callRecord.function)
        const rawArgs = callRecord.args ?? callRecord.arguments ?? fnRecord?.arguments ?? ''
        const name = String(callRecord.name ?? fnRecord?.name ?? '').trim()
        const id = String(callRecord.id ?? callRecord.tool_call_id ?? '').trim()
        const argsText = previewStr(rawArgs)
        const key = `call:${id}:${name}:${argsText}`
        if (seen.has(key)) continue
        seen.add(key)
        log.info(`[${tag}] tool_call`, {
          source,
          toolName: name || null,
          toolCallId: id || null,
          argsLength: typeof rawArgs === 'string' ? rawArgs.length : 0,
          argsPreview: argsText
        })
      }
    }

    const messageType = String(readField(record, 'type') ?? readField(record, 'role') ?? '')
    const toolCallId = String(readField(record, 'tool_call_id') ?? '').trim()
    const toolName = String(readField(record, 'name') ?? '').trim()
    if (toolCallId || messageType === 'tool') {
      const content = readField(record, 'content')
      const contentLen = typeof content === 'string' ? content.length : 0
      const key = `result:${toolCallId}:${toolName}:${contentLen}`
      if (!seen.has(key)) {
        seen.add(key)
        log.info(`[${tag}] tool_result`, {
          source,
          toolName: toolName || null,
          toolCallId: toolCallId || null,
          contentLength: contentLen
        })
      }
    }
  }

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const record = getRecord(value)
    if (!record) return
    if (
      readField(record, 'tool_calls') !== undefined ||
      readField(record, 'tool_call_chunks') !== undefined ||
      readField(record, 'tool_call_id') !== undefined ||
      readField(record, 'role') === 'tool' ||
      readField(record, 'type') === 'tool'
    ) {
      visitMessage(record)
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === 'object') visit(nested)
    }
  }

  visit(data)
}
