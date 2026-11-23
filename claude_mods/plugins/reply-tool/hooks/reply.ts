// Pure logic of reply-tool: the reply v1 schema, the validator and the markdown renderer.
// No `$`, no state: everything here is a plain function of its arguments, so it is testable alone.

import type { ReplyToolMode } from '../types'

/** What `/reply` takes: off, or on with the replies drawn as tldr, exec or full. */
export type Setting = ReplyToolMode
/** What a reply is drawn as: tldr, exec, or full (what the full setting draws, and what an off mode draws too). */
export type ReplyView = 'tldr' | 'exec' | 'full'

export const USAGE = 'Usage: /reply off|tldr|exec|full'
/** A turn's rejections stop here: the next call is accepted with its issues noted. */
export const MAX_REJECTIONS = 2

/** The setting typed after the command, or undefined when it is none of the four. */
export function parseSetting(args: string | undefined): Setting | undefined {
  const word = (args ?? '').trim().toLowerCase()
  return word === 'off' || word === 'tldr' || word === 'exec' || word === 'full' ? word : undefined
}

export const viewOf = (setting: Setting): ReplyView => (setting === 'off' ? 'full' : setting)

// The reply JSON schema (v1).
export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: {
    answer: {
      type: 'string',
      description:
        'Bottom line, plain prose, at most 2 sentences. Start with Yes/No/Partly when the user asked a yes/no question. With 2+ questions: one sentence of overall bottom line that does not repeat any verdict (may be empty).',
    },
    questions: {
      type: 'array',
      description:
        "One entry per question the user asked, in the user's order; max 5 (group by theme if more). Omit when the user asked a single question.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ask', 'verdict'],
        properties: {
          ask: { type: 'string', description: "The user's question in their own words, at most 12 words." },
          verdict: {
            type: 'string',
            description: 'ONE sentence: the verdict first, then the number or effect. No ids, paths, URLs or code.',
          },
          why: { type: 'string', description: 'Optional, at most 2 sentences of support.' },
          details: {
            type: 'string',
            description: 'Optional markdown: evidence, mechanics, MR/ticket ids, file paths, source links.',
          },
        },
      },
    },
    decisions: {
      type: 'array',
      description: 'Only when the user must choose. One entry per choice.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['choice', 'pick', 'options'],
        properties: {
          choice: { type: 'string', description: 'The decision in the user\'s words, phrased as a question.' },
          pick: { type: 'string', description: 'One line: what Claude recommends, plus a short reason.' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'consequence', 'picked'],
              properties: {
                name: { type: 'string' },
                consequence: { type: 'string', description: 'One line: what choosing this costs or gains.' },
                picked: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    caveats: {
      type: 'array',
      items: { type: 'string' },
      description: 'At most 2, one clause each, only if it changes a decision.',
    },
    next: {
      type: 'string',
      description: "Optional question or offer that reads on its own (never just 'pick a number').",
    },
    links: {
      type: 'array',
      description: 'Deliverables the user opens (files, HTML reports, docs). Always shown.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'path'],
        properties: {
          label: { type: 'string' },
          path: { type: 'string', description: 'Absolute path or http(s) URL.' },
        },
      },
    },
    details: {
      type: 'string',
      description: 'Optional markdown for everything else: how it works, evidence, status detail.',
    },
  },
} as const

// ---------------------------------------------------------------------------------------------
// Reading the input defensively: the tool's input is not schema-constrained by the API.

