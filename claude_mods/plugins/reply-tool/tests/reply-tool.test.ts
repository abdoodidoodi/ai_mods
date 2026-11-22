import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CLOSING_MARK, CLOSING_MATCHER, WORKED_EXAMPLE, closingText, renderReply, validateReply } from '../hooks/reply'

const RESPOND = 'mcp__reply-tool__respond'

const SAMPLE = {
  answer: 'Partly: checkout is fixed, shipping waits on QA.',
  questions: [
    {
      ask: 'Does checkout still fail?',
      verdict: 'No, failures fell from 4% to 0.1%.',
      why: 'The retry covers timeouts.',
      details: 'Fix is in MR !441.',
    },
    { ask: 'Can we ship Friday?', verdict: 'Yes, if QA signs off Thursday.' },
  ],
  decisions: [
    {
      choice: 'Ship Friday?',
      pick: 'Ship, the risk is low.',
      options: [
        { name: 'Ship', consequence: '5 days sooner.', picked: true },
        { name: 'Wait', consequence: 'One more regression pass.', picked: false },
      ],
    },
  ],
  caveats: ['Safari 16 is untested.'],
  next: 'Want me to draft the QA request?',
  links: [{ label: 'Report', path: '/tmp/r.html' }],
  details: 'Full log attached.',
}

const LINK = '* Report: `/tmp/r.html` · [file:///tmp/r.html](file:///tmp/r.html)'

test('a sample reply renders as tldr, exec and full', () => {
  expect(renderReply(SAMPLE, 'tldr')).toBe(
    ['Partly: checkout is fixed, shipping waits on QA.', '★ **Ship Friday?** Ship, the risk is low.', LINK].join('\n\n'),
  )

  const exec = renderReply(SAMPLE, 'exec')
  expect(exec).toBe(
    [
      'Partly: checkout is fixed, shipping waits on QA.',
      '1. **Does checkout still fail?** No, failures fell from 4% to 0.1%.\n2. **Can we ship Friday?** Yes, if QA signs off Thursday.',
      '**Ship Friday?** ★ Ship, the risk is low.\n- ★ Ship: 5 days sooner.\n- Wait: One more regression pass.',
      '⚠ Safari 16 is untested.',
      'Want me to draft the QA request?',
      LINK,
    ].join('\n\n'),
  )

  expect(exec).not.toContain('The retry covers timeouts.')
  expect(exec).not.toContain('Fix is in MR')

  const full = renderReply(SAMPLE, 'full')
  expect(full).toContain('failures fell from 4% to 0.1%. The retry covers timeouts.\n\n   Fix is in MR !441.')
  expect(full.endsWith(`${LINK}\n\nFull log attached.`)).toBe(true)

  // An empty answer falls back to the verdicts as bullets as tldr.
  expect(renderReply({ ...SAMPLE, answer: '', decisions: [], links: [] }, 'tldr')).toBe(
    '- No, failures fell from 4% to 0.1%.\n- Yes, if QA signs off Thursday.',
  )
})

test('tldr draws each decision as star, bold choice, pick, and falls back when the choice is empty', () => {
  const [first] = SAMPLE.decisions
  const second = { ...first, choice: 'Notify users?', pick: 'Yes, a short note.' }
  const tldr = renderReply({ ...SAMPLE, answer: 'A', decisions: [first, second], links: [] }, 'tldr')
  expect(tldr).toContain('★ **Ship Friday?** Ship, the risk is low.')
  expect(tldr).toContain('★ **Notify users?** Yes, a short note.')
  expect(renderReply({ ...SAMPLE, answer: 'A', decisions: [{ ...first, choice: '' }], links: [] }, 'tldr')).toBe(
    'A\n\n★ Ship, the risk is low.',
  )
})

test('validation flags a bare id and a two-sentence verdict, and passes the worked example', () => {
  const issues = validateReply({
    answer: 'Yes.',
    questions: [
      { ask: 'Is it fixed?', verdict: 'Yes, in !441.' },
      { ask: 'Is it fast?', verdict: 'Yes, 2x faster. Ships Monday.' },
    ],
  })
  expect(issues).toEqual([
    'questions[0].verdict has a bare id "!441"',
    'questions[1].verdict has 2 sentences (max 1)',
  ])
  expect(validateReply(WORKED_EXAMPLE)).toEqual([])
  expect(validateReply({})).toEqual(['answer is missing'])
})

