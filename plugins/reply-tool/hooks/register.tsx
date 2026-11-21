import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  CONTRACT,
  CONTRACT_ID,
  MAX_REJECTIONS,
  USAGE,
  addStats,
  formatStats,
  parseSetting,
  readStats,
  rejectionText,
  renderReply,
  replyFooter,
  toolSpec,
  validateReply,
  viewOf,
} from './reply'
import type { Setting, Stats } from './reply'

// Drawn state: what a respond row reads while drawing. A change redraws past replies.
// The setting (off, or on drawing tldr, exec or full) lives here alone, in the host's session state,
// and is never written to `$.store`: every session starts with reply-tool off.
const mode = atom({ plugin: 'reply-tool', key: 'mode' } as const, 'off' as Setting)

// One setter per atom: the state library's scan wants each atom named where it is written.
async function putMode($: EngineInterface, value: Setting): Promise<void> {
  await update($, mode, () => value)
}

// The switch itself. Off <-> on: session state, the contract and the tool (active while on,
// deferred while off). Moving among tldr, exec and full while on: the drawing only, the tool stays as it is.
async function setMode($: EngineInterface, want: Setting): Promise<string> {
  const now = await read($, mode)
  if (want === now) return `reply-tool is already set to ${now}.`
  await putMode($, want)
  if (now !== 'off' && want !== 'off') return `reply-tool now draws replies as ${want}.`
  await $.tool.register(toolSpec(want !== 'off'))
  return want === 'off'
    ? 'reply-tool is OFF: Claude replies in plain text again; replies already drawn stay in the transcript, drawn in full.'
    : `reply-tool is ON (${want}): Claude now ends each turn with the respond tool.`
}

// Counter writes run one after another so two hooks never overwrite each other's increment.
let writes: Promise<unknown> = Promise.resolve()

function bump($: EngineInterface, delta: Partial<Stats>): Promise<unknown> {
  writes = writes
    .then(async () => $.store.set('stats', addStats(readStats(await $.store.get('stats')), delta)))
    .catch(() => undefined)
  return writes
}

// One turn of one loop (the main loop, or a subagent's), as far as respond is concerned.
type Book = { rejections: number; calls: number; isDelivered: boolean; deliveredIssues: number; isClosed: boolean }
const fresh = (): Book => ({ rejections: 0, calls: 0, isDelivered: false, deliveredIssues: 0, isClosed: false })
const loopOf = (agentId: string | undefined): string => agentId ?? 'main'

// What the closing step says: nothing a person can see.
const CLOSING = '\u200b'