export type ReplyOption = { name: string; consequence: string; picked: boolean }
export type ReplyDecision = { choice: string; pick: string; options: ReplyOption[] }
export type ReplyQuestion = { ask: string; verdict: string; why: string; details: string }
export type ReplyLink = { label: string; path: string }
export type Reply = {
  /** undefined when the field was absent or not a string. */
  answer: string | undefined
  questions: ReplyQuestion[]
  decisions: ReplyDecision[]
  caveats: string[]
  next: string
  links: ReplyLink[]
  details: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The input as parsed JSON: a string that holds JSON (a doubly encoded call) is parsed once. */
export function parseInput(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// An array field the model sent as a JSON string is read as the array it encodes.
function asArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** The reply as typed data, plus a problem for every field of the wrong type. Never throws. */
export function normalizeReply(raw: unknown): { reply: Reply; problems: string[] } {
  const problems: string[] = []
  const input = parseInput(raw)
  if (!isRecord(input)) problems.push('the reply must be a JSON object')
  const root: Record<string, unknown> = isRecord(input) ? input : {}

  const text = (path: string, value: unknown, isRequired = false): string | undefined => {
    if (value === undefined || value === null) {
      if (isRequired) problems.push(`${path} is missing`)
      return undefined
    }
    if (typeof value !== 'string') {
      problems.push(`${path} should be a string`)
      return undefined
    }
    return value
  }
  const list = (path: string, value: unknown): unknown[] => {
    if (value === undefined || value === null) return []
    const items = asArray(value)
    if (items === undefined) {
      problems.push(`${path} should be an array`)
      return []
    }
    return items
  }

  const questions = list('questions', root.questions).map((item, i): ReplyQuestion => {
    const path = `questions[${i}]`
    if (!isRecord(item)) {
      problems.push(`${path} should be an object`)
      return { ask: '', verdict: '', why: '', details: '' }
    }
    return {
      ask: text(`${path}.ask`, item.ask, true) ?? '',
      verdict: text(`${path}.verdict`, item.verdict, true) ?? '',
      why: text(`${path}.why`, item.why) ?? '',
      details: text(`${path}.details`, item.details) ?? '',
    }
  })

  const decisions = list('decisions', root.decisions).map((item, i): ReplyDecision => {
    const path = `decisions[${i}]`
    if (!isRecord(item)) {
      problems.push(`${path} should be an object`)
      return { choice: '', pick: '', options: [] }
    }
    const options = list(`${path}.options`, item.options).map((option, j): ReplyOption => {
      const optionPath = `${path}.options[${j}]`
      if (!isRecord(option)) {
        problems.push(`${optionPath} should be an object`)
        return { name: '', consequence: '', picked: false }
      }
      if (typeof option.picked !== 'boolean') problems.push(`${optionPath}.picked should be a boolean`)
      return {
        name: text(`${optionPath}.name`, option.name, true) ?? '',
        consequence: text(`${optionPath}.consequence`, option.consequence, true) ?? '',
        picked: option.picked === true,
      }
    })
    if (item.options === undefined || item.options === null) problems.push(`${path}.options is missing`)
    return {
      choice: text(`${path}.choice`, item.choice, true) ?? '',
      pick: text(`${path}.pick`, item.pick, true) ?? '',
      options,
    }
  })

  const caveats = list('caveats', root.caveats).map((item, i) => text(`caveats[${i}]`, item) ?? '')

  const links = list('links', root.links).map((item, i): ReplyLink => {
    const path = `links[${i}]`
    if (!isRecord(item)) {
      problems.push(`${path} should be an object`)
      return { label: '', path: '' }
    }
    return {
      label: text(`${path}.label`, item.label, true) ?? '',
      path: text(`${path}.path`, item.path, true) ?? '',
    }
  })

  const reply: Reply = {
    answer: text('answer', root.answer),
    questions,
    decisions,
    caveats,
    next: text('next', root.next) ?? '',
    links,
    details: text('details', root.details) ?? '',
  }
  return { reply, problems }
}

// ---------------------------------------------------------------------------------------------
// Validation: a list of human-readable issues; nothing is hidden.

// Common abbreviations whose closing dot does not end a sentence. The dot is swapped for a
// look-alike before counting, so "e.g. 5 files" stays one sentence.
const ABBREVIATION = /(^|[^A-Za-z])(e\.g|i\.e|vs|etc|approx)\./gi

/** Sentences in a text: a `.`, `!` or `?` followed by whitespace and an uppercase letter or digit ends one. */
export function countSentences(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  const masked = trimmed.replace(ABBREVIATION, '$1$2\u2024')
  return (masked.match(/[.!?]\s+[A-Z0-9]/g) ?? []).length + 1
}

type Finder = { phrase: string; patterns: RegExp[]; clean?: (found: string) => string }

const FINDERS: Finder[] = [
  {
    phrase: 'a bare id',
    patterns: [/!\d+/g, /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g, /\bADR[- ]?\d+\b/g],
  },
  {
    phrase: 'a URL',
    patterns: [/https?:\/\/\S*/g],
    clean: found => found.replace(/[.,;:!?)\]}>"']+$/, ''),
  },
  {
    phrase: 'inline code',
    patterns: [/`[^`]*`/g, /`/g],
  },
  {
    phrase: 'a file path',
    patterns: [
      /(^|\s)(~|\.{0,2})?\/[\w.-]+\/[\w./-]+/g,
      /\b[\w-]+\.(ts|tsx|js|py|kt|java|go|rb|md|json|ya?ml|sh|sql|html)\b/g,
    ],
  },
]

