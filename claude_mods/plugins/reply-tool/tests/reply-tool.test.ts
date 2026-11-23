import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

type Mounted = Awaited<ReturnType<Engine['ui']['mount']>>

import { CLOSING_MARK, CLOSING_MATCHER, REPLY_SCHEMA, WORKED_EXAMPLE, boldLabel, closingText, indicatorText, renderReply, validateReply, viewBlocks } from '../hooks/reply'

const RESPOND = 'mcp__reply-tool__respond'

const SAMPLE = {
  answer: 'Checkout is fixed; one call needed on the release date.',
  questions: [
    {
      ask: 'Does checkout still fail on Safari?',
      verdict: 'No, the failure rate fell from 4% to 0.1%.',
      why: 'The retry now covers the timeout path',
      details: 'The timeout path was the only one that dropped the session.\n- Fix: retry wrapper in `checkout/pay.ts`\n- MR !441',
    },
    { ask: 'Can we ship Friday?', verdict: 'Yes, if QA signs off by Thursday.' },
  ],
  decisions: [
    {
      choice: 'Ship Friday or wait a week?',
      pick: 'Ship Friday, the risk is low.',
      options: [
        { name: 'Wait a week', consequence: 'One more regression pass.', stance: 'option' },
        { name: 'Ship Friday', consequence: 'Customers get the fix 5 days sooner.', stance: 'recommended' },
        { name: 'Skip QA', consequence: 'Ships today with no regression check.', stance: 'not_recommended' },
      ],
    },
  ],
  caveats: ['Safari 16 was not tested.'],
  details: [
    '**Rollout**',
    '- **Canary**: 5% on Thursday',
    '  - Watch the error dashboard for 2 hours',
    '- **Full**: Friday 10:00',
    '',
    '**Risks**',
    '- **Old sessions**: carts opened before the deploy keep the old code',
    '  - They expire within 24 hours',
  ].join('\n'),
  next: 'Want me to draft the QA sign-off request?',
  links: [{ label: 'Test report', path: '/home/me/reports/checkout.html' }],
}

const HEAD = '**Checkout is fixed; one call needed on the release date.**'
const Q1 = '**Does checkout still fail on Safari?** No, the failure rate fell from 4% to 0.1%.'
const WHY = '- **The retry now covers the timeout path**'
const Q2 = '**Can we ship Friday?** Yes, if QA signs off by Thursday.'
const D1 = '**Ship Friday or wait a week?** Ship Friday, the risk is low.'
const LINK = '- [Test report](file:///home/me/reports/checkout.html)'
const DECISION = [
  D1,
  '- [Recommended] **Ship Friday**: Customers get the fix 5 days sooner.',
  '- **Wait a week**: One more regression pass.',
  '- **Skip QA**: Ships today with no regression check.',
].join('\n')

const TLDR = [HEAD, Q1, Q2, D1, LINK].join('\n\n')

const EXEC = [
  HEAD,
  [Q1, WHY].join('\n'),
  Q2,
  DECISION,
  '⚠ Safari 16 was not tested.',
  '**Rollout**\n- **Canary**: 5% on Thursday\n- **Full**: Friday 10:00',
  '**Risks**\n- **Old sessions**: carts opened before the deploy keep the old code',
  '→ Want me to draft the QA sign-off request?',
  '**Links**\n' + LINK,
].join('\n\n')

const FULL = [
  HEAD,
  [
    Q1,
    WHY + ': The timeout path was the only one that dropped the session.',
    '  - **Fix**: retry wrapper in `checkout/pay.ts`',
    '  - MR !441',
  ].join('\n'),
  Q2,
  DECISION,
  '⚠ Safari 16 was not tested.',
  '**Rollout**\n- **Canary**: 5% on Thursday\n  - Watch the error dashboard for 2 hours\n- **Full**: Friday 10:00',
  '**Risks**\n- **Old sessions**: carts opened before the deploy keep the old code\n  - They expire within 24 hours',
  '→ Want me to draft the QA sign-off request?',
  '**Links**\n' + LINK,
].join('\n\n')

