import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

type Mounted = Awaited<ReturnType<Engine['ui']['mount']>>

import {
  CLOSING_MARK,
  CLOSING_MATCHER,
  CONTRACT,
  HEAD_UNITS,
  ICONS,
  LEVELS,
  MAX_HEAD_WORDS,
  MIN_HEAD_WORDS,
  REPLY_SCHEMA,
  WORKED_EXAMPLE,
  boldLabel,
  closingText,
  indicatorText,
  lineMarkdown,
  renderReply,
  toolSpec,
  validateReply,
  viewBlocks,
} from '../hooks/reply'

const RESPOND = 'mcp__reply-tool__respond'

// The worked example is the fixture: every view of it is written out below.
const HEAD = '● **Safari checkout is fixed and ready to release. The retry now covers the timeout path, which cut failures from 4% to 0.1%.**'
// The decision line shows the recommended option's head as its pick.
const PICK = 'Canary on Thursday, then everyone on Friday after a two hour watch'
const D1 = `◇ **How should we release the fix?** ${PICK}`
const LINK = '- [Test report](file:///home/me/reports/checkout.html)'
const CAVEAT = '⚠ Safari 16 was not tested.'
const CAVEAT_DETAILS = '- Only Safari 17 and 18 were in the lab, so the timeout path is untested on the older engine.'
// As markdown (Desktop, VS Code, mobile, the closing text) a head with lines under it is a list item and those lines
// nest two spaces in; the terminal indents them with a box instead, so its constants stay flat.
const nest = (head: string, ...rest: string[]): string => [`- ${head}`, ...rest.map(row => `  ${row}`)].join('\n')

const SECTION_1 = '≡ **Why it broke**'
const L1_1 = '- **Safari dropped the session whenever the payment call timed out**'
const L1_1_TAIL = ': no other browser was affected.'
const L2_1 = '  - **The retry wrapper now covers that path with two attempts and a short backoff**: the second attempt reuses the original session.'
const L3_1 = '    - Fix: retry wrapper in `checkout/pay.ts`, MR !441. Failure rate before 4%, after 0.1%. Measured on the staging mirror. Sampled hourly for 24 hours.'
const SECTION_2 = '≡ **Rollout plan**'
const L1_2 = '- **Canary goes to five percent of traffic on Thursday morning**'
const L1_2_TAIL = ': it is watched for two hours.'
const L2_2 = '  - **Full rollout starts on Friday at 10:00 if the canary stays clean**: QA signs off before that.'
const TABLE = ['    | Stage | Traffic | When |', '    | --- | --- | --- |', '    | Canary | 5% | Thursday |', '    | Full | 100% | Friday 10:00 |']

const OPTION_HEADS = [
  `- [Recommended] **${PICK}**`,
  '- **Wait a week and run the full regression pass first**',
  '- **Ship today to everyone and skip the QA sign-off entirely**',
]
const OPTION_BODIES = [
  ': Customers get the fix 5 days sooner, after a canary that is watched first.',
  ': Adds one more regression pass. Customers wait the extra week.',
  ': Fastest, but nobody checks the timeout path for regressions.',
]
const DECISION = nest(D1, ...OPTION_HEADS)
const S1_FULL = nest(SECTION_1, L1_1 + L1_1_TAIL, L2_1, L3_1)

// tldr: the headline, the decision pick, the links; no Links heading.
const TLDR = [HEAD, D1, LINK].join('\n\n')

// exec: tldr plus the section headings and L1 heads (no tails), every option head, the caveat text and the Links heading.
const EXEC = [HEAD, nest(SECTION_1, L1_1), nest(SECTION_2, L1_2), DECISION, CAVEAT, nest('↗ **Links**', LINK)].join('\n\n')

// full: exec plus the L1 tails, L2 and L3 (a table here), the option bodies and the caveat details.
const FULL = [
  HEAD,
  S1_FULL,
  nest(SECTION_2, L1_2 + L1_2_TAIL, L2_2, ...TABLE),
  nest(D1, ...OPTION_HEADS.map((head, i) => head + (OPTION_BODIES[i] ?? ''))),
  nest(CAVEAT, CAVEAT_DETAILS),
  nest('↗ **Links**', LINK),
].join('\n\n')

// A reply from before 0.1.14, as a transcript still holds it: `status`, `details`, `next` and `summary`, and (before
// 0.1.13) `questions` and `decisions[]` with a `pick`.
const LEGACY = {
  headline: 'Checkout fixed; ship Friday',
  summary: 'The retry now covers the timeout path.',
  status: '**Waiting on you**\n- **QA sign-off**: needed by Thursday\n  - Regression suite is green',
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
      pick: 'Ship Friday',
      options: [
        { name: 'Wait a week', consequence: 'One more regression pass.', stance: 'option' },
        { name: 'Ship Friday', consequence: 'Customers get the fix 5 days sooner.', stance: 'recommended' },
      ],
    },
  ],
  caveats: ['Safari 16 was not tested.'],
  details: '**Rollout**\n- **Canary**: 5% on Thursday\n  - Watch the error dashboard for 2 hours',
  next: 'Want me to draft the QA sign-off request?',
  links: [{ label: 'Test report', path: '/home/me/reports/checkout.html' }],
}

const lines = (text: string): string[] =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => line.trimEnd())

// A line without its indent or list marker: a head alone in a smaller view is a paragraph, with lines under it in a bigger view a list item.
const bare = (line: string): string => line.trim().replace(/^- /, '')

// `n` distinct words, so a head or a tail of a given length is easy to write.
const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

test('the worked example renders as exactly this markdown in tldr, exec and full', () => {
  expect(validateReply(WORKED_EXAMPLE)).toEqual([])
  expect(renderReply(WORKED_EXAMPLE, 'tldr')).toBe(TLDR)
  expect(renderReply(WORKED_EXAMPLE, 'exec')).toBe(EXEC)
  expect(renderReply(WORKED_EXAMPLE, 'full')).toBe(FULL)
  for (const view of ['tldr', 'exec', 'full'] as const) {
    const md = renderReply(WORKED_EXAMPLE, view)
    expect(md).not.toMatch(/\/reply|exec ·|tldr ·|full ·|Decision|^>/m)
    // Exactly one blank line between blocks, and none inside a list.
    expect(md).not.toMatch(/\n\n\n/)
    // A nested list item never follows a blank line (a head opens its block, so a top-level item may).
    if (view !== 'tldr') expect(md).not.toMatch(/\n\n {2,}- /)
  }
})