/** The offending bits of one visible field, one issue each, named by field and quoted. */
function scanField(field: string, text: string): string[] {
  const issues: string[] = []
  for (const finder of FINDERS) {
    const seen: string[] = []
    for (const pattern of finder.patterns) {
      for (const found of text.match(pattern) ?? []) {
        const bit = (finder.clean ? finder.clean(found.trim()) : found.trim()).trim()
        // A lone backtick is only quoted when no whole span was found; a bit inside one is the same bit.
        const isInsideSpan = finder.phrase === 'inline code' && bit === '`' && seen.length > 0
        if (bit !== '' && !seen.includes(bit) && !isInsideSpan) seen.push(bit)
      }
    }
    for (const bit of seen) issues.push(`${field} has ${finder.phrase} "${bit}"`)
  }
  return issues
}

const isWindowsDrivePath = (path: string): boolean => /^[A-Za-z]:[\\/]/.test(path)
const isUncPath = (path: string): boolean => /^\\\\[^\\/]+[\\/]+[^\\/]/.test(path)
const isAbsolutePath = (path: string): boolean => path.startsWith('/') || isWindowsDrivePath(path) || isUncPath(path)
const isWebUrl = (path: string): boolean => /^https?:\/\/\S/i.test(path)

/** The validation issues of a reply, in field order; an empty list is a clean reply. */
export function validateReply(raw: unknown): string[] {
  const { reply, problems } = normalizeReply(raw)
  const issues: string[] = [...problems]
  const sentences = (field: string, text: string, max: number) => {
    const count = countSentences(text)
    if (count > max) issues.push(`${field} has ${count} sentences (max ${max})`)
  }

  const { answer } = reply
  if (answer === undefined) {
    if (!problems.includes('answer should be a string')) issues.push('answer is missing')
  } else {
    if (answer.trim() === '' && reply.questions.length === 0) issues.push('answer is empty and there are no questions')
    sentences('answer', answer, 2)
    issues.push(...scanField('answer', answer))
  }

  if (reply.questions.length === 1) issues.push('questions has 1 entry (omit it and answer in "answer")')
  if (reply.questions.length > 5) issues.push(`questions has ${reply.questions.length} entries (max 5; group by theme)`)
  reply.questions.forEach((question, i) => {
    sentences(`questions[${i}].verdict`, question.verdict, 1)
    issues.push(...scanField(`questions[${i}].verdict`, question.verdict))
    sentences(`questions[${i}].why`, question.why, 2)
  })

  reply.decisions.forEach((decision, i) => {
    const path = `decisions[${i}]`
    issues.push(...scanField(`${path}.pick`, decision.pick))
    if (!decision.options.some(option => option.picked)) issues.push(`${path} has no option with picked: true`)
    if (decision.options.length < 2) {
      issues.push(`${path} has ${decision.options.length} option(s) (needs at least 2)`)
    }
    decision.options.forEach((option, j) => {
      issues.push(...scanField(`${path}.options[${j}].name`, option.name))
      issues.push(...scanField(`${path}.options[${j}].consequence`, option.consequence))
    })
  })

  if (reply.caveats.length > 2) issues.push(`caveats has ${reply.caveats.length} entries (max 2)`)
  reply.caveats.forEach((caveat, i) => issues.push(...scanField(`caveats[${i}]`, caveat)))

  issues.push(...scanField('next', reply.next))

  reply.links.forEach((link, i) => {
    const path = link.path.trim()
    if (isAbsolutePath(path) || isWebUrl(path)) return
    issues.push(`links[${i}].path should be an absolute path or an http(s) URL`)
  })
  return issues
}

// ---------------------------------------------------------------------------------------------
// Rendering: one markdown string per view, drawn with the surface's Markdown element.

// A line break inside a block that every markdown renderer keeps (two trailing spaces).
const BREAK = '  \n'

const indent = (text: string, spaces: number): string =>
  text
    .split('\n')
    .map(line => (line === '' ? line : ' '.repeat(spaces) + line))
    .join('\n')

/** Model-supplied text on one line, so a line break cannot end a code span or start a block. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** `text` with markdown-special characters backslash-escaped: it renders as text, never as a link, image, HTML or emphasis. */
const escapeMarkdown = (text: string): string => text.replace(/[\\`*_[\]()<>#!|~]/g, '\\$&')

/** `text` as one inline code span; backticks are dropped so nothing inside it can end the span. */
const codeSpan = (text: string): string => `\`${oneLine(text).replace(/`/g, '')}\``