const lines = (text: string): string[] =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => line.trimEnd())

test('the fixture renders as exactly this markdown in tldr, exec and full', () => {
  expect(renderReply(SAMPLE, 'tldr')).toBe(TLDR)
  expect(renderReply(SAMPLE, 'exec')).toBe(EXEC)
  expect(renderReply(SAMPLE, 'full')).toBe(FULL)
  for (const view of ['tldr', 'exec', 'full'] as const) {
    const md = renderReply(SAMPLE, view)
    expect(md).not.toMatch(/\/reply|exec ·|tldr ·|full ·|Decision|^>/m)
    // Exactly one blank line between blocks, and none inside a list.
    expect(md).not.toMatch(/\n\n\n/)
    if (view !== 'tldr') expect(md).not.toMatch(/\n\n- /)
  }
})

test('the views are one outline: every line of tldr is in exec, and of exec in full, in order; links come last', () => {
  // A bullet head may grow in the bigger view: its full form starts with the smaller view's line.
  const inOrder = (small: string[], big: string[]) => {
    let at = 0
    for (const line of small) {
      const found = big.findIndex((b, i) => i >= at && (b === line || b.startsWith(line + ': ')))
      expect(found, line).toBeGreaterThanOrEqual(0)
      at = found + 1
    }
  }
  const [tldr = [], exec = [], full = []] = (['tldr', 'exec', 'full'] as const).map(view => lines(renderReply(SAMPLE, view)))
  inOrder(tldr, exec)
  inOrder(exec, full)
  expect(tldr).not.toContain('**Links**')
  expect(exec).toContain('**Links**')
  for (const view of [tldr, exec, full]) expect(view.at(-1)).toBe(LINK)
  expect(viewBlocks(SAMPLE, 'tldr')).toHaveLength(5)
})

test('the recommended option is first with a [Recommended] prefix, wherever it was given; picked replies still draw', () => {
  const exec = renderReply(SAMPLE, 'exec')
  expect(exec).toContain(D1 + '\n- [Recommended] **Ship Friday**:')
  expect(exec.indexOf('Wait a week**')).toBeLessThan(exec.indexOf('Skip QA**'))
  expect(exec).not.toContain('Ship Friday [Recommended]')
  const old = {
    answer: 'A.',
    decisions: [{ choice: 'Go?', pick: 'Yes.', options: [{ name: 'Stay', consequence: 'd.', picked: false }, { name: 'Go', consequence: 'c.', picked: true }] }],
  }
  expect(renderReply(old, 'exec')).toBe('**A.**\n\n**Go?** Yes.\n- [Recommended] **Go**: c.\n- **Stay**: d.')
  expect(renderReply(old, 'tldr')).toBe('**A.**\n\n**Go?** Yes.')
})

test('a bullet of the form Label: text gets a bold label; a time, a URL, a code label or a long label does not', () => {
  expect(boldLabel('Fix: retry wrapper')).toBe('**Fix**: retry wrapper')
  expect(boldLabel('Built by Codex:')).toBe('**Built by Codex**:')
  expect(boldLabel('Full: Friday 10:00')).toBe('**Full**: Friday 10:00')
  expect(boldLabel('Friday 10:00')).toBe('Friday 10:00')
  expect(boldLabel('Meet at 10:00 sharp')).toBe('Meet at 10:00 sharp')
  expect(boldLabel('**Done**: already')).toBe('**Done**: already')
  expect(boldLabel('See `a: b`')).toBe('See `a: b`')
  expect(boldLabel('https://x.test/a: b')).toBe('https://x.test/a: b')
  expect(boldLabel('one two three four five six seven: too long')).toBe('one two three four five six seven: too long')
  const md = renderReply({ answer: 'A', details: '**S**\n- Rate: 5%\n- Starts 10:00\n  - Inner: note\n\nA plain paragraph: not bolded' }, 'full')
  expect(md).toContain('- **Rate**: 5%')
  expect(md).toContain('- Starts 10:00')
  expect(md).toContain('  - **Inner**: note')
  expect(md).toContain('A plain paragraph: not bolded')
})