test('the views are one outline: every line of tldr is in exec, and of exec in full, in order; links come last', () => {
  // A head may grow in the bigger view: its full form starts with the smaller view's line.
  const inOrder = (small: string[], big: string[]) => {
    let at = 0
    for (const line of small) {
      const found = big.findIndex((b, i) => i >= at && (bare(b) === bare(line) || bare(b).startsWith(bare(line) + ': ')))
      expect(found, line).toBeGreaterThanOrEqual(0)
      at = found + 1
    }
  }
  const [tldr = [], exec = [], full = []] = (['tldr', 'exec', 'full'] as const).map(view => lines(renderReply(WORKED_EXAMPLE, view)))
  inOrder(tldr, exec)
  inOrder(exec, full)
  expect(tldr[0]).toBe(HEAD)
  expect(tldr).not.toContain('↗ **Links**')
  expect(exec).toContain('- ↗ **Links**')
  for (const view of [tldr, exec, full]) expect(bare(view.at(-1) ?? '')).toBe(bare(LINK))
  // tldr is clipped hard: the headline, the decision pick, the links. No body, options or caveats.
  expect(tldr).toEqual([HEAD, D1, LINK])
  expect(viewBlocks(WORKED_EXAMPLE, 'tldr')).toHaveLength(3)
  // exec: the section headings and L1 heads, every option head and the caveat text; no tails, L2, L3, option bodies or details.
  expect(exec).toContain(`  ${L1_1}`)
  expect(exec).toContain(`  ${L1_2}`)
  expect(exec).toContain(`  ${OPTION_HEADS[0]}`)
  expect(exec).toContain(CAVEAT)
  const execText = exec.join('\n')
  for (const hidden of [L1_1_TAIL, 'retry wrapper', 'Canary | 5%', OPTION_BODIES[0] ?? '?', 'Only Safari 17']) expect(execText).not.toContain(hidden)
  // full adds each of them.
  const fullText = full.join('\n')
  for (const shown of [L1_1 + L1_1_TAIL, L2_1, L3_1, ...TABLE, (OPTION_HEADS[0] ?? '?') + OPTION_BODIES[0], CAVEAT_DETAILS]) {
    expect(fullText).toContain(shown.trimEnd())
  }
})

test('the prefix invariant holds for every input, and after any one level is flipped', () => {
  const body = [
    `- ${words(9)}: first.`,
    `  - ${words(9)}: second.`,
    '    - an L3 bullet',
    '    | a | b |',
    '    | - | - |',
    '    prose under the L2 bullet',
    '',
    '# Diagram',
    '```',
    'a --> b',
    '```',
  ].join('\n')
  const inputs = [
    WORKED_EXAMPLE,
    LEGACY,
    { headline: 'A', body },
    { headline: 'A', decision: { choice: 'Go?', options: [{ name: 'Stay', consequence: 'd.', stance: 'option' }, { name: 'Go', consequence: 'c.', stance: 'recommended' }] } },
    { headline: 'A', details: '# Plan\n- one\n  - two\n\nA paragraph.\n\n| a | b |\n| - | - |' },
  ]
  const check = () => {
    for (const input of inputs) {
      const [tldr = [], exec = [], full = []] = (['tldr', 'exec', 'full'] as const).map(view => lines(renderReply(input, view)))
      for (const [small, big] of [[tldr, exec], [exec, full]] as const) {
        let at = 0
        for (const line of small) {
          const found = big.findIndex((b, i) => i >= at && (bare(b) === bare(line) || bare(b).startsWith(bare(line) + ': ')))
          expect(found, line).toBeGreaterThanOrEqual(0)
          at = found + 1
        }
      }
    }
  }
  check()
  const saved = { ...LEVELS }
  try {
    for (const unit of Object.keys(LEVELS) as (keyof typeof LEVELS)[]) {
      for (const level of [1, 2, 3] as const) {
        LEVELS[unit] = level
        check()
      }
      LEVELS[unit] = saved[unit]
    }
  } finally {
    Object.assign(LEVELS, saved)
  }
})

test('the LEVELS table drives the output: flipping one entry changes what a view shows', () => {
  const saved = { ...LEVELS }
  try {
    expect(renderReply(WORKED_EXAMPLE, 'tldr')).toBe(TLDR)
    // caveat 2 -> 1: the caveat appears in tldr (its details stay in full) and nowhere else changes.
    LEVELS.caveat = 1
    expect(renderReply(WORKED_EXAMPLE, 'tldr')).toBe([HEAD, D1, CAVEAT, LINK].join('\n\n'))
    LEVELS.caveat = saved.caveat
    // bodyTail 3 -> 2: the L1 tails join exec, and nothing below them.
    LEVELS.bodyTail = 2
    expect(renderReply(WORKED_EXAMPLE, 'exec')).toContain(nest(SECTION_1, L1_1 + L1_1_TAIL))
    expect(renderReply(WORKED_EXAMPLE, 'exec')).not.toContain('retry wrapper')
    LEVELS.bodyTail = saved.bodyTail
    // optionBody 3 -> 2: the option bodies join exec.
    LEVELS.optionBody = 2
    expect(renderReply(WORKED_EXAMPLE, 'exec')).toContain(OPTION_BODIES[1] ?? '?')
    LEVELS.optionBody = saved.optionBody
    // option 2 -> 1: the option heads join tldr, under their decision.
    LEVELS.option = 1
    expect(renderReply(WORKED_EXAMPLE, 'tldr')).toBe([HEAD, DECISION, LINK].join('\n\n'))
  } finally {
    Object.assign(LEVELS, saved)
  }
  expect(renderReply(WORKED_EXAMPLE, 'tldr')).toBe(TLDR)
})

test('a child never shows before its parent: it takes the parent level when that is higher', () => {
  const saved = { ...LEVELS }
  try {
    // headline 3: nothing hangs from it that is not also 3; here the headline alone leaves exec.
    LEVELS.headline = 3
    expect(renderReply(WORKED_EXAMPLE, 'exec')).not.toContain('Safari checkout is fixed')
    LEVELS.headline = saved.headline
    // decision 3: its options (2) follow it.
    LEVELS.decision = 3
    expect(renderReply(WORKED_EXAMPLE, 'exec')).not.toContain('Wait a week')
    expect(renderReply(WORKED_EXAMPLE, 'full')).toContain(OPTION_HEADS[0] ?? '?')
    LEVELS.decision = saved.decision
    // A section heading of 3 with L1 heads of 1: the heads wait for their heading.
    LEVELS.bodySection = 3
    LEVELS.bodyHead = 1
    expect(renderReply(WORKED_EXAMPLE, 'exec')).not.toContain('Safari dropped the session')
    expect(renderReply(WORKED_EXAMPLE, 'full')).toContain(L1_1 + L1_1_TAIL)
    LEVELS.bodySection = saved.bodySection
    LEVELS.bodyHead = saved.bodyHead
    // A caveat of 3 with details of 2: the details wait for the caveat.
    LEVELS.caveat = 3
    LEVELS.caveatDetails = 2
    expect(renderReply(WORKED_EXAMPLE, 'exec')).not.toContain('Only Safari 17')
    expect(renderReply(WORKED_EXAMPLE, 'full')).toContain('Only Safari 17')
  } finally {
    Object.assign(LEVELS, saved)
  }
})