/** An http(s) URL with the characters that could end a markdown link early percent-encoded. */
const webUrl = (url: string): string =>
  url.replace(/[\s\\()<>[\]`]/g, char => encodeURIComponent(char).replace('(', '%28').replace(')', '%29'))

/** `file://` URL of an absolute path, percent-encoded where a path would break a URL or a markdown link. */
export function fileUrl(path: string): string {
  const encode = (parts: string[]): string =>
    parts.map(part => encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/')
  if (isWindowsDrivePath(path)) {
    // `C:\Users\me` -> `file:///C:/Users/me`; the drive colon stays literal.
    const rest = path.slice(2).split(/[\\/]+/).filter(part => part !== '')
    return `file:///${path.slice(0, 2)}/${encode(rest)}`
  }
  if (isUncPath(path)) {
    // `\\server\share\a b` -> `file://server/share/a%20b`
    const [host = '', ...rest] = path.split(/[\\/]+/).filter(part => part !== '')
    return `file://${encodeURIComponent(host)}/${encode(rest)}`
  }
  return `file://${encode(path.split('/'))}`
}

/**
 * The label as plain text, then the path. Only an absolute path or an http(s) URL is a link, and its text is its
 * target; any other path (relative, `javascript:`, `data:`, ...) is a code span, so a label never sets the target.
 */
function renderLink(link: ReplyLink): string {
  const label = escapeMarkdown(oneLine(link.label))
  const path = link.path.trim()
  if (isAbsolutePath(path)) {
    const url = fileUrl(path)
    return `${label}: ${codeSpan(path)} · [${url}](${url})`
  }
  if (isWebUrl(path)) {
    const url = webUrl(path)
    return `${label}: [${url}](${url})`
  }
  return `${label}: ${codeSpan(path)}`
}

function renderQuestion(question: ReplyQuestion, index: number, view: ReplyView): string {
  const ask = question.ask.trim() === '' ? '' : `**${question.ask.trim()}** `
  const why = view === 'full' && question.why.trim() !== '' ? ` ${question.why.trim()}` : ''
  const line = `${index + 1}. ${ask}${question.verdict.trim()}${why}`
  const details = view === 'full' ? question.details.trim() : ''
  return details === '' ? line : `${line}\n\n${indent(details, 3)}\n`
}

function renderDecision(decision: ReplyDecision): string {
  const head = `**${decision.choice.trim()}** ★ ${decision.pick.trim()}`
  const options = decision.options.map(option => `- ${option.picked ? '★ ' : ''}${option.name}: ${option.consequence}`)
  return [head, ...options].join('\n')
}

/**
 * A field the model wrote with literal `\n`, `\r\n` or `\t` escapes and no real line break gets real ones.
 * Inline code spans are left as written; a field that already has a real newline is left alone.
 */
export function unescapeBreaks(text: string): string {
  if (/[\r\n]/.test(text) || !/\\[nrt]/.test(text)) return text
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\\t/g, '\t')))
    .join('')
}

function unescapeReply(reply: Reply): Reply {
  const u = unescapeBreaks
  return {
    answer: reply.answer === undefined ? undefined : u(reply.answer),
    questions: reply.questions.map(q => ({ ask: u(q.ask), verdict: u(q.verdict), why: u(q.why), details: u(q.details) })),
    decisions: reply.decisions.map(d => ({
      choice: u(d.choice),
      pick: u(d.pick),
      options: d.options.map(o => ({ ...o, name: u(o.name), consequence: u(o.consequence) })),
    })),
    caveats: reply.caveats.map(u),
    next: u(reply.next),
    links: reply.links,
    details: u(reply.details),
  }
}