test('details prune by depth: headings and top-level bullets in exec, nested and fenced-under-bullet material only in full', () => {
  const details = ['# Plan', '- step one', '  - sub step', '  ```', '  code under bullet', '  ```', '- step two', '', 'A paragraph.', '', '| a | b |', '| - | - |'].join('\n')
  expect(renderReply({ answer: 'A', details }, 'exec')).toBe('**A**\n\n# Plan\n- step one\n- step two\n\nA paragraph.\n\n| a | b |\n| - | - |')
  const full = renderReply({ answer: 'A', details }, 'full')
  expect(full).toContain('- step one\n  - sub step\n  ```\n  code under bullet\n  ```\n- step two')
  expect(renderReply({ answer: 'A', details }, 'tldr')).toBe('**A**')
})

test('a headline-less reply, and a bold the model wrote itself', () => {
  expect(renderReply({ answer: 'One line.' }, 'exec')).toBe('**One line.**')
  expect(renderReply({ answer: 'Has **already** bold' }, 'exec')).toBe('Has **already** bold')
  expect(renderReply({ answer: '', questions: [{ ask: 'Q?', verdict: 'V.' }, { ask: 'R?', verdict: 'W.' }] }, 'tldr')).toBe('**Q?** V.\n\n**R?** W.')
  // The closing text opens with an invisible marker; a bold that starts on punctuation gets a space so it still renders.
  expect(closingText({ answer: '"Yes" it is.' }, 'exec')).toBe(CLOSING_MARK + ' **"Yes" it is.**')
  expect(closingText({ answer: 'Yes it is.' }, 'exec')).toBe(CLOSING_MARK + '**Yes it is.**')
})

test('stance validation: exactly one recommended per decision, a known value on every option, picked no longer accepted', () => {
  const withOptions = (options: unknown[]) => ({ answer: 'Ok.', decisions: [{ choice: 'Go?', pick: 'Yes.', options }] })
  const o = (stance: string) => ({ name: 'A', consequence: 'c.', stance })
  expect(validateReply(withOptions([o('recommended'), o('option'), o('not_recommended')]))).toEqual([])
  expect(validateReply(withOptions([o('option'), o('option')]))).toEqual(['decisions[0] has no option with stance recommended'])
  expect(validateReply(withOptions([o('recommended'), o('recommended')]))).toEqual([
    'decisions[0] has 2 options with stance recommended (exactly 1)',
  ])
  expect(validateReply(withOptions([o('recommended'), o('green')]))).toEqual([
    'decisions[0].options[1].stance should be one of recommended, option, not_recommended',
  ])
  const legacy = [{ name: 'A', consequence: 'c.', picked: true }, { name: 'B', consequence: 'c.', picked: false }]
  expect(validateReply(withOptions(legacy)).length).toBeGreaterThan(0)
  const props = REPLY_SCHEMA.properties.decisions.items.properties.options.items.properties as Record<string, unknown>
  expect(Object.keys(props)).toEqual(['name', 'consequence', 'stance'])
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
  expect(renderReply(WORKED_EXAMPLE, 'exec')).toBe(EXEC)
  expect(validateReply({})).toEqual(['answer is missing'])
})

const why1 = (question: Record<string, unknown>) => ({ answer: 'A.', questions: [{ ask: 'Q?', verdict: 'V.', ...question }, { ask: 'R?', verdict: 'W.' }] })

test('why is one line that states the reason: a generic label, a colon or a second sentence is rejected', () => {
  expect(validateReply(why1({ why: 'JSON fails loudly; YAML can change values silently' }))).toEqual([])
  for (const label of ['Why', 'why:', 'Because', 'Reason.', 'Details', 'The reason']) {
    expect(validateReply(why1({ why: label })), label).toEqual([`questions[0].why is a generic label ("${label}"): write the reason itself as a one-line headline`])
  }
  expect(validateReply(why1({ why: 'Because of this:' }))).toHaveLength(1)
  expect(validateReply(why1({ why: 'Reason: it is faster' }))).toEqual(['questions[0].why has a colon: write one headline sentence that states the reason'])
  expect(validateReply(why1({ why: 'It is faster. It is also safer.' }))).toEqual(['questions[0].why has 2 sentences (max 1)'])
  expect(validateReply(why1({ why: 'Meets at 10:00 sharp' }))).toEqual([])
})