test('every block opens with its section icon, in both sets; the emoji set swaps cleanly', () => {
  const expected = (set: 'glyph' | 'emoji') => {
    const i = ICONS[set]
    return [i.answer, i.body, i.body, i.decision, i.caveat, i.links]
  }
  for (const set of ['glyph', 'emoji'] as const) {
    const blocks = viewBlocks(WORKED_EXAMPLE, 'full', set)
    expect(blocks).toHaveLength(6)
    blocks.forEach((block, i) => {
      const first = block[0]
      expect(first && lineMarkdown(first).startsWith(expected(set)[i] ?? '?'), `${set} block ${i}`).toBe(true)
    })
  }
  // tldr has no Links heading, so no links icon.
  expect(renderReply(WORKED_EXAMPLE, 'tldr')).not.toContain('↗')
  // The emoji set draws the same reply with only the icons replaced.
  for (const view of ['tldr', 'exec', 'full'] as const) {
    let md = renderReply(WORKED_EXAMPLE, view, 'emoji')
    expect(md).not.toMatch(/[●◆◇≡▸↗→]/)
    for (const key of Object.keys(ICONS.glyph) as (keyof typeof ICONS.glyph)[]) md = md.split(ICONS.emoji[key]).join(ICONS.glyph[key])
    expect(md).toBe(renderReply(WORKED_EXAMPLE, view, 'glyph'))
  }
  expect(renderReply(WORKED_EXAMPLE, 'exec', 'emoji')).toContain('🎯 **Safari checkout is fixed')
  expect(renderReply(WORKED_EXAMPLE, 'exec', 'emoji')).toContain('📋 **Why it broke**')
  expect(renderReply(WORKED_EXAMPLE, 'exec', 'emoji')).toContain('🔀 **How should we release the fix?**')
  expect(renderReply(WORKED_EXAMPLE, 'exec', 'emoji')).toContain('⚠️ Safari 16 was not tested.')
  // A `#` heading becomes a bold line behind the icon; a headingless bullet keeps its list marker.
  const eight = 'one two three four five six seven eight'
  expect(renderReply({ headline: 'A', body: `# Plan\n- ${eight}: t.` }, 'full')).toBe(`● **A**\n\n- ≡ **Plan**\n  - **${eight}**: t.`)
  expect(renderReply({ headline: 'A', body: `- ${eight}: t.\n- ${eight} again` }, 'full')).toBe(`● **A**\n\n- ≡ **${eight}**: t.\n- **${eight} again**`)
})

test('the recommended option is first with a [Recommended] prefix, wherever it was given, and its head is the pick', () => {
  const exec = renderReply(WORKED_EXAMPLE, 'exec')
  expect(exec).toContain(nest(D1, `${OPTION_HEADS[0]}`))
  expect(exec.indexOf('Wait a week and run')).toBeLessThan(exec.indexOf('Ship today to everyone'))
  expect(exec).not.toContain('Friday after a two hour watch [Recommended]')
  const last = { headline: 'A', decision: { choice: 'Go?', options: [{ head: 'Stay', body: 'd.', stance: 'option' }, { head: 'Go', body: 'c.', stance: 'recommended' }] } }
  expect(renderReply(last, 'exec')).toBe('● **A**\n\n- ◇ **Go?** Go\n  - [Recommended] **Go**\n  - **Stay**')
  expect(renderReply(last, 'full')).toBe('● **A**\n\n- ◇ **Go?** Go\n  - [Recommended] **Go**: c.\n  - **Stay**: d.')
  expect(renderReply(last, 'tldr')).toBe('● **A**\n\n◇ **Go?** Go')
})

test('a bullet of the form Label: text gets a bold label (used by a past reply\'s outlines); a time, a URL, a code label or a long label does not', () => {
  expect(boldLabel('Fix: retry wrapper')).toBe('**Fix**: retry wrapper')
  expect(boldLabel('Built by Codex:')).toBe('**Built by Codex**:')
  expect(boldLabel('Full: Friday 10:00')).toBe('**Full**: Friday 10:00')
  expect(boldLabel('Friday 10:00')).toBe('Friday 10:00')
  expect(boldLabel('Meet at 10:00 sharp')).toBe('Meet at 10:00 sharp')
  expect(boldLabel('**Done**: already')).toBe('**Done**: already')
  expect(boldLabel('See `a: b`')).toBe('See `a: b`')
  expect(boldLabel('https://x.test/a: b')).toBe('https://x.test/a: b')
  expect(boldLabel('one two three four five six seven: too long')).toBe('one two three four five six seven: too long')
  const md = renderReply({ headline: 'A', details: '**S**\n- Rate: 5%\n- Starts 10:00\n  - Inner: note\n\nA plain paragraph: not bolded' }, 'full')
  expect(md).toContain('- **Rate**: 5%')
  expect(md).toContain('- Starts 10:00')
  expect(md).toContain('  - **Inner**: note')
  expect(md).toContain('A plain paragraph: not bolded')
})

test('the body draws as an outline: L1 heads in exec, tails and L2 in full, L3 freeform and intact, a diagram section in exec and full', () => {
  const [a, b, c] = [words(9), words(10), words(11)]
  const body = [
    '# Plan',
    `- ${a}: Tail one.`,
    `  - ${b}: Tail two.`,
    '    - L3 bullet',
    '    | x | y |',
    '    | - | - |',
    '    ```',
    '    code under L3',
    '    ```',
    '    Free prose.',
    `- ${c}`,
    '',
    '**Diagram**',
    '```',
    'a --> b',
    '```',
  ].join('\n')
  const input = { headline: 'A', body }
  expect(validateReply(input)).toEqual([])
  const diagram = '- ≡ **Diagram**\n  ```\n  a --> b\n  ```'
  // exec: headings and L1 heads only (a head with no tail is drawn the same), plus the whole diagram.
  expect(renderReply(input, 'exec')).toBe(`● **A**\n\n- ≡ **Plan**\n  - **${a}**\n  - **${c}**\n\n${diagram}`)
  // full: the tail joins its head; L2 and L3 nest, and the table and code keep their indentation inside the list item.
  expect(renderReply(input, 'full')).toBe(
    [
      '● **A**',
      [
        '- ≡ **Plan**',
        `  - **${a}**: Tail one.`,
        `    - **${b}**: Tail two.`,
        '      - L3 bullet',
        '      | x | y |',
        '      | - | - |',
        '      ```',
        '      code under L3',
        '      ```',
        '      Free prose.',
        `  - **${c}**`,
      ].join('\n'),
      diagram,
    ].join('\n\n'),
  )
  // A diagram section is not in tldr, and nothing else of the body is.
  expect(renderReply(input, 'tldr')).toBe('● **A**')
  // L3 prose runs on from the line above it unless that line ends in a hard break.
  expect(renderReply({ headline: 'A', body: `**S**\n- ${a}: t.\n  - ${b}: t.\n    prose one.\n    prose two.` }, 'full')).toContain(
    '    - **' + b + '**: t.  \n      prose one.  \n      prose two.',
  )
  // Without a heading the bullets are an unnamed section; its first line takes the icon after its list marker.
  expect(renderReply({ headline: 'A', body: `- ${a}: Tail one.` }, 'exec')).toBe(`● **A**\n\n- ≡ **${a}**`)
  // The terminal indents under a heading with a box; a head with children is in HEAD_UNITS.
  for (const unit of ['bodySection', 'decision', 'caveat', 'linksHeading'] as const) expect(HEAD_UNITS).toContain(unit)
})