test('a link label renders as text, and only an absolute path or an http(s) URL is a link', () => {
  const links = [
    { label: '[Docs](https://evil.example)', path: 'javascript:alert(1)' },
    { label: 'Site', path: 'https://example.com/a b(1)' },
    { label: 'Report', path: '/tmp/r.html' },
  ]
  expect(renderReply({ answer: 'Done.', links }, 'tldr')).toBe(
    [
      'Done.',
      [
        '* \\[Docs\\]\\(https://evil.example\\): `javascript:alert(1)`',
        '* Site: [https://example.com/a%20b%281%29](https://example.com/a%20b%281%29)',
        '* Report: `/tmp/r.html` · [file:///tmp/r.html](file:///tmp/r.html)',
      ].join('\n'),
    ].join('\n\n'),
  )
  expect(validateReply({ ...WORKED_EXAMPLE, links })).toEqual(['links[0].path should be an absolute path or an http(s) URL'])
})

// What the engine's own turn.step and ui.render would answer, counted so a test sees when they are reached.
const engine = { steps: 0 }
const registered: { isDeferred: boolean | undefined; description: string }[] = []

const run = ($: Engine, command: string, args = '') =>
  $.command.run({ command, args } as Parameters<typeof $.command.run>[0])

// A respond call. The tool names the engine lays in .claude-plugin/types are a connected server's,
// and respond is this mod's own, so the name may be absent from them: the call is passed through a cast.
const respond = ($: Engine, input: Record<string, unknown>) =>
  ($.tool.call as unknown as (call: unknown) => Promise<{ deny?: string; result?: string }>)({ tool: RESPOND, ...input })

// An `enabled: true` a pre-release build stored sits in the store: reply-tool must ignore it.
const harness = (on: On, isStoreMocked = true) => {
  if (isStoreMocked) mock.store(on, { enabled: true })
  on('turn.step', async function* (_, e) {
    engine.steps += 1
    return { turnId: e.turnId, index: e.index, answer: 'model', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['engine'] })
  })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('tool.register', (_, e) => {
    registered.push({ isDeferred: e.isDeferred, description: e.description })
    return { value: { tool: RESPOND } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}

test('respond rejects a bad reply twice per turn, then accepts it; a clean reply is delivered; a subagent is turned away', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await run($, 'reply', 'exec')

  const bad = { answer: 'Yes.', questions: [{ ask: 'Done?', verdict: 'Done in !441.' }, { ask: 'Ok?', verdict: 'Yes.' }] }
  await $.turn.start({ text: 'q', turnId: 't1' })
  for (const round of [1, 2]) {
    const rejected = await respond($, bad)
    expect(rejected.deny, `rejection ${round}`).toContain('1 issue(s)')
    expect(rejected.deny).toContain('questions[0].verdict has a bare id "!441"')
  }
  // Before delivery a step goes to the model.
  const draw = async (index: number, loop: { turnId: string; agentId?: string } = { turnId: 't1' }) => {
    const step = $.turn.step({ ...loop, index, model: 'm', messageCount: 3 })
    let part = await step.next()
    while (part.done !== true) part = await step.next()
    return part.value
  }
  engine.steps = 0
  expect((await draw(0)).answer).toBe('model')
  const accepted = await respond($, bad)
  expect(accepted.deny).toBeUndefined()
  expect(accepted.result).toBe('delivered')
  // After delivery the next step is answered by the mod with an invisible text: no request, no nudge.
  const closing = await draw(1)
  expect(closing.answer).toBe(closingText(bad, 'full'))
  expect(closing.answer.startsWith(CLOSING_MARK)).toBe(true)
  expect(closing.toolUses).toEqual([])
  expect(engine.steps).toBe(1)

  // A subagent is left alone: its respond call is turned away, and its next step still goes to the model, unclosed.
  const sub = { turnId: 'ts', agentId: 'sub1' }
  await $.turn.start({ text: 'q', ...sub })
  const turnedAway = await respond($, { agentId: sub.agentId, answer: 'Yes, it works.' })
  expect(turnedAway.deny).toBe(
    'respond is for the main conversation only. You are a subagent: write your report as plain text, in whatever form best serves the agent that spawned you.',
  )
  expect(turnedAway.result).toBeUndefined()
  expect((await draw(0, sub)).answer).toBe('model')
  expect(engine.steps).toBe(2)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', ...sub })

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  // The next turn starts with two rejections again; a clean reply passes first time.
  await $.turn.start({ text: 'q', turnId: 't2' })
  const clean = await respond($, { answer: 'Yes, it works.' })
  expect(clean.result).toBe('delivered')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })

  // A third turn ends in plain text: not structured.
  await $.turn.start({ text: 'q', turnId: 't3' })
  await $.turn.complete({ answer: 'plain', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })

  const stats = await run($, 'reply_stats')
  expect(stats.text).toContain('turns while enabled: 3')
  expect(stats.text).toContain('structured (respond delivered): 2')
  expect(stats.text).toContain('not structured (plain-text fallback): 1')
  expect(stats.text).toContain('replies with at least 1 validation issue: 1')
  expect(stats.text).toContain('first respond call passed: 1')
  expect(stats.text).toContain('rejections: 2')
})