test('details without a why are the questions own bullets in full only; with a why, prose follows the headline and lists nest', () => {
  const noWhy = why1({ details: 'Some prose.\n- **Pick**: JSON\n  - nested\n- plain' })
  expect(renderReply(noWhy, 'exec')).toBe('**A.**\n\n**Q?** V.\n\n**R?** W.')
  expect(renderReply(noWhy, 'full')).toBe('**A.**\n\n**Q?** V.\n- Some prose.\n- **Pick**: JSON\n  - nested\n- plain\n\n**R?** W.')
  const both = why1({ why: 'JSON fails loudly', details: 'No coercion traps.\n- **Pick JSON when**: machines write it\n- Pick YAML when: humans edit it' })
  expect(renderReply(both, 'exec')).toBe('**A.**\n\n**Q?** V.\n- **JSON fails loudly**\n\n**R?** W.')
  expect(renderReply(both, 'full')).toBe(
    '**A.**\n\n**Q?** V.\n- **JSON fails loudly**: No coercion traps.\n  - **Pick JSON when**: machines write it\n  - **Pick YAML when**: humans edit it\n\n**R?** W.',
  )
})

test('an old multi-sentence why draws its first sentence as the headline, the rest then the old details in full only', () => {
  const old = why1({ why: 'The retry covers the timeout path. It was the only gap, e.g. 5 files.', details: '- Fix: wrapper' })
  expect(renderReply(old, 'exec')).toContain('**Q?** V.\n- **The retry covers the timeout path**\n')
  expect(renderReply(old, 'full')).toContain('- **The retry covers the timeout path**: It was the only gap, e.g. 5 files.\n  - **Fix**: wrapper')
})

test('no generic Why or Details label is ever drawn, in any view', () => {
  for (const input of [SAMPLE, why1({ why: 'Short reason', details: 'x' }), why1({ details: 'x\n- y' }), why1({ why: 'A. B.', details: '- c' })]) {
    for (const view of ['tldr', 'exec', 'full'] as const) {
      expect(renderReply(input, view)).not.toMatch(/\*\*(Why|Details)\*\*/i)
    }
  }
})

test('links draw as just the label: [label](url), no path text; only an absolute path or an http(s) URL is a link', () => {
  const links = [
    { label: '[Docs](https://evil.example)', path: 'javascript:alert(1)' },
    { label: 'Site', path: 'https://example.com/a b(1)' },
    { label: 'Report', path: '/tmp/r.html' },
  ]
  const list = [
    '- \\[Docs\\]\\(https://evil.example\\): `javascript:alert(1)`',
    '- [Site](https://example.com/a%20b%281%29)',
    '- [Report](file:///tmp/r.html)',
  ].join('\n')
  expect(renderReply({ answer: 'Done.', links }, 'tldr')).toBe('**Done.**\n\n' + list)
  // exec and full carry a bold Links heading; tldr has none.
  expect(renderReply({ answer: 'Done.', links }, 'exec')).toBe('**Done.**\n\n**Links**\n' + list)
  expect(renderReply({ answer: 'Done.', links }, 'tldr')).not.toContain('Links')
  expect(validateReply({ ...WORKED_EXAMPLE, links })).toEqual(['links[0].path should be an absolute path or an http(s) URL'])
})

test('Windows drive and UNC paths are accepted and drawn as file URLs behind their labels', () => {
  const links = [
    { label: 'A', path: 'C:\\Users\\Me\\My Report.html' },
    { label: 'B', path: 'C:/Users/Me/r(1).html' },
    { label: 'C', path: '\\\\srv\\share\\a b.txt' },
  ]
  expect(validateReply({ ...WORKED_EXAMPLE, links })).toEqual([])
  const out = renderReply({ answer: 'Done.', links }, 'tldr')
  expect(out).toContain('- [A](file:///C:/Users/Me/My%20Report.html)')
  expect(out).toContain('- [B](file:///C:/Users/Me/r%281%29.html)')
  expect(out).toContain('- [C](file://srv/share/a%20b.txt)')
  expect(out).not.toContain('C:\\')
  expect(validateReply({ ...WORKED_EXAMPLE, links: [{ label: 'x', path: 'C:relative' }] })).toHaveLength(1)
})