test('a headline-less reply, and a bold the model wrote itself', () => {
  expect(renderReply({ headline: 'One line.' }, 'exec')).toBe('● **One line.**')
  expect(renderReply({ headline: 'Has **already** bold' }, 'exec')).toBe('● Has **already** bold')
  expect(renderReply({ headline: '', decision: { choice: 'Q?', options: [{ head: 'A', body: 'c.', stance: 'recommended' }] } }, 'tldr')).toBe('◇ **Q?** A')
  // The closing text opens with an invisible marker; the icon keeps a bold that starts on punctuation rendering.
  expect(closingText({ headline: '"Yes" it is.' }, 'exec')).toBe(CLOSING_MARK + '● **"Yes" it is.**')
  expect(closingText({ headline: 'Yes it is.' }, 'exec')).toBe(CLOSING_MARK + '● **Yes it is.**')
})

test('the decision is one call with 2 to 4 whole plans: option count, exactly one recommended, a head of 8 to 15 words, a body of 3 sentences', () => {
  const o = (stance: string, extra: Record<string, unknown> = {}) => ({ head: words(10), body: 'It costs a day.', stance, ...extra })
  const withOptions = (options: unknown[], choice: unknown = 'Go?') => ({ headline: 'Ok.', decision: { choice, options } })
  const plans = 'make each option a whole plan that bundles the sub-choices'
  expect(validateReply(withOptions([o('recommended'), o('option'), o('not_recommended')]))).toEqual([])
  expect(validateReply(withOptions([o('recommended'), o('option')]))).toEqual([])
  expect(validateReply(withOptions([o('recommended'), o('option'), o('option'), o('option')]))).toEqual([])
  expect(validateReply(withOptions([o('recommended')]))).toEqual([`decision has 1 option(s) (needs 2 to 4): ${plans}`])
  expect(validateReply(withOptions([o('recommended'), o('option'), o('option'), o('option'), o('option')]))).toEqual([
    `decision has 5 options (max 4): ${plans}`,
  ])
  expect(validateReply(withOptions([o('option'), o('option')]))).toEqual(['decision has no option with stance recommended'])
  expect(validateReply(withOptions([o('recommended'), o('recommended')]))).toEqual([
    'decision has 2 options with stance recommended (exactly 1)',
  ])
  expect(validateReply(withOptions([o('recommended'), o('green')]))).toEqual([
    'decision.options[1].stance should be one of recommended, option, not_recommended',
  ])
  // The choice is required, not blank, and at most 15 words.
  expect(validateReply(withOptions([o('recommended'), o('option')], '  '))).toEqual([
    'decision.choice is empty: ask the one call the user must make as a question',
  ])
  expect(validateReply({ headline: 'Ok.', decision: { options: [o('recommended'), o('option')] } })).toEqual(['decision.choice is missing'])
  expect(validateReply(withOptions([o('recommended'), o('option')], words(15)))).toEqual([])
  expect(validateReply(withOptions([o('recommended'), o('option')], words(16)))).toEqual([
    'decision.choice has 16 words (max 15): ask the one call as a short question',
  ])
  // A head is a sentence of 8 to 15 words; a body is at most 3 sentences, and may list several things.
  expect([MIN_HEAD_WORDS, MAX_HEAD_WORDS]).toEqual([8, 15])
  for (const n of [8, 15]) expect(validateReply(withOptions([o('recommended', { head: words(n) }), o('option')]))).toEqual([])
  for (const n of [7, 16]) {
    expect(validateReply(withOptions([o('recommended', { head: words(n) }), o('option')]))).toEqual([
      `decision.options[0].head has ${n} words (needs 8 to 15): say the plan as a sentence; the detail goes in body`,
    ])
  }
  expect(validateReply(withOptions([o('recommended', { body: 'Fix A. Ticket B. Skip C.' }), o('option')]))).toEqual([])
  expect(validateReply(withOptions([o('recommended', { body: 'Fix A. Ticket B. Skip C. Park D.' }), o('option')]))).toEqual([
    'decision.options[0].body has 4 sentences (max 3)',
  ])
  // An option from before 0.1.14 (name, consequence) or 0.1.6 (picked) is told what to send; its lengths are not checked.
  const oldOption = 'still has name and consequence: send head (a sentence of 8 to 15 words) and body (up to 3 sentences)'
  expect(validateReply(withOptions([{ name: 'A', consequence: 'c.', stance: 'recommended' }, o('option')]))).toEqual([`decision.options[0] ${oldOption}`])
  expect(validateReply(withOptions([{ name: 'A', consequence: 'c.', picked: true }, { name: 'B', consequence: 'c.', picked: false }])).length).toBeGreaterThan(0)
  // An object sent as a JSON string is read as the object it encodes.
  expect(validateReply({ headline: 'Ok.', decision: JSON.stringify({ choice: 'Go?', options: [o('recommended'), o('option')] }) })).toEqual([])
  expect(validateReply({ headline: 'Ok.', decision: 5 })).toEqual(['decision should be an object'])
  const props = REPLY_SCHEMA.properties.decision.properties.options.items.properties as Record<string, unknown>
  expect(Object.keys(props)).toEqual(['head', 'body', 'stance'])
  expect(Object.keys(REPLY_SCHEMA.properties.decision.properties)).toEqual(['choice', 'options'])
})

test('validation flags a bare id and a long body, scans caveats, and passes the worked example', () => {
  const issues = validateReply({
    headline: 'Yes.',
    decision: {
      choice: 'Go?',
      options: [
        { head: 'Fix it in !441 with a plan that has eight words', body: 'One. Two. Three. Four.', stance: 'recommended' },
        { head: 'Wait for the next release train before we ship', body: 'Later.', stance: 'option' },
      ],
    },
  })
  expect(issues).toEqual(['decision.options[0].head has a bare id "!441"', 'decision.options[0].body has 4 sentences (max 3)'])
  expect(validateReply(WORKED_EXAMPLE)).toEqual([])
  expect(validateReply({})).toEqual(['headline is missing (headline: a summary of the whole reply in at most 3 sentences and 60 words)'])

  // Caveats: at most 3, each `text` at most 2 sentences and 40 words and scanned, `details` free; a string reads as `{ text }`.
  const caveat = (text: unknown, details?: unknown) => ({ headline: 'A', caveats: [{ text, details }] })
  expect(validateReply({ headline: 'A', caveats: ['One.', { text: 'Two.' }, { text: 'Three.', details: 'See src/a.ts and !441. Many. Sentences. Here. Free.' }] })).toEqual([])
  expect(validateReply({ headline: 'A', caveats: ['1.', '2.', '3.', '4.'] })).toEqual(['caveats has 4 entries (max 3)'])
  expect(validateReply(caveat('One. Two.'))).toEqual([])
  expect(validateReply(caveat('One. Two. Three.'))).toEqual(['caveats[0].text has 3 sentences (max 2)'])
  expect(validateReply(caveat(words(40)))).toEqual([])
  expect(validateReply(caveat(words(41)))).toEqual(['caveats[0].text has 41 words (max 40): keep the point and put the evidence in details'])
  expect(validateReply(caveat('See `src/a.ts` now.')).length).toBe(2)
  expect(validateReply({ headline: 'A', caveats: [7] })).toEqual(['caveats[0] should be an object'])
  expect(validateReply({ headline: 'A', caveats: [{ details: 'x' }] })).toEqual(['caveats[0].text is missing'])
})