export const register: Register = on => {
  // `tool.call` carries no turn id on this build, so a loop's turn is bounded by its own
  // `turn.start` and `turn.complete`; module state is enough because a reload mid-turn only
  // grants that turn a fresh two rejections.
  const books = new Map<string, Book>()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // An `enabled` or `level` key a pre-release build stored is ignored and cleared: only the session's
    // own state says how reply-tool is set (off at every start; a hot reload keeps what the session holds).
    await $.store.delete('enabled')
    await $.store.delete('level')
    await $.command.register({
      name: 'reply',
      description:
        'reply-tool: answer-first replies through the respond tool. off, or on with replies drawn as tldr, exec or full; no argument shows the setting',
      argumentHint: 'off|tldr|exec|full',
      immediate: true,
    })
    await $.command.register({
      name: 'reply_stats',
      description: 'reply-tool: show the counters: turns, structured replies, rejections',
    })
    await $.tool.register(toolSpec((await read($, mode)) !== 'off'))
    return started
  })

  // `/reply off|tldr|exec|full`; anything else prints the setting and the usage.
  on('command.run', { command: 'reply' }, async ($, e) => {
    const want = parseSetting(e.args)
    if (want === undefined) return { text: `reply-tool is set to ${await read($, mode)}. ${USAGE}` }
    const text = await setMode($, want)
    $.ui.toast(text)
    return { text }
  })

  on('command.run', { command: 'reply_stats' }, async $ => {
    const stats = readStats(await $.store.get('stats'))
    return { text: formatStats(stats, await read($, mode)) }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if ((await read($, mode)) === 'off') return composed
    return { sections: [...composed.sections, { id: CONTRACT_ID, text: CONTRACT, scope: 'session' }] }
  })

  on('turn.start', ($, e, next) => {
    books.set(loopOf(e.agentId), fresh())
    return next(e)
  })

  // A pattern, not the bare name: the tool names the engine lays in .claude-plugin/types list a connected
  // server's tools, and respond is this mod's own, so the name may be absent from them at type-check time.
  on('tool.call', { tool: /^mcp__reply-tool__respond$/ }, async ($, e) => {
    // respond is for the main conversation. A subagent's report goes to its spawner as written: a delivered
    // respond would leave that report empty, so the call is turned away before it is validated or counted.
    if (e.agentId !== undefined) {
      return {
        deny: 'respond is for the main conversation only. You are a subagent: write your report as plain text, in whatever form best serves the agent that spawned you.',
      }
    }

    // The reply is the call's own fields: take the reserved ones off.
    const input: Record<string, unknown> = { ...e }
    delete input.tool
    delete input.tool_use_id
    delete input.agentId
    delete input.requestMeta

    // Switched off, the tool is deferred and described as inactive; a call that still comes is turned away.
    const isOn = (await read($, mode)) !== 'off'
    if (!isOn) return { deny: 'respond is disabled (reply-tool is off). Do not call it again; write your reply as normal markdown.' }

    const key = loopOf(e.agentId)
    const book = books.get(key) ?? fresh()
    books.set(key, book)

    const issues = validateReply(input)
    book.calls += 1
    if (book.calls === 1 && issues.length === 0) await bump($, { firstCallPass: 1 })

    if (issues.length > 0 && book.rejections < MAX_REJECTIONS) {
      book.rejections += 1
      await bump($, { rejections: 1 })
      return { deny: rejectionText(issues) }
    }
    // Clean, or the turn's rejections are spent: accepted; the drawing and the counters note the issues.
    book.isDelivered = true
    book.isClosed = false
    book.deliveredIssues = issues.length
    return { result: 'delivered' }
  }).catch(($, e, next) => (next.called ? next(e) : { result: 'delivered' }))

  // After `delivered` the turn is over, but the model's next request would only come back with
  // thinking and no text, and the loop answers that with a "no visible output" nudge that makes the
  // model write the reply again. So that one step is answered here, with a zero-width space as its
  // text (an answer the loop accepts as visible) and no request is sent; the row is drawn as nothing.
  on('turn.step', async function* ($, e, next) {
    // Only the main loop is ever closed: a subagent's steps go to the model as they are.
    if (e.agentId !== undefined) return yield* next(e)
    const book = books.get(loopOf(e.agentId))
    if (book === undefined || !book.isDelivered || book.isClosed) return yield* next(e)
    book.isClosed = true
    yield { kind: 'text', index: 0, text: CLOSING }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: CLOSING, toolUses: [], stopReason: 'end_turn', usage: null }
  })

  on('turn.complete', async ($, e, next) => {
    const key = loopOf(e.agentId)
    const book = books.get(key)
    books.delete(key)
    // Only the main loop's turns that ended in an answer count: a subagent's report goes to its spawner.
    if (e.agentId === undefined && e.reason === 'answer' && (await read($, mode)) !== 'off') {
      const isDelivered = book !== undefined && book.isDelivered
      await bump($, {
        turns: 1,
        structured: isDelivered ? 1 : 0,
        unstructured: isDelivered ? 0 : 1,
        withIssues: book !== undefined && book.isDelivered && book.deliveredIssues > 0 ? 1 : 0,
      })
    }
    return next(e)
  })

  // The respond call's own row: the formatted reply, as the setting state holds it draws.
  on('ui.render', { component: 'ToolUse', props: { tool: 'mcp__reply-tool__respond' } }, async ($, e, next) => {
    // ctrl+o and an aborted call: the engine's own row, so the raw call stays inspectable.
    if (e.props.isExpanded === true || e.props.isInterrupted) return next(e)
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const issues = validateReply(e.props.input)

    if (e.props.isErrored) return <Text dimColor>{`respond rejected: ${issues.length} issue(s)`}</Text>

    // With the mod off a reply already in the transcript draws in full; so does the full setting.
    const setting = await read($, mode)
    const markdown = renderReply(e.props.input, viewOf(setting))
    if (markdown.trim() === '') return <Text dimColor>respond: the reply is empty</Text>

    const [head, ...rest] = replyFooter(setting, issues)
    return (
      <Box flexDirection="column">
        <Markdown text={markdown} />
        <Text dimColor>{head ?? ''}</Text>
        {rest.map(line => (
          <Text dimColor>{line}</Text>
        ))}
      </Box>
    )
  })

  // The closing row (a zero-width space) is drawn as nothing.
  on('ui.render', { component: 'AssistantMessage', props: { text: /^[\u200b\s]*\u200b[\u200b\s]*$/ } }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  // The result row says nothing: the reply above is the answer, `delivered` is plumbing.
  on('ui.render', { component: 'ToolResult', props: { tool: 'mcp__reply-tool__respond' } }, ($, e, next) => {
    if (e.props.isExpanded === true) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
}