/** The reply as one markdown string for a view (tldr, exec, or full: exec plus each why and details). */
export function renderReply(raw: unknown, view: ReplyView): string {
  const reply = unescapeReply(normalizeReply(raw).reply)
  const questions = reply.questions.filter(q => q.ask.trim() !== '' || q.verdict.trim() !== '')
  const decisions = reply.decisions.filter(d => d.choice.trim() !== '' || d.pick.trim() !== '')
  const links = reply.links.filter(l => l.label.trim() !== '' || l.path.trim() !== '')
  const answer = (reply.answer ?? '').trim()
  const blocks: string[] = []
  const linkBlock = () => {
    // `*` bullets: a `-` list would merge with the decision options above it.
    if (links.length > 0) blocks.push(links.map(link => `* ${renderLink(link)}`).join('\n'))
  }

  if (view === 'tldr') {
    if (answer !== '') blocks.push(answer)
    else if (questions.length > 0) blocks.push(questions.map(q => `- ${q.verdict.trim()}`).join('\n'))
    if (decisions.length > 0) blocks.push(decisions.map(d => (d.choice.trim() === '' ? `★ ${d.pick.trim()}` : `★ **${d.choice.trim()}** ${d.pick.trim()}`)).join(BREAK))
    linkBlock()
    return blocks.join('\n\n')
  }

  if (answer !== '') blocks.push(answer)
  if (questions.length > 0) blocks.push(questions.map((q, i) => renderQuestion(q, i, view)).join('\n'))
  for (const decision of decisions) blocks.push(renderDecision(decision))
  const caveats = reply.caveats.filter(c => c.trim() !== '')
  if (caveats.length > 0) blocks.push(caveats.map(c => `⚠ ${c.trim()}`).join(BREAK))
  if (reply.next.trim() !== '') blocks.push(reply.next.trim())
  linkBlock()
  if (view === 'full' && reply.details.trim() !== '') blocks.push(reply.details.trim())
  return blocks.join('\n\n')
}

/**
 * The dim footer lines under `setting`: the view and the command that changes it, the issue count, and in the full
 * view the issues. The full view of an off mode has no `off` to offer (it is already off); the full setting does.
 */
export function replyFooter(setting: Setting, issues: readonly string[]): string[] {
  const off = issues.length > 0 ? ` · off-pattern: ${issues.length} issue(s)` : ''
  const hint = setting === 'off' ? 'full · /reply tldr|exec|full' : `${setting} · /reply off|tldr|exec|full`
  const head = `${hint}${off}`
  return viewOf(setting) === 'full' ? [head, ...issues.map(issue => `  - ${issue}`)] : [head]
}