test('the respond row draws the reply in full while reply-tool is off, a rejected call one dim line, and the result nothing', async ($, on) => {
  harness(on)
  const ROW = {
    tool_use_id: 'tu1',
    tool: RESPOND,
    input: SAMPLE,
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  }
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const reply = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'ToolUse', props: ROW, requestId: 'tu1' })
    expect((await reply.find({ type: 'Markdown' }))?.text).toBe(renderReply(SAMPLE, 'full'))
    expect((await reply.find({ type: 'Text', text: /^full · \/reply tldr\|exec\|full$/ }))?.text).toBe('full · /reply tldr|exec|full')
    await reply.unmount()

    const bad = { ...ROW, isErrored: true, input: { answer: 'Done in !441.' } }
    const rejected = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'ToolUse', props: bad, requestId: 'tu2' })
    expect((await rejected.find({ type: 'Text' }))?.text).toBe('respond rejected: 1 issue(s)')
    await rejected.unmount()

    // ctrl+o: the engine's own row, so the raw call stays inspectable.
    const raw = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'ToolUse', props: { ...ROW, isExpanded: true }, requestId: 'tu3' })
    expect((await raw.find({ type: 'Text' }))?.text).toBe('engine')
    await raw.unmount()

    // The invisible closing text is drawn as nothing; any other assistant text is the engine's.
    const closing = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'AssistantMessage', props: { text: '\u200b', isFirstOfReply: false }, requestId: 'am1' })
    expect(await closing.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })
    await closing.unmount()
    const marked = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'AssistantMessage', props: { text: closingText(SAMPLE, 'exec'), isFirstOfReply: false }, requestId: 'am3' })
    expect(await marked.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })
    await marked.unmount()
    const plain = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'AssistantMessage', props: { text: 'hi', isFirstOfReply: true }, requestId: 'am2' })
    expect((await plain.find({ type: 'Text' }))?.text).toBe('engine')
    await plain.unmount()

    const result = { tool_use_id: 'tu1', tool: RESPOND, output: 'delivered', isErrored: false }
    const nothing = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'ToolResult', props: result, requestId: 'tu1' })
    expect(await nothing.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })
    await nothing.unmount()
  }
})