const FIX = 'headline: a summary of the whole reply in at most 3 sentences and 60 words'

test('headline summarizes the whole reply: up to 3 sentences and 60 words, with the fix in the message', () => {
  expect(validateReply({ headline: 'JSON' })).toEqual([])
  expect(validateReply({ headline: 'JSON: it is strict. Spaces win by hand. Pick one.' })).toEqual([])
  expect(validateReply({ headline: words(60) })).toEqual([])
  // `**` markers do not count as words.
  expect(validateReply({ headline: `**${words(60)}**` })).toEqual([])
  expect(validateReply({ headline: words(61) })).toEqual([`headline has 61 words (max 60): ${FIX}`])
  expect(validateReply({ headline: 'JSON. Spaces. Tabs. Both.' })).toEqual([`headline has 4 sentences (max 3): ${FIX}`])
  expect(validateReply({ headline: '   ' })).toEqual([`headline is empty (${FIX})`])
  expect(validateReply({ headline: 5 })).toEqual(['headline should be a string'])
  // A headline carries no id, URL, code or path.
  expect(validateReply({ headline: 'Fixed in !441' })).toEqual(['headline has a bare id "!441"'])
})

test('the contract and the schema lead with headline and body, state the length ladder, and say nothing of a section count; removed fields get an issue', () => {
  const props = REPLY_SCHEMA.properties as Record<string, unknown>
  expect(Object.keys(props)).toEqual(['headline', 'body', 'decision', 'caveats', 'links'])
  for (const gone of ['answer', 'summary', 'status', 'details', 'next', 'questions', 'decisions']) expect(props[gone]).toBeUndefined()
  expect(REPLY_SCHEMA.required).toEqual(['headline'])
  expect(REPLY_SCHEMA.additionalProperties).toBe(false)
  expect(CONTRACT).not.toMatch(/"answer"|"questions"|"decisions"|"pick"|"summary"|"status"|"next"/)
  expect(CONTRACT).toContain('"headline":"Safari checkout is fixed and ready to release.')
  // The rules and the example reach the tool's own description too, not only the system-prompt section.
  for (const text of [CONTRACT, toolSpec(true).description]) {
    expect(text).toContain('At most one `decision`')
    expect(text).toContain('Say each fact once')
    expect(text).toContain('never repeat the headline')
    expect(text).toContain('Every L1 and L2 bullet is `head: tail` with an 8 to 15 word head that reads as a sentence; L1 tails are one sentence, L2 tails up to two.')
    expect(text).toContain('L3 is freeform markdown (tables, code, lists) for evidence and detail')
    expect(text).toContain('Only when the user asks for a diagram: give it its own section, a heading followed by one fenced code block')
    expect(text).toContain('"decision":{"choice":"How should we release the fix?"')
    expect(text).not.toContain('verdict')
    // The number of sections is not limited, and the text does not hint at a limit.
    expect(text).not.toMatch(/\d+ sections|sections? \(max|number of sections|section count|max(imum)? sections/i)
  }
  // A new call that still sends a removed field is turned away with where its content goes now.
  expect(validateReply({ answer: 'Yes.' })).toEqual([`answer is no longer a field: send ${FIX}`])
  const removed = {
    summary: 'summary is no longer a field: fold it into the headline (at most 3 sentences and 60 words)',
    status: 'status is no longer a field: put it in the body, as a section of bullets',
    details: 'details is no longer a field: put it in the body, as L2 and L3 bullets under the L1 bullet they support',
    next: 'next is no longer a field: drop it, or make it a decision option',
    questions: 'questions is no longer a field: answer in the headline, and give each question its own body section when there are several',
    decisions: 'decisions is no longer a field: send one decision whose 2 to 4 options are whole plans',
  }
  for (const [key, issue] of Object.entries(removed)) expect(validateReply({ headline: 'A', [key]: LEGACY[key as keyof typeof LEGACY] ?? 'x' })).toEqual([issue])
  expect(validateReply({ headline: 'A', status: 5 })).toEqual([removed.status])
  expect(validateReply({ headline: 'A', summary: 'S.', status: 's', details: 'd', next: 'n' })).toHaveLength(4)
})

test('a past reply still redraws: status, details, next, summary (before 0.1.14), questions and decisions[] (before 0.1.13), answer for headline (before 0.1.9), picked (before 0.1.6)', () => {
  const head = '● **Checkout fixed; ship Friday**'
  const summary = 'The retry now covers the timeout path.'
  const status = nest('▸ **Waiting on you**', '- **QA sign-off**: needed by Thursday')
  const statusSub = '  - Regression suite is green'
  const q1 = '◆ **Does checkout still fail on Safari?** No, the failure rate fell from 4% to 0.1%.'
  const why = '- **The retry now covers the timeout path**'
  const q2 = '◆ **Can we ship Friday?** Yes, if QA signs off by Thursday.'
  const d = '◇ **Ship Friday or wait a week?** Ship Friday'
  const heads = ['- [Recommended] **Ship Friday**', '- **Wait a week**']
  const bodies = [': Customers get the fix 5 days sooner.', ': One more regression pass.']
  const next = '→ Want me to draft the QA sign-off request?'
  const rollout = nest('≡ **Rollout**', '- **Canary**: 5% on Thursday', '  - Watch the error dashboard for 2 hours')
  // The reply is drawn where its fields used to go: status after the headline, details and next after the caveat.
  expect(renderReply(LEGACY, 'tldr')).toBe([head, d, next, LINK].join('\n\n'))
  expect(renderReply(LEGACY, 'exec')).toBe(
    [head, status, nest(q1, why), q2, nest(d, ...heads), CAVEAT, next, nest('↗ **Links**', LINK)].join('\n\n'),
  )
  const evidence = ['  - **Fix**: retry wrapper in `checkout/pay.ts`', '  - MR !441']
  expect(renderReply(LEGACY, 'full')).toBe(
    [
      `${head}  \n${summary}`,
      nest('▸ **Waiting on you**', '- **QA sign-off**: needed by Thursday', statusSub),
      nest(q1, why + ': The timeout path was the only one that dropped the session.', ...evidence),
      q2,
      nest(d, ...heads.map((h, i) => h + bodies[i])),
      CAVEAT,
      rollout,
      next,
      nest('↗ **Links**', LINK),
    ].join('\n\n'),
  )
  // A multi-sentence `why`: the first sentence is the reason, the rest follows it in full only.
  const long = { headline: 'A.', questions: [{ ask: 'Q?', verdict: 'V.', why: 'The retry covers the timeout path. It was the only gap, e.g. 5 files.', details: '- Fix: wrapper' }] }
  expect(renderReply(long, 'exec')).toBe('● **A.**\n\n- ◆ **Q?** V.\n  - **The retry covers the timeout path**')
  expect(renderReply(long, 'full')).toContain('  - **The retry covers the timeout path**: It was the only gap, e.g. 5 files.\n    - **Fix**: wrapper')
  // A 0.1.13 decision (options with name and consequence) draws as head and body.
  const v0113 = { headline: 'A', decision: { choice: 'Go?', options: [{ name: 'Stay', consequence: 'd.', stance: 'option' }, { name: 'Go', consequence: 'c.', stance: 'recommended' }] } }
  expect(renderReply(v0113, 'exec')).toBe('● **A**\n\n- ◇ **Go?** Go\n  - [Recommended] **Go**\n  - **Stay**')
  expect(renderReply(v0113, 'full')).toBe('● **A**\n\n- ◇ **Go?** Go\n  - [Recommended] **Go**: c.\n  - **Stay**: d.')
  // An `answer` is drawn as the headline (a headline wins over a stray one); `picked` reads as the stance.
  const old = { answer: 'A.', decisions: [{ choice: 'Go?', pick: 'Yes.', options: [{ name: 'Stay', consequence: 'd.', picked: false }, { name: 'Go', consequence: 'c.', picked: true }] }] }
  expect(renderReply(old, 'exec')).toBe('● **A.**\n\n- ◇ **Go?** Yes.\n  - [Recommended] **Go**\n  - **Stay**')
  expect(renderReply(old, 'tldr')).toBe('● **A.**\n\n◇ **Go?** Yes.')
  expect(renderReply({ answer: 'Old.', headline: 'New' }, 'exec')).toBe('● **New**')
  // A malformed old field draws as nothing and never throws.
  expect(renderReply({ headline: 'A', questions: 'nope', decisions: [5, { choice: 7 }], status: 5, details: [], next: {}, summary: 3 }, 'full')).toBe('● **A**')
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
  expect(renderReply({ headline: 'Done.', links }, 'tldr')).toBe('● **Done.**\n\n' + list)
  // exec and full carry a bold Links heading; tldr has none.
  expect(renderReply({ headline: 'Done.', links }, 'exec')).toBe('● **Done.**\n\n' + nest('↗ **Links**', ...list.split('\n')))
  expect(renderReply({ headline: 'Done.', links }, 'tldr')).not.toContain('Links')
  expect(validateReply({ ...WORKED_EXAMPLE, links })).toEqual(['links[0].path should be an absolute path or an http(s) URL'])
})

test('Windows drive and UNC paths are accepted and drawn as file URLs behind their labels', () => {
  const links = [
    { label: 'A', path: 'C:\\Users\\Me\\My Report.html' },
    { label: 'B', path: 'C:/Users/Me/r(1).html' },
    { label: 'C', path: '\\\\srv\\share\\a b.txt' },
  ]
  expect(validateReply({ ...WORKED_EXAMPLE, links })).toEqual([])
  const out = renderReply({ headline: 'Done.', links }, 'tldr')
  expect(out).toContain('- [A](file:///C:/Users/Me/My%20Report.html)')
  expect(out).toContain('- [B](file:///C:/Users/Me/r%281%29.html)')
  expect(out).toContain('- [C](file://srv/share/a%20b.txt)')
  expect(out).not.toContain('C:\\')
  expect(validateReply({ ...WORKED_EXAMPLE, links: [{ label: 'x', path: 'C:relative' }] })).toHaveLength(1)
})

test('literal backslash-n escapes become real line breaks, except in code spans or when real newlines exist', () => {
  const eight = 'one two three four five six seven eight'
  expect(renderReply({ headline: 'a\\r\\nb\\tc' }, 'full')).toBe('● **a**  \n**b\tc**')
  expect(renderReply({ headline: 'Run `printf "a\\nb"`\\nDone' }, 'full')).toBe('● **Run `printf "a\\nb"`**  \n**Done**')
  const escaped = { headline: 'A', body: `**S**\\n- ${eight}: t.\\n  - ${eight} too: t.` }
  expect(validateReply(escaped)).toEqual([])
  expect(renderReply(escaped, 'exec')).toContain(`- ≡ **S**\n  - **${eight}**`)
  expect(renderReply({ headline: 'A', caveats: [{ text: 'T.', details: 'a\\nb' }] }, 'full')).toContain('- ⚠ T.\n  - a\n  - b')
  // A Windows path in a link is never touched.
  expect(renderReply({ headline: 'A', links: [{ label: 'L', path: 'C:\\new\\tmp.html' }] }, 'tldr')).toContain('(file:///C:/new/tmp.html)')
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
  // The body: headings and L1 heads from exec, tails, L2, L3 (a table here) and caveat details in full only.
  expect(markdown.includes(SECTION_1)).toBe(view !== 'tldr')
  expect(markdown.includes(L1_1)).toBe(view !== 'tldr')
  expect(markdown.includes(L1_1 + L1_1_TAIL)).toBe(view === 'full')
  expect(markdown.includes('retry wrapper')).toBe(view === 'full')
  // The table keeps its indentation under its L2 bullet, inside the box as in the markdown path.
  expect(markdown.includes(`${L2_2}\n${TABLE.join('\n')}`)).toBe(view === 'full')
  expect(markdown.includes(CAVEAT)).toBe(view !== 'tldr')
  expect(markdown.includes('Only Safari 17')).toBe(view === 'full')
  expect(markdown).toContain(D1)
  expect(markdown).not.toContain('file:///')
  expect(markdown).not.toContain('Decision')
  expect(JSON.stringify(await ui.drawn())).not.toContain('cyan')
  const props = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.props
  if (view === 'tldr') {
    expect(await props(/Recommended/)).toBeUndefined()
    expect(markdown).not.toContain('Links')
  } else {
    expect(await props(/^\[Recommended\] $/)).toMatchObject({ color: 'green', weight: 'bold' })
    expect(await props(new RegExp(`^${PICK}$`))).toMatchObject({ color: 'green', weight: 'bold' })
    expect(await props(/^Wait a week and run the full regression pass first$/)).toMatchObject({ color: 'blue', weight: 'bold' })
    expect(await props(/^Ship today to everyone and skip the QA sign-off entirely$/)).toMatchObject({ color: 'red', weight: 'bold' })
    expect(markdown).toContain('↗ **Links**')
    // An option's body joins its head as plain text in full only.
    expect((await props(/^: Customers get the fix 5 days sooner/)) !== undefined).toBe(view === 'full')
  }
  const link = await ui.find({ type: 'Link' })
  expect(link?.props).toMatchObject({ href: 'file:///home/me/reports/checkout.html' })
  // The label is a blue Text inside the Link; the `- ` marker beside it keeps the default color.
  expect(link?.children).toMatchObject([{ type: 'Text', props: { color: 'blue' }, children: ['Test report'] }])
  const row = await ui.find({ type: 'Text', text: /Test report/ })
  expect(row?.props).toEqual({})
  expect(row?.children[0]).toBe('- ')
  // Under a head the terminal indents with a box two cells in, the head outside it; the markdown inside stays flat.
  const indented = (await ui.findAll({ type: 'Box' })).filter(box => box.props.paddingLeft === 2).map(box => box.text).join('\n')
  expect(markdown).not.toMatch(/^- [▸◆◇↗≡⚠]/m)
  expect(indented.includes(L1_1)).toBe(view !== 'tldr')
  expect(indented).not.toContain(SECTION_1)
  expect(indented).not.toContain(D1)
  expect(indented.includes(CAVEAT_DETAILS)).toBe(view === 'full')
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

  const bad = {
    headline: 'Yes.',
    decision: {
      choice: 'Ship it?',
      options: [
        { head: 'Ship it now with the plan that was agreed earlier', body: 'Done in !441.', stance: 'recommended' },
        { head: 'Wait for the next release train before we ship anything', body: 'Later.', stance: 'option' },
      ],
    },
  }
  await $.turn.start({ text: 'q', turnId: 't1' })
  for (const round of [1, 2]) {
    const rejected = await respond($, bad)
    expect(rejected.deny, `rejection ${round}`).toContain('1 issue(s)')
    expect(rejected.deny).toContain('decision.options[0].body has a bare id "!441"')
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
  expect(closing.answer).toBe(closingText(bad, 'exec'))
  expect(closing.answer.startsWith(CLOSING_MARK)).toBe(true)
  expect(closing.toolUses).toEqual([])
  expect(engine.steps).toBe(1)

  // A subagent is left alone: its respond call is turned away, and its next step still goes to the model, unclosed.
  const sub = { turnId: 'ts', agentId: 'sub1' }
  await $.turn.start({ text: 'q', ...sub })
  const turnedAway = await respond($, { agentId: sub.agentId, headline: 'Yes, it works.' })
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
  const clean = await respond($, { headline: 'Yes, it works.' })
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
    input: WORKED_EXAMPLE,
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  }
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const reply = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'ToolUse', props: ROW, requestId: 'tu1' })
    if (surface === 'terminal') {
      await expectTerminalReply(reply, 'full')
    } else {
      // The hook drew (not the engine's own row) and the tree validates; markdown cannot nest a list under a paragraph,
      // so a heading is a list item with its lines nested under it, and so is the closing text a surface without a row shows.
      expect(await reply.drawn()).toMatchObject({ type: 'Markdown' })
      const text = (await reply.find({ type: 'Markdown' }))?.text
      expect(text).toBe(FULL)
      expect(text).toContain(S1_FULL)
      expect(closingText(WORKED_EXAMPLE, 'full')).toContain(S1_FULL)
    }
    expect(await reply.find({ type: 'Text', text: /\/reply|full ·/ })).toBeUndefined()
    await reply.unmount()

    // A rejected call is an errored row in the transcript (live and on a redraw or resume): it draws nothing, not the
    // reply and not a `respond rejected` line. A call still running draws nothing either.
    for (const state of [{ isErrored: true }, { isRunning: true }]) {
      const hidden = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'ToolUse', props: { ...ROW, ...state, input: { headline: 'Done in !441.' } }, requestId: 'tu2' })
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
    const marked = await $.ui.mount({ plugin: 'reply-tool', surface, component: 'AssistantMessage', props: { text: closingText(WORKED_EXAMPLE, 'exec'), isFirstOfReply: false }, requestId: 'am3' })
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

  const row = { tool_use_id: 'tu1', tool: RESPOND, input: WORKED_EXAMPLE, isRunning: false, isErrored: false, isInterrupted: false }
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
  const flagged = { ...row, input: { headline: 'Done in !441.' } }
  const issues = await $.ui.mount({ plugin: 'reply-tool', surface: 'terminal', component: 'ToolUse', props: flagged, requestId: 'tu4' })
  expect((await issues.find({ type: 'Markdown' }))?.text).toBe('● **Done in !441.**')
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

  expect((await respond($, { headline: 'Yes.' })).deny).toBe(
    'respond is disabled (reply-tool is off). Do not call it again; write your reply as normal markdown.',
  )

  // Once on, the same call is delivered.
  await run($, 'reply', 'exec')
  expect((await respond($, { headline: 'Yes.' })).result).toBe('delivered')
})