/** What a rejected call tells the model: the count and every issue, word for word. */
export function rejectionText(issues: readonly string[]): string {
  return [
    `respond rejected: ${issues.length} issue(s). Fix all of them and call respond again with the complete reply.`,
    ...issues.map(issue => `- ${issue}`),
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// Counters

export type Stats = {
  /** Turns that ended in an answer while the mod was on. */
  turns: number
  /** Turns whose final reply was delivered through respond. */
  structured: number
  /** Turns that fell back to a plain-text final answer. */
  unstructured: number
  /** Delivered replies that still had at least one validation issue. */
  withIssues: number
  /** Turns whose first respond call passed validation. */
  firstCallPass: number
  /** respond calls rejected, all turns. */
  rejections: number
}

export const EMPTY_STATS: Stats = {
  turns: 0,
  structured: 0,
  unstructured: 0,
  withIssues: 0,
  firstCallPass: 0,
  rejections: 0,
}

/** A stored value read as counters: every field a non-negative integer, defaults for the rest. */
export function readStats(stored: unknown): Stats {
  const source = isRecord(stored) ? stored : {}
  const pick = (key: keyof Stats): number => {
    const value = source[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
  }
  return {
    turns: pick('turns'),
    structured: pick('structured'),
    unstructured: pick('unstructured'),
    withIssues: pick('withIssues'),
    firstCallPass: pick('firstCallPass'),
    rejections: pick('rejections'),
  }
}

export function addStats(stats: Stats, delta: Partial<Stats>): Stats {
  return {
    turns: stats.turns + (delta.turns ?? 0),
    structured: stats.structured + (delta.structured ?? 0),
    unstructured: stats.unstructured + (delta.unstructured ?? 0),
    withIssues: stats.withIssues + (delta.withIssues ?? 0),
    firstCallPass: stats.firstCallPass + (delta.firstCallPass ?? 0),
    rejections: stats.rejections + (delta.rejections ?? 0),
  }
}

const share = (part: number, whole: number): string => (whole === 0 ? '' : ` (${Math.round((part / whole) * 100)}%)`)

export function formatStats(stats: Stats, setting: Setting): string {
  return [
    `reply-tool is set to ${setting}`,
    `turns while enabled: ${stats.turns}`,
    `structured (respond delivered): ${stats.structured}${share(stats.structured, stats.turns)}`,
    `not structured (plain-text fallback): ${stats.unstructured}${share(stats.unstructured, stats.turns)}`,
    `replies with at least 1 validation issue: ${stats.withIssues}${share(stats.withIssues, stats.structured)}`,
    `first respond call passed: ${stats.firstCallPass}${share(stats.firstCallPass, stats.structured)}`,
    `rejections: ${stats.rejections}`,
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// The prompt contract and the tool's wording

/** One short worked example; it passes its own validator. */
export const WORKED_EXAMPLE = {
  answer: 'Good news on checkout, with one open dependency.',
  questions: [
    {
      ask: 'Does checkout still fail on Safari?',
      verdict: 'No, the failure rate fell from 4% to 0.1%.',
      why: 'The retry now covers the timeout path.',
      details: 'Fix: retry wrapper in `checkout/pay.ts` (MR !441).',
    },
    { ask: 'Can we ship Friday?', verdict: 'Yes, if QA signs off by Thursday.' },
  ],
  decisions: [
    {
      choice: 'Ship Friday or wait a week?',
      pick: 'Ship Friday, the risk is low.',
      options: [
        { name: 'Ship Friday', consequence: 'Customers get the fix 5 days sooner.', picked: true },
        { name: 'Wait a week', consequence: 'One more full regression pass.', picked: false },
      ],
    },
  ],
  caveats: ['Safari 16 was not tested.'],
  next: 'Want me to draft the QA sign-off request?',
  links: [{ label: 'Test report', path: '/home/me/reports/checkout.html' }],
} as const

export const CONTRACT_ID = 'reply-tool:contract'

const RULES = [
  '1. Answer first: the bottom line comes before anything else.',
  '2. One block per question THE USER asked, in their order, labelled with their question.',
  '3. Each block is a verdict plus 1-2 sentences, with the number kept.',
  '4. Evidence, ids, paths and mechanics are pushed down (details, links), never in the verdict.',
  '5. Decisions are numbered calls with your pick; a caveat appears only when it changes a decision.',
]

const EXAMPLE = `Example of a reply to two questions and one decision:\n${JSON.stringify(WORKED_EXAMPLE)}`

const DELIVERY =
  'String fields take real line breaks, never `\\n` escape sequences. End every turn by calling `respond` with your reply; do not write the reply as plain text. If `respond` returns issues, fix them and call it again. After it returns `delivered`, end your turn without writing anything else. Only the main conversation uses `respond`; a subagent never calls it and reports in plain text.'

/** The system-prompt section `prompt.compose` adds while the mod is on: rules, schema, example, delivery rule. */
export const CONTRACT = [
  'Reply format (reply-tool). The user reads replies in one pattern; follow it:',
  ...RULES,
  '',
  'The `respond` tool takes your reply as JSON matching this schema:',
  JSON.stringify(REPLY_SCHEMA),
  '',
  EXAMPLE,
  '',
  DELIVERY,
].join('\n')

export const TOOL_NAME = 'respond'
export const TOOL_FULL_NAME = 'mcp__reply-tool__respond'

// The contract also rides in the tool description, so it reaches the model even where plugins'
// `prompt.compose` hooks are skipped.
const ACTIVE_DESCRIPTION = [
  'Deliver your reply to the user. The user reads replies in one pattern; follow it:',
  ...RULES,
  '',
  EXAMPLE,
  '',
  DELIVERY,
].join('\n')

const INACTIVE_DESCRIPTION =
  'Inactive: the reply-tool mod is switched off. Do not call this tool; write your reply as normal text.'

/** The `$.tool.register` spec: its schema is always in the prompt while on, deferred and described as inactive while off. */
export function toolSpec(isEnabled: boolean) {
  return {
    name: TOOL_NAME,
    description: isEnabled ? ACTIVE_DESCRIPTION : INACTIVE_DESCRIPTION,
    inputSchema: REPLY_SCHEMA as unknown as Record<string, unknown>,
    isDeferred: !isEnabled,
  }
}

// The closing step's text. After `respond` is delivered the turn ends with an ordinary assistant
// message holding the reply as markdown, so Desktop and mobile (which fold the respond call into an
// activity group and draw no ToolUse row of their own) still show it. A zero-width marker leads it so
// the terminal, whose ToolUse row already draws the reply, can hide this copy.
export const CLOSING_MARK = '​⁠​'
// A bare zero-width space is what 0.1.1 wrote; transcripts may still hold it.
export const CLOSING_EMPTY = '​'

export function closingText(raw: unknown, view: ReplyView): string {
  const markdown = renderReply(raw, view).trim()
  return markdown === '' ? CLOSING_EMPTY : `${CLOSING_MARK}${markdown}`
}

// Matches an AssistantMessage that is a closing step: marked, or the old bare invisible text.
export const CLOSING_MATCHER = /^(?:​⁠​|[​\s]*​[​\s]*$)/