test('literal backslash-n escapes become real line breaks, except in code spans or when real newlines exist', () => {
  expect(renderReply({ answer: 'a\\r\\nb\\tc' }, 'full')).toBe('**a**  \n**b\tc**')
  expect(renderReply({ answer: 'Run `printf "a\\nb"`\\nDone' }, 'full')).toBe('**Run `printf "a\\nb"`**  \n**Done**')
  const full = renderReply({ answer: 'A', questions: [{ ask: 'Q?', verdict: 'V.', details: 'x\\ny' }, { ask: 'R?', verdict: 'W.' }], details: 'p\\nq' }, 'full')
  expect(full).toContain('**Q?** V.\n- x\n- y')
  expect(full.endsWith('p  \nq')).toBe(true)
  // A Windows path in a link is never touched.
  expect(renderReply({ answer: 'A', links: [{ label: 'L', path: 'C:\\new\\tmp.html' }] }, 'tldr')).toContain('(file:///C:/new/tmp.html)')
})

// What the engine's own turn.step and ui.render would answer, counted so a test sees when they are reached.
const engine = { steps: 0 }
const registered: { isDeferred: boolean | undefined; description: string }[] = []
// Every `$.ui.status` call, in order: the bottom-bar indicator.
const statuses: (string | undefined)[] = []

const run = ($: Engine, command: string, args = '') =>
  $.command.run({ command, args } as Parameters<typeof $.command.run>[0])

// A respond call. The tool names the engine lays in .claude-plugin/types are a connected server's,
// and respond is this mod's own, so the name may be absent from them: the call is passed through a cast.
const respond = ($: Engine, input: Record<string, unknown>) =>
  ($.tool.call as unknown as (call: unknown) => Promise<{ deny?: string; result?: string }>)({ tool: RESPOND, ...input })

// The terminal draws the outline: a top margin, one column per block, markdown lines, options colored by stance, links as labels.
const expectTerminalReply = async (ui: Mounted, view: 'tldr' | 'exec' | 'full') => {
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { marginTop: 1 } })
  const markdown = (await ui.findAll({ type: 'Markdown' })).map(node => node.text).join('\n\n')
  expect(markdown).toContain(HEAD)
  expect(markdown).toContain(D1)
  expect(markdown).not.toContain('file:///')
  expect(markdown).not.toContain('Decision')
  expect(JSON.stringify(await ui.drawn())).not.toContain('cyan')
  expect(markdown.includes(WHY)).toBe(view !== 'tldr')
  expect(markdown.includes(WHY + ': The timeout path was')).toBe(view === 'full')
  expect(markdown).not.toMatch(/\*\*(Why|Details)\*\*/)
  expect(markdown.includes('  - Watch the error dashboard')).toBe(view === 'full')
  const props = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.props
  if (view === 'tldr') {
    expect(await props(/Recommended/)).toBeUndefined()
    expect(markdown).not.toContain('Links')
  } else {
    expect(await props(/^\[Recommended\] $/)).toMatchObject({ color: 'green', weight: 'bold' })
    expect(await props(/^Ship Friday$/)).toMatchObject({ color: 'green', weight: 'bold' })
    expect(await props(/^Wait a week$/)).toMatchObject({ color: 'blue', weight: 'bold' })
    expect(await props(/^Skip QA$/)).toMatchObject({ color: 'red', weight: 'bold' })
    expect(markdown).toContain('**Links**')
    expect(await props(/^: Customers get the fix 5 days sooner.$/)).toBeDefined()
  }
  expect((await ui.find({ type: 'Link' }))?.props).toMatchObject({ href: 'file:///home/me/reports/checkout.html' })
}

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
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
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