test('reply-tool starts off whatever was stored, /reply takes off|tldr|exec|full, and each setting redraws and re-registers as it should', async ($, on) => {
  // The store, kept by hand so the test sees what reaches it: `enabled` and `level` must only be cleared, never written.
  const kv = new Map<string, unknown>([['enabled', true], ['level', 3]])
  const writes: string[] = []
  on('store.get', (_, e) => ({ value: kv.get(e.key) }))
  on('store.set', (_, e) => (writes.push(e.key), kv.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (kv.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...kv.keys()] }))
  harness(on, false)
  registered.length = 0
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // The store held `enabled: true` and `level: 3`: ignored and cleared; the tool starts deferred and inactive.
  expect(registered.at(-1)?.isDeferred).toBe(true)
  expect(registered.at(-1)?.description).toContain('Inactive')
  expect(kv.has('enabled')).toBe(false)
  expect(kv.has('level')).toBe(false)

  // No argument, or one that is not off|tldr|exec|full: the setting and the usage, nothing changes.
  const usage = 'reply-tool is set to off. Usage: /reply off|tldr|exec|full'
  for (const args of ['', 'maybe', 'exec now']) expect((await run($, 'reply', args)).text).toBe(usage)
  expect((await run($, 'reply', 'off')).text).toBe('reply-tool is already set to off.')
  expect(registered).toHaveLength(1)

  // exec turns the mod on and registers the tool active; tldr and full only redraw; off defers the tool again.
  expect((await run($, 'reply', 'exec')).text).toContain('reply-tool is ON (exec)')
  expect(registered.at(-1)?.isDeferred).toBe(false)
  expect(registered).toHaveLength(2)

  const row = { tool_use_id: 'tu1', tool: RESPOND, input: SAMPLE, isRunning: false, isErrored: false, isInterrupted: false }
  const ui = await $.ui.mount({ plugin: 'reply-tool', surface: 'terminal', component: 'ToolUse', props: row, requestId: 'tu1' })
  const footer = async () => (await ui.find({ type: 'Text', text: /\/reply/ }))?.text
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(renderReply(SAMPLE, 'exec'))
  expect(await footer()).toBe('exec · /reply off|tldr|exec|full')

  expect((await run($, 'reply', 'tldr')).text).toContain('tldr')
  await ui.redraw()
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(renderReply(SAMPLE, 'tldr'))
  expect(await footer()).toBe('tldr · /reply off|tldr|exec|full')
  expect(registered).toHaveLength(2)

  // full while on: the drawing only (the tool stays as registered), everything drawn, and an ON mod's footer, which offers off.
  expect((await run($, 'reply', 'full')).text).toBe('reply-tool now draws replies as full.')
  await ui.redraw()
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(renderReply(SAMPLE, 'full'))
  expect(await footer()).toBe('full · /reply off|tldr|exec|full')
  expect(registered).toHaveLength(2)
  expect((await run($, 'reply', 'full')).text).toBe('reply-tool is already set to full.')
  const flagged = { ...row, input: { answer: 'Done in !441.' } }
  const issues = await $.ui.mount({ plugin: 'reply-tool', surface: 'terminal', component: 'ToolUse', props: flagged, requestId: 'tu4' })
  expect(await issues.find({ type: 'Text', text: 'full · /reply off|tldr|exec|full · off-pattern: 1 issue(s)' })).toBeDefined()
  expect(await issues.find({ type: 'Text', text: '  - answer has a bare id "!441"' })).toBeDefined()
  await issues.unmount()

  expect((await run($, 'reply', 'off')).text).toContain('reply-tool is OFF')
  expect(registered.at(-1)?.isDeferred).toBe(true)
  await ui.redraw()
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(renderReply(SAMPLE, 'full'))
  expect(await footer()).toBe('full · /reply tldr|exec|full')
  await ui.unmount()
  expect(writes).toEqual([])

  // Turning it on from off needs nothing else: full turns it on like tldr and exec.
  expect((await run($, 'reply', 'full')).text).toContain('reply-tool is ON (full)')
  expect(registered.at(-1)?.isDeferred).toBe(false)
  expect((await run($, 'reply_stats')).text).toContain('is set to full')
})

test('a respond call while reply-tool is off is turned away for good', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await respond($, { answer: 'Yes.' })).deny).toBe(
    'respond is disabled (reply-tool is off). Do not call it again; write your reply as normal markdown.',
  )

  // Once on, the same call is delivered.
  await run($, 'reply', 'exec')
  expect((await respond($, { answer: 'Yes.' })).result).toBe('delivered')
})

test('the closing text is the marked reply at the view, and only a marked or bare closing text is hidden', () => {
  for (const view of ['tldr', 'exec', 'full'] as const) {
    const text = closingText(SAMPLE, view)
    expect(text).toBe(CLOSING_MARK + renderReply(SAMPLE, view).trim())
    expect(CLOSING_MATCHER.test(text)).toBe(true)
  }
  expect(closingText(SAMPLE, 'tldr')).not.toBe(closingText(SAMPLE, 'full'))
  // An empty reply falls back to the bare invisible text.
  expect(closingText({}, 'exec')).toBe('​')
  expect(CLOSING_MATCHER.test('​')).toBe(true)
  expect(CLOSING_MATCHER.test('hi')).toBe(false)
  expect(CLOSING_MATCHER.test('hello ​⁠​')).toBe(false)
})