test('the closing text is the marked reply at the view, and only a marked or bare closing text is hidden', () => {
  for (const view of ['tldr', 'exec', 'full'] as const) {
    const text = closingText(WORKED_EXAMPLE, view)
    expect(text).toBe(CLOSING_MARK + renderReply(WORKED_EXAMPLE, view).trim())
    expect(CLOSING_MATCHER.test(text)).toBe(true)
  }
  expect(closingText(WORKED_EXAMPLE, 'tldr')).not.toBe(closingText(WORKED_EXAMPLE, 'full'))
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

test('body is an outline: a head of 8 to 15 words per L1 and L2 bullet, tails of 1 and 2 sentences, 3 levels, L3 free, no ids in headings or L1, no repeats of the headline', () => {
  const check = (...rows: string[]) => validateReply({ headline: 'Done.', body: rows.join('\n') })
  const l1 = (head: string, tail = 'Tail.') => `- ${head}: ${tail}`
  const l2 = (head: string, tail = 'Tail.') => `  - ${head}: ${tail}`
  const head = (level: number, n: number) =>
    `body L${level} bullet "w0 w1 w2 w3 w4 w5${n > 6 ? '...' : ''}" has a head of ${n} words (needs 8 to 15): write the head as a sentence, then ": tail"`
  const tail = (level: number, n: number, max: number) =>
    `body L${level} bullet "w0 w1 w2 w3 w4 w5..." has a tail of ${n} sentences (max ${max}): put the rest in an L${level + 1} bullet`

  // The head is the text before the first colon followed by a space or the line end; 8 to 15 words, `**` markers ignored.
  for (const n of [8, 15]) {
    expect(check('**S**', l1(words(n)))).toEqual([])
    expect(check('**S**', l1(words(9)), l2(words(n)))).toEqual([])
  }
  expect(check('**S**', l1(words(7)))).toEqual([head(1, 7)])
  expect(check('**S**', l1(words(16)))).toEqual([head(1, 16)])
  expect(check('**S**', l1(words(9)), l2(words(7)))).toEqual([head(2, 7)])
  expect(check('**S**', l1(words(9)), l2(words(16)))).toEqual([head(2, 16)])
  // No colon: the whole bullet is the head and the tail is empty. A time or a URL is not a colon; a bold head may hold its colon.
  expect(check('**S**', `- ${words(8)}`)).toEqual([])
  expect(check('**S**', `- ${words(7)}`)).toEqual([head(1, 7)])
  expect(check('**S**', `- ${words(7)} at 10:00`)).toEqual([])
  expect(check('**S**', `- **${words(8)}**: tail`)).toEqual([])
  expect(check('**S**', `- **${words(8)}:** tail`)).toEqual([])
  // Tails: an L1 tail is at most 1 sentence, an L2 tail at most 2.
  expect(check('**S**', l1(words(9), 'One. Two.'))).toEqual([tail(1, 2, 1)])
  expect(check('**S**', l1(words(9)), l2(words(9), 'One. Two.'))).toEqual([])
  expect(check('**S**', l1(words(9)), l2(words(9), 'One. Two. Three.'))).toEqual([tail(2, 3, 2)])
  // L3 is free: no head, a path, an id, 4 sentences, a table, code, prose and a quote, all unchecked.
  expect(
    check(
      '**S**',
      l1(words(9)),
      l2(words(9)),
      '    - see src/a.ts and !441. One. Two. Three. Four.',
      '    | a | b |',
      '    | - | - |',
      '    ```',
      '    anything: ## at all',
      '    ```',
      '    > a quote, and prose',
    ),
  ).toEqual([])
  // 4 levels of bullets are turned away, and only bullets count.
  const deep = 'body section "S" goes 4 levels deep (max 3): condense the top levels'
  expect(check('**S**', l1(words(9)), l2(words(9)), '    - three', '      - four')).toEqual([deep])
  expect(check('# S', l1(words(9)), l2(words(9)), '    - three', '    | a | b |', '    | - | - |')).toEqual([])
  // Ids, paths, URLs and code are rejected in a heading and an L1 head or tail, and allowed from L2 down.
  expect(check('**S**', l1(`${words(8)} in src/a.ts`))).toEqual([`body L1 bullet "w0 w1 w2 w3 w4 w5..." has a file path "a.ts"`])
  expect(check('**S**', l1(words(9), 'see !441.'))).toEqual([`body L1 bullet "w0 w1 w2 w3 w4 w5..." has a bare id "!441"`])
  expect(check('**S**', l1(words(9)), l2(`${words(8)} in src/a.ts`, 'see !441 and `x`.'))).toEqual([])
  expect(check('**Fix !441**', l1(words(9)))).toEqual(['body heading "Fix !441" has a bare id "!441"'])
  // A heading is at most 10 words, with no minimum; `#` and bold-only lines both head a section; bullets may come first.
  expect(check(`**${words(10)}**`, l1(words(9)))).toEqual([])
  expect(check(`# ${words(11)}`, l1(words(9)))).toEqual([`body heading "${words(11)}" has 11 words (max 10): shorten it`])
  expect(check('**Why**', l1(words(9)), '**Next steps for the team**', l1(words(9)))).toEqual([])
  expect(check(l1(words(9)), '**S**', l1(words(9)))).toEqual([])
  // The number of sections is not limited.
  expect(check(...Array.from({ length: 12 }, (_, i) => [`**Section ${i}**`, l1(words(9))]).flat())).toEqual([])
  // Every other line is a heading or a bullet.
  expect(check('**S**', 'Some plain text here, as a paragraph.')).toEqual(['body: write "Some plain text here, as a..." as a bullet under a heading'])
  expect(check('**S**', l1(words(9)), '  indented text under an L1 bullet')).toEqual(['body: write "indented text under an L1 bullet" as a bullet under a heading'])
  // A table or code block is nested under a bullet (L2 or deeper), never at the top of a section.
  expect(check('**S**', '| a | b |', '| - | - |')).toEqual(['body section "S" has a top-level table: nest it under a bullet (L2 or deeper)'])
  expect(check('**S**', l1(words(9)), '  | a | b |', '  | - | - |', '  ```', '  code', '  ```')).toEqual([])
  const mixed =
    'body section "S" has a top-level code block: nest it under a bullet (L2 or deeper), or give the diagram its own section with the code block as its only content'
  expect(check('**S**', l1(words(9)), '```', 'a --> b', '```')).toEqual([mixed])
  expect(check('**S**', '```', 'a --> b', '```', '```', 'c', '```')).toEqual([mixed])
  // A heading followed by exactly one fenced block is a diagram section: no bullet rules apply to it, but its heading does.
  expect(check('**Architecture**', '```mermaid', 'graph TD', '  A[a long line that is not a bullet: ever] --> B', '```')).toEqual([])
  expect(check(`**${words(11)}**`, '```', 'a --> b', '```')).toEqual([`body heading "${words(11)}" has 11 words (max 10): shorten it`])
  expect(check('```', 'a --> b', '```')).toEqual([expect.stringContaining('top-level code block')])
  // A heading or an L1 head that mostly repeats the headline is turned away: 70% of its content words, at least 3 of them.
  const repeats = (text: string) => `body "${text}" repeats the headline: say something the headline doesn't`
  const reply = (...rows: string[]) => validateReply({ headline: 'The checkout retry fix is ready to release now.', body: rows.join('\n') })
  expect(reply('**Checkout retry fix ready**', l1(words(9)))).toEqual([repeats('Checkout retry fix ready')])
  expect(reply('**S**', l1('The checkout retry fix is ready to release now'))).toEqual([repeats('The checkout retry fix is ready to release now')])
  expect(reply('**S**', l1('The checkout retry fix has a new timeout path in Safari'))).toEqual([])
  expect(reply('**Retry fix**', l1(words(9)))).toEqual([])
  expect(reply('**S**', l1(words(9)), l2('The checkout retry fix is ready to release now'))).toEqual([])
})

test('the level table: the headline and the decision line are tldr, headings and heads and option heads are exec, tails and bodies are full', () => {
  expect([LEVELS.headline, LEVELS.decision, LEVELS.link]).toEqual([1, 1, 1])
  expect([LEVELS.bodySection, LEVELS.bodyHead, LEVELS.bodyDiagram, LEVELS.option, LEVELS.caveat, LEVELS.linksHeading]).toEqual([2, 2, 2, 2, 2, 2])
  expect([LEVELS.bodyTail, LEVELS.bodyL2, LEVELS.bodyL3, LEVELS.optionBody, LEVELS.caveatDetails]).toEqual([3, 3, 3, 3, 3])
  // LEGACY units keep the levels they had.
  expect([LEVELS.summary, LEVELS.statusSection, LEVELS.statusBullet, LEVELS.statusSub, LEVELS.next]).toEqual([3, 2, 2, 3, 1])
  expect(ICONS.glyph.body).toBe('≡')
  expect(ICONS.emoji.body).toBe('📋')
})