test('the respond row draws the reply in full while reply-tool is off with no footer, a rejected or running call nothing, and the result nothing', async ($, on) => {
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
    if (surface === 'terminal') {
      await expectTerminalReply(reply, 'full')
    } else {
      expect((await reply.find({ type: 'Markdown' }))?.text).toBe(FULL)
    }
    expect(await reply.find({ type: 'Text', text: /\/reply|full ·/ })).toBeUndefined()
    await reply.unmount()

    // A rejected call is an errored row in the transcript (live and on a redraw or resume): it draws nothing, not the
    // reply and not a `respond rejected` line. A call still running draws nothing either.
    for (const state of [{ isErrored: true }, { isRunning: true }]) {
      const hidden = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'ToolUse', props: { ...ROW, ...state, input: { answer: 'Done in !441.' } }, requestId: 'tu2' })
      expect(await hidden.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })
      expect(await hidden.find({ type: 'Text' })).toBeUndefined()
      expect(await hidden.find({ type: 'Markdown' })).toBeUndefined()
      await hidden.unmount()
    }
    // ctrl+o on a rejected call still shows the engine's own row, so the raw call stays inspectable.
    const inspected = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'ToolUse', props: { ...ROW, isErrored: true, isExpanded: true }, requestId: 'tu5' })
    expect((await inspected.find({ type: 'Text' }))?.text).toBe('engine')
    await inspected.unmount()

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
  // No view footer under a reply, whatever the setting; the setting shows in the bottom-bar indicator instead.
  const footer = async () => (await ui.find({ type: 'Text', text: /\/reply|·/ }))?.text
  await expectTerminalReply(ui, 'exec')
  expect(await footer()).toBeUndefined()
  expect(statuses.at(-1)).toBe('exec')

  expect((await run($, 'reply', 'tldr')).text).toContain('tldr')
  await ui.redraw()
  await expectTerminalReply(ui, 'tldr')
  expect(await footer()).toBeUndefined()
  expect(statuses.at(-1)).toBe('tldr')
  expect(registered).toHaveLength(2)

  // full while on: the drawing only (the tool stays as registered), everything drawn, and an ON mod's footer, which offers off.
  expect((await run($, 'reply', 'full')).text).toBe('reply-tool now draws replies as full.')
  await ui.redraw()
  await expectTerminalReply(ui, 'full')
  expect(await footer()).toBeUndefined()
  expect(statuses.at(-1)).toBe('full')
  expect(registered).toHaveLength(2)
  expect((await run($, 'reply', 'full')).text).toBe('reply-tool is already set to full.')
  // An accepted reply that still has issues draws just the reply: no footer, no issue list.
  const flagged = { ...row, input: { answer: 'Done in !441.' } }
  const issues = await $.ui.mount({ plugin: 'reply-tool', surface: 'terminal', component: 'ToolUse', props: flagged, requestId: 'tu4' })
  expect((await issues.find({ type: 'Markdown' }))?.text).toBe('**Done in !441.**')
  expect(await issues.find({ type: 'Text' })).toBeUndefined()
  await issues.unmount()

  expect((await run($, 'reply', 'off')).text).toContain('reply-tool is OFF')
  expect(registered.at(-1)?.isDeferred).toBe(true)
  await ui.redraw()
  await expectTerminalReply(ui, 'full')
  expect(await footer()).toBeUndefined()
  // Off: the indicator is cleared.
  expect(statuses.at(-1)).toBeUndefined()
  await ui.unmount()
  expect(writes).toEqual([])

  // Turning it on from off needs nothing else: full turns it on like tldr and exec.
  expect((await run($, 'reply', 'full')).text).toContain('reply-tool is ON (full)')
  expect(statuses.at(-1)).toBe('full')
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

test('the indicator reads <setting> while on and nothing while off', () => {
  expect(indicatorText('off')).toBeUndefined()
  for (const mode of ['tldr', 'exec', 'full'] as const) expect(indicatorText(mode)).toBe(mode)
})
