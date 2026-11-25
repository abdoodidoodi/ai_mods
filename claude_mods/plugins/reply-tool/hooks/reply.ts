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
/** The headline summarizes the whole reply: at most this many sentences and words. */
export const MAX_HEADLINE_SENTENCES = 3
export const MAX_HEADLINE_WORDS = 60
/** A body section heading is at most this many words (no minimum). */
export const MAX_HEADING_WORDS = 10
/** The head of an L1 or L2 body bullet, and of a decision option, reads as a sentence: MIN_HEAD_WORDS to MAX_HEAD_WORDS words. */
export const MIN_HEAD_WORDS = 8
export const MAX_HEAD_WORDS = 15
/** The body nests at most this many bullet levels under a heading (L1, L2, L3). */
export const MAX_BODY_LEVELS = 3
/** An L1 tail is at most 1 sentence and an L2 tail at most 2; an L3 bullet is free. */
export const MAX_L1_TAIL_SENTENCES = 1
export const MAX_L2_TAIL_SENTENCES = 2
/** A heading or L1 head repeats the headline when at least REPEAT_SHARE of its content words (and at least REPEAT_MIN_WORDS of them) appear in it. */
export const REPEAT_SHARE = 0.7
export const REPEAT_MIN_WORDS = 3
/** The decision's `choice` is at most this many words. */
export const MAX_CHOICE_WORDS = 15
/** The decision has at least this many options, and at most MAX_OPTIONS: each one a whole plan. */
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 4
/** An option's `body` is at most this many sentences. */
export const MAX_OPTION_BODY_SENTENCES = 3
/** At most this many caveats, each `text` of at most MAX_CAVEAT_SENTENCES sentences and MAX_CAVEAT_WORDS words. */
export const MAX_CAVEATS = 3
export const MAX_CAVEAT_SENTENCES = 2
export const MAX_CAVEAT_WORDS = 40

/** The setting typed after the command, or undefined when it is none of the four. */
export function parseSetting(args: string | undefined): Setting | undefined {
  const word = (args ?? '').trim().toLowerCase()
  return word === 'off' || word === 'tldr' || word === 'exec' || word === 'full' ? word : undefined
}

/** The bottom-bar indicator: `exec` while on; undefined (which clears it) while off. */
export const indicatorText = (setting: Setting): string | undefined => (setting === 'off' ? undefined : setting)

export const viewOf = (setting: Setting): ReplyView => (setting === 'off' ? 'full' : setting)

// The reply JSON schema (v1).
export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline'],
  properties: {
    headline: {
      type: 'string',
      description:
        'A bold summary of the whole reply: at most 3 sentences and 60 words, with no ids, paths, URLs or code. Shown in every view, so it must stand alone. Never repeat it anywhere else in the reply.',
    },
    body: {
      type: 'string',
      description:
        'The only place for explanation, progress and evidence: a markdown outline. A section is a heading (a `#` heading or a bold-only line, at most 10 words) followed by bullets; bullets before the first heading form an unnamed section. Bullets nest at most 3 levels under a heading: L1, then L2 (indented 2 spaces), then L3 (indented 4). Every L1 and L2 bullet is `head: tail`: the head is the text before the first colon that is followed by a space or the line end (with no such colon the whole bullet is the head) and reads as a sentence of 8 to 15 words. An L1 tail is at most 1 sentence, an L2 tail at most 2. L3 is freeform markdown (tables, code, lists) for evidence and detail: anything indented under an L2 bullet, with no head and no limits, so ids, paths, URLs and inline code go there; they are allowed from L2 down, never in a heading or an L1 bullet. Every other line is a heading or a bullet: no plain paragraphs, and a table or fenced code block is nested under a bullet. Only when the user asks for a diagram: give it its own section, a heading followed by one fenced code block. Never repeat the headline: a heading or L1 head that mostly restates it is rejected. exec draws the headings and the L1 heads (and a diagram), full draws all of it.',
    },
    decision: {
      type: 'object',
      description: 'Only when the user must choose: the one call to make now. Fold every sub-choice into the options.',
      additionalProperties: false,
      required: ['choice', 'options'],
      properties: {
        choice: { type: 'string', description: 'The one call the user must make now, as a question of at most 15 words.' },
        options: {
          type: 'array',
          description: '2 to 4 whole plans that each bundle every sub-choice; never one decision per item.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['head', 'body', 'stance'],
            properties: {
              head: { type: 'string', description: 'The plan as one sentence of 8 to 15 words, with no ids, paths or code. Shown in exec and full.' },
              body: {
                type: 'string',
                description: 'What the plan means and costs, up to 3 sentences, with no ids, paths or code. Shown in full only.',
              },
              stance: {
                type: 'string',
                enum: ['recommended', 'option', 'not_recommended'],
                description:
                  'recommended: your pick, exactly one per decision (drawn green). option: a normal alternative (blue). not_recommended: listed for completeness, not advised (red).',
              },
            },
          },
        },
      },
    },
    caveats: {
      type: 'array',
      description: 'At most 3, only when one changes the decision. A caveat is drawn in exec and full; its details in full only.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'At most 2 sentences and 40 words, with no ids, paths, URLs or code.' },
          details: { type: 'string', description: 'Optional, free form: the evidence behind the caveat. Shown in full only.' },
        },
      },
    },
    links: {
      type: 'array',
      description: 'Deliverables the user opens (files, HTML reports, docs). Always shown, always last.',
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
  },
} as const

// ---------------------------------------------------------------------------------------------
// Reading the input defensively: the tool's input is not schema-constrained by the API.

export type Stance = 'recommended' | 'option' | 'not_recommended'
export const STANCES: readonly Stance[] = ['recommended', 'option', 'not_recommended']
export const isStance = (value: unknown): value is Stance => STANCES.includes(value as Stance)
export type ReplyOption = {
  head: string
  body: string
  stance: Stance
  /** LEGACY (before 0.1.14): the option came as `name` and `consequence`; it is drawn as head and body, and the validator turns a new call that sends them away. */
  isLegacy?: boolean
}
export type ReplyDecision = { choice: string; options: ReplyOption[] }
/** LEGACY (replies before 0.1.13): one entry of the old `decisions[]`, which carried its own `pick`. */
export type LegacyDecision = ReplyDecision & { pick: string }
/** LEGACY (replies before 0.1.13): one entry of the old `questions[]`. */
export type ReplyQuestion = { ask: string; verdict: string; why: string; details: string }
export type ReplyCaveat = { text: string; details: string }
export type ReplyLink = { label: string; path: string }
/**
 * LEGACY: what replies before 0.1.14 carry beside the current fields. Transcripts still hold them, so they are read
 * leniently and drawn as they were; the validator turns a new call that sends any of them away.
 */
export type LegacyFields = {
  /** What replies before 0.1.9 carry in place of `headline`: drawn as the headline when there is none. */
  answer: string | undefined
  /** (before 0.1.14) the line under the headline, in full. */
  summary: string
  /** (before 0.1.14) an outline of where things stand. */
  status: string
  /** (before 0.1.14) an outline of background and evidence. */
  details: string
  /** (before 0.1.14) a question or offer. */
  next: string
  /** (before 0.1.13) */
  questions: ReplyQuestion[]
  /** (before 0.1.13) */
  decisions: LegacyDecision[]
}
export type Reply = {
  /** undefined when the field was absent or not a string. */
  headline: string | undefined
  /** The markdown outline of explanation, progress and evidence; '' when absent. */
  body: string
  /** undefined when the reply has no decision. */
  decision: ReplyDecision | undefined
  caveats: ReplyCaveat[]
  links: ReplyLink[]
  legacy: LegacyFields
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

// LEGACY (replies before 0.1.14): `answer`, `summary`, `status`, `details`, `next`, `questions` and `decisions[]` are no
// longer fields, and the validator turns a new call that sends them away, but transcripts still hold them. They are
// read leniently (a value of the wrong type draws as empty, it is never a problem) so a past reply redraws.
function readLegacy(root: Record<string, unknown>): LegacyFields {
  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  const rows = (value: unknown): Record<string, unknown>[] => (asArray(value) ?? []).filter(isRecord)
  const questions = rows(root.questions).map(q => ({ ask: str(q.ask), verdict: str(q.verdict), why: str(q.why), details: str(q.details) }))
  const decisions = rows(root.decisions).map(d => ({
    choice: str(d.choice),
    pick: str(d.pick),
    options: rows(d.options).map((o): ReplyOption => ({
      head: str(o.name),
      body: str(o.consequence),
      // `picked` is what replies before 0.1.6 carry in place of `stance`.
      stance: isStance(o.stance) ? o.stance : o.picked === true ? 'recommended' : 'option',
    })),
  }))
  return {
    answer: typeof root.answer === 'string' ? root.answer : undefined,
    summary: str(root.summary),
    status: str(root.status),
    details: str(root.details),
    next: str(root.next),
    questions,
    decisions,
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

  // The one decision. An object the model sent as a JSON string is read as the object it encodes.
  const readDecision = (value: unknown): ReplyDecision | undefined => {
    if (value === undefined || value === null) return undefined
    const item = parseInput(value)
    if (!isRecord(item)) {
      problems.push('decision should be an object')
      return undefined
    }
    const options = list('decision.options', item.options).map((option, j): ReplyOption => {
      const path = `decision.options[${j}]`
      if (!isRecord(option)) {
        problems.push(`${path} should be an object`)
        return { head: '', body: '', stance: 'option' }
      }
      if (!isStance(option.stance)) problems.push(`${path}.stance should be one of ${STANCES.join(', ')}`)
      const stance = isStance(option.stance) ? option.stance : 'option'
      // LEGACY (0.1.13): an option with `name` and `consequence` and no `head` or `body` is drawn as head and body. A new
      // call that sends it is told so, and its lengths are not checked: the one issue says what to send.
      if (option.head === undefined && option.body === undefined && (option.name !== undefined || option.consequence !== undefined)) {
        problems.push(`${path} still has name and consequence: send head (a sentence of 8 to 15 words) and body (up to 3 sentences)`)
        const str = (value: unknown): string => (typeof value === 'string' ? value : '')
        return { head: str(option.name), body: str(option.consequence), stance, isLegacy: true }
      }
      return {
        head: text(`${path}.head`, option.head, true) ?? '',
        body: text(`${path}.body`, option.body, true) ?? '',
        stance,
      }
    })
    if (item.options === undefined || item.options === null) problems.push('decision.options is missing')
    return { choice: text('decision.choice', item.choice, true) ?? '', options }
  }
  const decision = readDecision(root.decision)

  // A caveat is `{ text, details? }`; a plain string is read as `{ text }`.
  const caveats = list('caveats', root.caveats).map((item, i): ReplyCaveat => {
    if (typeof item === 'string') return { text: item, details: '' }
    const path = `caveats[${i}]`
    if (!isRecord(item)) {
      problems.push(`${path} should be an object`)
      return { text: '', details: '' }
    }
    return { text: text(`${path}.text`, item.text, true) ?? '', details: text(`${path}.details`, item.details) ?? '' }
  })

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
    headline: text('headline', root.headline),
    body: text('body', root.body) ?? '',
    decision,
    caveats,
    links,
    legacy: readLegacy(root),
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

/** A text without its `**` markers: what a head or a heading says, however it is bolded. */
const stripBold = (text: string): string => text.replace(/\*\*/g, '').trim()

/** Words in a text: whitespace-separated, `**` markers ignored. */
export const wordCount = (text: string): number => stripBold(text).split(/\s+/).filter(word => word !== '').length

/** The first words of a line, so an issue says which line it is about. */
function excerpt(text: string, count = 6): string {
  const words = oneLine(stripBold(text)).split(' ').filter(word => word !== '')
  return `${words.slice(0, count).join(' ')}${words.length > count ? '...' : ''}`
}

// A small English stopword list: the words that do not make a heading or head say something of its own.
const STOPWORDS = new Set(
  ('a an the and or but nor so yet of to in on at by for from with without into onto over under about as is are was were be ' +
    'been being am it its this that these those there here we our us you your they them their he she his her i me my not no ' +
    'do does did done has have had will would can could should may might shall must than then too very also just only more ' +
    'most some any each both all other such which who whom whose what when where why how if').split(' '),
)

/** The words of a text that say something: lowercased, punctuation stripped, stopwords left out. */
const contentWords = (text: string): string[] =>
  stripBold(text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(word => word !== '' && !STOPWORDS.has(word))

/** True when a section heading or L1 head mostly repeats the headline: REPEAT_SHARE of its content words (at least REPEAT_MIN_WORDS of them) are in it. */
function repeatsHeadline(text: string, headline: string): boolean {
  const words = contentWords(text)
  if (words.length < REPEAT_MIN_WORDS) return false
  const seen = new Set(contentWords(headline))
  return words.filter(word => seen.has(word)).length / words.length >= REPEAT_SHARE
}

/**
 * The issues of `body`, read through parseBody as it is drawn. A heading is at most MAX_HEADING_WORDS words; every L1
 * and L2 bullet is `head: tail` with a head of MIN_HEAD_WORDS to MAX_HEAD_WORDS words and a tail of at most 1 (L1) or 2
 * (L2) sentences; bullets go at most MAX_BODY_LEVELS deep. Headings and L1 bullets are drawn in exec, so they get the
 * id, URL, code and path scan; from L2 down evidence is allowed, and L3 (anything indented under an L2 bullet) is
 * freeform and never checked. A heading or L1 head that mostly repeats the headline is turned away. Every other line is a
 * heading or a bullet, with one exception: a section that is one fenced code block after its heading is a diagram and is
 * exempt from the bullet rules.
 */
function bodyIssues(body: string, headline: string): string[] {
  if (body.trim() === '') return []
  const issues: string[] = []
  const repeats = (text: string) => `body "${stripBold(text)}" repeats the headline: say something the headline doesn't`
  for (const section of parseBody(unescapeBreaks(body))) {
    const bullets = section.rows.filter((row): row is BodyBullet => row.kind === 'bullet')
    const real = bullets.filter(row => !row.isStray)
    const name = section.heading ?? (excerpt(real[0]?.text ?? '') || 'no heading')
    if (section.heading !== undefined) {
      const words = wordCount(section.heading)
      if (words > MAX_HEADING_WORDS) issues.push(`body heading "${section.heading}" has ${words} words (max ${MAX_HEADING_WORDS}): shorten it`)
      issues.push(...scanField(`body heading "${section.heading}"`, section.heading))
      if (repeatsHeadline(section.heading, headline)) issues.push(repeats(section.heading))
    }
    for (const row of bullets.filter(bullet => bullet.isStray)) issues.push(`body: write "${excerpt(row.text)}" as a bullet under a heading`)
    // A top-level table or code block is rejected, a lone fenced block under a heading (a diagram) excepted.
    if (!isDiagram(section)) {
      const top = section.rows.filter(row => row.kind === 'block' && row.level === 1)
      if (top.some(row => row.kind === 'block' && row.isCode)) {
        issues.push(
          `body section "${name}" has a top-level code block: nest it under a bullet (L2 or deeper), or give the diagram its own section with the code block as its only content`,
        )
      }
      if (top.some(row => row.kind === 'block' && !row.isCode)) {
        issues.push(`body section "${name}" has a top-level table: nest it under a bullet (L2 or deeper)`)
      }
    }
    if (real.some(row => row.level > MAX_BODY_LEVELS)) {
      issues.push(`body section "${name}" goes 4 levels deep (max ${MAX_BODY_LEVELS}): condense the top levels`)
    }
    for (const row of real) {
      if (row.level > 2) continue
      const label = `body L${row.level} bullet "${excerpt(row.head === '' ? row.text : row.head)}"`
      const words = wordCount(row.head)
      if (words < MIN_HEAD_WORDS || words > MAX_HEAD_WORDS) {
        issues.push(`${label} has a head of ${words} words (needs ${MIN_HEAD_WORDS} to ${MAX_HEAD_WORDS}): write the head as a sentence, then ": tail"`)
      }
      const max = row.level === 1 ? MAX_L1_TAIL_SENTENCES : MAX_L2_TAIL_SENTENCES
      const count = countSentences(oneLine(row.tail))
      if (count > max) issues.push(`${label} has a tail of ${count} sentences (max ${max}): put the rest in an L${row.level + 1} bullet`)
      if (row.level === 1) {
        issues.push(...scanField(label, row.text))
        if (repeatsHeadline(row.head, headline)) issues.push(repeats(row.head))
      }
    }
  }
  return [...new Set(issues)]
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

  const { headline } = reply
  const fix = `headline: a summary of the whole reply in at most ${MAX_HEADLINE_SENTENCES} sentences and ${MAX_HEADLINE_WORDS} words`
  if (headline === undefined) {
    if (reply.legacy.answer !== undefined) issues.push(`answer is no longer a field: send ${fix}`)
    else if (!problems.includes('headline should be a string')) issues.push(`headline is missing (${fix})`)
  } else {
    const flat = oneLine(headline)
    const words = wordCount(flat)
    if (flat === '') issues.push(`headline is empty (${fix})`)
    if (words > MAX_HEADLINE_WORDS) issues.push(`headline has ${words} words (max ${MAX_HEADLINE_WORDS}): ${fix}`)
    const count = countSentences(flat)
    if (count > MAX_HEADLINE_SENTENCES) issues.push(`headline has ${count} sentences (max ${MAX_HEADLINE_SENTENCES}): ${fix}`)
    issues.push(...scanField('headline', headline))
  }

  // These are no longer fields: a new call that sends one is turned away and told where its content goes now (they are
  // still read when drawing a past reply, see readLegacy). The rest of what such a call holds is not checked.
  const input = parseInput(raw)
  const isSent = (key: string): boolean => isRecord(input) && input[key] !== undefined && input[key] !== null
  const removed: [string, string][] = [
    ['summary', `fold it into the headline (at most ${MAX_HEADLINE_SENTENCES} sentences and ${MAX_HEADLINE_WORDS} words)`],
    ['status', 'put it in the body, as a section of bullets'],
    ['details', 'put it in the body, as L2 and L3 bullets under the L1 bullet they support'],
    ['next', 'drop it, or make it a decision option'],
    ['questions', 'put the answer in the headline and the body'],
    ['decisions', 'send one decision whose 2 to 4 options are whole plans'],
  ]
  for (const [key, where] of removed) if (isSent(key)) issues.push(`${key} is no longer a field: ${where}`)

  issues.push(...bodyIssues(reply.body, headline ?? ''))

  const { decision } = reply
  if (decision !== undefined) {
    const fix = 'make each option a whole plan that bundles the sub-choices'
    // A missing or mistyped choice is already a problem above; only a blank string is left to say here.
    if (decision.choice.trim() === '' && !problems.some(problem => problem.startsWith('decision.choice '))) {
      issues.push('decision.choice is empty: ask the one call the user must make as a question')
    }
    const choiceWords = wordCount(decision.choice)
    if (choiceWords > MAX_CHOICE_WORDS) {
      issues.push(`decision.choice has ${choiceWords} words (max ${MAX_CHOICE_WORDS}): ask the one call as a short question`)
    }
    issues.push(...scanField('decision.choice', decision.choice))
    const count = decision.options.length
    if (count < MIN_OPTIONS) issues.push(`decision has ${count} option(s) (needs ${MIN_OPTIONS} to ${MAX_OPTIONS}): ${fix}`)
    if (count > MAX_OPTIONS) issues.push(`decision has ${count} options (max ${MAX_OPTIONS}): ${fix}`)
    const recommended = decision.options.filter(option => option.stance === 'recommended').length
    if (recommended === 0) issues.push('decision has no option with stance recommended')
    if (recommended > 1) issues.push(`decision has ${recommended} options with stance recommended (exactly 1)`)
    decision.options.forEach((option, j) => {
      // A LEGACY option (name and consequence) already got its one issue from normalizeReply.
      if (option.isLegacy === true) return
      const path = `decision.options[${j}]`
      const words = wordCount(option.head)
      if (words < MIN_HEAD_WORDS || words > MAX_HEAD_WORDS) {
        issues.push(`${path}.head has ${words} words (needs ${MIN_HEAD_WORDS} to ${MAX_HEAD_WORDS}): say the plan as a sentence; the detail goes in body`)
      }
      issues.push(...scanField(`${path}.head`, option.head))
      sentences(`${path}.body`, option.body, MAX_OPTION_BODY_SENTENCES)
      issues.push(...scanField(`${path}.body`, option.body))
    })
  }

  if (reply.caveats.length > MAX_CAVEATS) issues.push(`caveats has ${reply.caveats.length} entries (max ${MAX_CAVEATS})`)
  reply.caveats.forEach((caveat, i) => {
    const path = `caveats[${i}].text`
    const words = wordCount(caveat.text)
    if (words > MAX_CAVEAT_WORDS) issues.push(`${path} has ${words} words (max ${MAX_CAVEAT_WORDS}): keep the point and put the evidence in details`)
    sentences(path, caveat.text, MAX_CAVEAT_SENTENCES)
    issues.push(...scanField(path, caveat.text))
  })

  reply.links.forEach((link, i) => {
    const path = link.path.trim()
    if (isAbsolutePath(path) || isWebUrl(path)) return
    issues.push(`links[${i}].path should be an absolute path or an http(s) URL`)
  })

  return issues
}

// ---------------------------------------------------------------------------------------------
// Rendering: one markdown string per view, drawn with the surface's Markdown element.

/** The tag before a recommended option's head. */
export const RECOMMENDED_TAG = '[Recommended]'

/** Model-supplied text on one line, so a line break cannot end a code span or start a block. */
export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

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

/** The address a link points at, or undefined when the path is neither an absolute path nor an http(s) URL. */
export function linkTarget(link: ReplyLink): string | undefined {
  const path = link.path.trim()
  if (isAbsolutePath(path)) return fileUrl(path)
  if (isWebUrl(path)) return webUrl(path)
  return undefined
}

/**
 * Just the label, as a markdown link. Only an absolute path or an http(s) URL is a link; any other path
 * (relative, `javascript:`, `data:`, ...) stays a code span after the label, so a label never sets the target.
 */
function renderLink(link: ReplyLink): string {
  const label = escapeMarkdown(oneLine(link.label)) || escapeMarkdown(oneLine(link.path))
  const url = linkTarget(link)
  return url === undefined ? `${label}: ${codeSpan(link.path.trim())}` : `[${label}](${url})`
}

/** One line in bold; an empty line, or one that already holds `**`, is left as the model wrote it. */
function boldLine(line: string): string {
  const match = /^(\s*(?:[-*+]|\d+[.)])?\s*)(.*?)(\s*)$/.exec(line)
  if (match === null || match[2] === undefined || match[2] === '' || line.includes('**')) return line
  return `${match[1] ?? ''}**${match[2]}**${match[3] ?? ''}`
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

function unescapeDecision(decision: ReplyDecision): ReplyDecision {
  const u = unescapeBreaks
  return { choice: u(decision.choice), options: decision.options.map(o => ({ ...o, head: u(o.head), body: u(o.body) })) }
}

function unescapeReply(reply: Reply): Reply {
  const u = unescapeBreaks
  const { legacy } = reply
  return {
    headline: reply.headline === undefined ? undefined : u(reply.headline),
    body: u(reply.body),
    decision: reply.decision === undefined ? undefined : unescapeDecision(reply.decision),
    caveats: reply.caveats.map(c => ({ text: u(c.text), details: u(c.details) })),
    links: reply.links,
    legacy: {
      answer: legacy.answer === undefined ? undefined : u(legacy.answer),
      summary: u(legacy.summary),
      status: u(legacy.status),
      details: u(legacy.details),
      next: u(legacy.next),
      questions: legacy.questions.map(q => ({ ask: u(q.ask), verdict: u(q.verdict), why: u(q.why), details: u(q.details) })),
      decisions: legacy.decisions.map(d => ({ ...unescapeDecision(d), pick: u(d.pick) })),
    },
  }
}

// ---------------------------------------------------------------------------------------------
// The outline: a reply is one list of blocks, each a list of lines. Every line is one unit of a type, and the
// LEVELS table below says which view first shows that type (1 = tldr, 2 = exec, 3 = full). A view is the same
// outline with the lines above its level left out, so nothing reorders or restyles between views: lines only
// appear or disappear.

export type Depth = 1 | 2 | 3
export const DEPTH: Record<ReplyView, Depth> = { tldr: 1, exec: 2, full: 3 }

/** What a drawn line is. Each type has one entry in LEVELS. The units after the LEGACY comment only draw replies from before 0.1.14. */
export type Unit =
  | 'headline'
  | 'bodySection'
  | 'bodyHead'
  | 'bodyTail'
  | 'bodyL2'
  | 'bodyL3'
  | 'bodyDiagram'
  | 'decision'
  | 'option'
  | 'optionBody'
  | 'caveat'
  | 'caveatDetails'
  | 'link'
  | 'linksHeading'
  // LEGACY
  | 'summary'
  | 'verdict'
  | 'reason'
  | 'evidence'
  | 'section'
  | 'bullet'
  | 'subbullet'
  | 'statusSection'
  | 'statusBullet'
  | 'statusSub'
  | 'next'

/**
 * The one table: the first view that shows each unit type (1 = tldr, 2 = exec, 3 = full). Relabelling a type is a
 * one-line edit here. A child never shows before its parent: when a parent's level is higher than its child's, the
 * child takes the parent's (bodySection > bodyHead > bodyL2 > bodyL3; decision > option; caveat > caveatDetails; and, for
 * old replies, headline > summary; verdict > reason > evidence; section > bullet > subbullet; statusSection >
 * statusBullet > statusSub). `bodyTail` and `optionBody` are not lines of their own: they are what an L1 head or an
 * option grows by (see `extend`), so they show with the line that holds them. `linksHeading` is the bold heading above
 * the links, which tldr leaves out.
 */
export const LEVELS: Record<Unit, Depth> = {
  headline: 1, // bold summary of the whole reply
  bodySection: 2, // a body section heading: `1. **Heading**`, numbered in the order of the reply
  bodyHead: 2, // an L1 bullet: its head, plain (bold only once its tail is drawn after it)
  bodyTail: 3, // an L1 bullet's tail, after its head
  bodyL2: 3, // an L2 bullet (`head: tail`, bold head only with a tail), or a table or code block nested at L2
  bodyL3: 3, // L3: freeform markdown under an L2 bullet
  bodyDiagram: 2, // a diagram section's fenced block
  decision: 1, // the `**choice** <recommended option head>` line
  option: 2, // `- [Recommended] Head`: plain, bold only once its body is drawn after it
  optionBody: 3, // the option's `: body`, after its head
  caveat: 2, // `⚠ text`
  caveatDetails: 3, // a caveat's details, nested under it
  link: 1, // each link
  linksHeading: 2,
  // LEGACY (before 0.1.14)
  summary: 3, // the line under the headline
  verdict: 2, // (before 0.1.13) a question's `**ask** verdict` line
  reason: 2, // a question's one-line bold reason bullet
  evidence: 3, // a question's `details`, nested under the reason
  section: 3, // a `details` outline heading
  bullet: 3, // a `details` top-level bullet or paragraph
  subbullet: 3, // a nested `details` bullet
  statusSection: 2, // a `status` outline heading
  statusBullet: 2, // a `status` top-level bullet or paragraph
  statusSub: 3, // a nested `status` bullet
  next: 1, // `→ ...`
}

/** The units that head a block: the lines under one are drawn one step in (a box in the terminal, a nested list in markdown). */
export const HEAD_UNITS: readonly Unit[] = [
  'bodySection',
  'decision',
  'caveat',
  'linksHeading',
  // LEGACY
  'statusSection',
  'section',
  'verdict',
]

/**
 * The icon that opens the first line of each kind of block, in two sets. A body section has none: it opens with its number
 * (see bodyBlocks). `question`, `details`, `status` and `next` are LEGACY (drawn only for a reply from before 0.1.14).
 */
export const ICONS = {
  glyph: { answer: '●', question: '◆', decision: '◇', caveat: '⚠', details: '≡', status: '▸', next: '→', links: '↗' },
  emoji: { answer: '🎯', question: '💬', decision: '🔀', caveat: '⚠️', details: '📋', status: '📍', next: '➡️', links: '🔗' },
} as const
export type IconSet = keyof typeof ICONS
/** The set in use: glyphs, which every terminal font draws. */
export const ICON_SET: IconSet = 'glyph'

/**
 * A line that grows when a later unit shows: `extend` is appended once `extendUnit` (the evidence of a LEGACY reason when
 * absent) is at or below the view. A markdown line takes it into its text; a `bullet` or an `option` takes it as its `tail`.
 */
type Grows = { extend?: string; extendUnit?: Unit }
export type Line =
  // `ordinal` is set on a numbered body section heading, whose `text` is `N. **Heading**`, an ordered-list item. The
  // terminal draws that number as literal text instead (see literalOrdinal).
  | ({ kind: 'md'; unit: Unit; via?: Unit[]; text: string; ordinal?: number; isCode?: boolean; isProse?: boolean } & Grows)
  // An L1 or L2 body bullet: its list `marker` (indent included), its `head` with no `**`, and its `tail` once it is drawn
  // (`: tail`). The head is bold only when a tail follows it.
  | ({ kind: 'bullet'; unit: Unit; via?: Unit[]; marker: string; head: string; tail?: string } & Grows)
  | ({ kind: 'option'; unit: Unit; via?: Unit[]; option: ReplyOption; tail?: string } & Grows)
  | { kind: 'link'; unit: Unit; via?: Unit[]; link: ReplyLink }
export type Block = Line[]

/** The first view that shows a line: its own level, or its ancestors' when one of them is higher. */
export const levelOf = (line: Line): Depth => Math.max(LEVELS[line.unit], ...(line.via ?? []).map(unit => LEVELS[unit])) as Depth

const BULLET = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/
const isBulletText = (text: string): boolean => BULLET.test(text)

/**
 * `Label: text` with the label bold. The label is up to 6 words with no backtick, `*` or URL, and the colon is
 * followed by a space or ends the line (a colon in `10:00` does not count). Text that already opens bold is left alone.
 */
export function boldLabel(content: string): string {
  if (content.startsWith('**') || content.includes('://')) return content
  const match = /^([^:`*]+?):(?=\s|$)\s*(.*)$/.exec(content)
  const label = match?.[1]?.trim() ?? ''
  if (match === null || label === '' || label.split(/\s+/).length > 6) return content
  const rest = match[2] ?? ''
  return `**${label}**:${rest === '' ? '' : ` ${rest}`}`
}

/** A markdown bullet line with its label bolded; any other line is returned as it is. */
export function boldBullet(line: string): string {
  const match = BULLET.exec(line)
  return match === null ? line : `${match[1] ?? ''}${boldLabel(match[2] ?? '')}`
}

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/
const TABLE = /^\s*\|/
/** A line that opens a code block (a fence that does not close on the same line). */
const opensFence = (line: string): boolean => {
  const t = line.trim()
  return FENCE.test(t) && !t.slice(3).includes(t.slice(0, 3))
}

/**
 * LEGACY (replies before 0.1.14): reads a past reply's `status` and `details`; the body is read by parseBody.
 * Markdown the model wrote as an outline, read into blocks. Section headings (a `#` heading or a bold-only line)
 * start a block (unit `section`); top-level bullets, paragraphs and tables are `bullet` units; anything indented
 * under a bullet, with a code block nested there, is a `subbullet`. Under a heading, a line's parent is the section.
 * Blank lines are dropped (lists are tight); a change of kind starts a new block.
 */
export function parseOutline(
  text: string,
  units: { section: Unit; bullet: Unit; subbullet: Unit } = { section: 'section', bullet: 'bullet', subbullet: 'subbullet' },
): Block[] {
  const blocks: Block[] = []
  let block: Block | undefined
  let kind = ''
  let afterBlank = false
  let isInFence = false
  let hasHeading = false
  let fenceUnit: Unit = units.bullet
  const via = (unit: Unit): Unit[] | undefined => {
    const up: Unit[] = hasHeading && unit !== units.section ? [units.section] : []
    if (unit === units.subbullet) up.push(units.bullet)
    return up.length === 0 ? undefined : up
  }
  const make = (unit: Unit, text: string, isCode?: boolean): Line => {
    const up = via(unit)
    return { kind: 'md', unit, ...(up === undefined ? {} : { via: up }), text, ...(isCode === undefined ? {} : { isCode }) }
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (isInFence) {
      block?.push(make(fenceUnit, line, true))
      if (FENCE.test(line)) isInFence = false
      continue
    }
    if (line.trim() === '') {
      afterBlank = true
      continue
    }
    const isNested = /^\s/.test(line) && kind === 'bullet'
    const isFence = FENCE.test(line)
    const k = isNested
      ? kind
      : isFence
        ? 'code'
        : HEADING.test(line)
          ? 'heading'
          : isBulletText(line)
            ? 'bullet'
            : TABLE.test(line)
              ? 'table'
              : 'para'
    if (!isNested) {
      const isSplit =
        block === undefined || k === 'heading' || k === 'code' || (kind !== k && kind !== 'heading') || (k === 'para' && afterBlank)
      if (isSplit) {
        block = []
        blocks.push(block)
        hasHeading = k === 'heading'
      }
      kind = k
    }
    afterBlank = false
    const unit: Unit = isNested ? units.subbullet : k === 'heading' ? units.section : units.bullet
    block?.push(make(unit, isFence ? line : boldBullet(line), isFence || undefined))
    if (isFence && opensFence(line)) {
      isInFence = true
      fenceUnit = unit
    }
  }
  return blocks
}

/** One bullet of the body: its level (1 to 3; deeper is turned away), its text after the marker, and that text split at its first colon. */
export type BodyBullet = {
  kind: 'bullet'
  level: number
  text: string
  head: string
  tail: string
  /** A plain paragraph line, kept as an L1 bullet so it still draws; the validator turns it away. */
  isStray?: boolean
}
/**
 * A line of the body that is not a bullet: a table row, a line of a fenced code block (`isCode`) or prose, a block quote
 * included (`isProse`). `text` is already indented under the bullet it hangs from, and `level` is the level it is drawn
 * at: 1 is the top of a section (only a diagram may be there), 2 hangs from an L1 bullet, 3 or more is L3.
 */
export type BodyBlock = { kind: 'block'; level: number; text: string; isCode: boolean; isProse: boolean }
export type BodyRow = BodyBullet | BodyBlock
/** A heading and what follows it; `topFences` counts the code blocks written at the top of the section. */
export type BodySection = { heading: string | undefined; rows: BodyRow[]; topFences: number }

/**
 * A section heading as it reads: no `#`, no `**`, no trailing colon, and no number the model wrote itself (`1. `, `2) `,
 * `Step 3: `, `Part 2. `, `Section 4) `), since the drawing numbers the sections.
 */
const headingText = (line: string): string =>
  stripBold(line.trim().replace(/^#{1,6}\s+/, ''))
    .replace(/[:\s]+$/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\s*(?:Step|Part|Section)\s+\d+[:.)-]?\s+/i, '')
    .trim()

/**
 * A bullet's text as `head: tail`. The head is the text before the first colon that is followed by a space or the line
 * end (a bold `**Head:**` counts), with its `**` markers dropped; with no such colon the whole bullet is the head and
 * the tail is empty.
 */
export function splitHeadTail(text: string): { head: string; tail: string } {
  const flat = oneLine(text)
  const match = /:(?:\*\*)?(?=\s|$)/.exec(flat)
  if (match === null) return { head: stripBold(flat), tail: '' }
  return { head: stripBold(flat.slice(0, match.index)), tail: flat.slice(match.index + match[0].length).trim() }
}

const indentOf = (line: string): number => (/^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length

/**
 * The body read into sections. A section is a heading (a `#` heading or a bold-only line at the left edge) and what
 * follows it; bullets before the first heading are a section with no heading. A bullet's level is how many bullets it
 * hangs from by indentation, plus one. A table row, a code fence or prose is read by the bullets it is indented under:
 * under none it is at the top of the section (level 1), under one it is level 2, and under two or more it is L3, which
 * holds any markdown. A plain line with fewer than two bullets above it is a stray paragraph (an L1 bullet flagged as
 * such). Lines inside a code fence are code, whatever they look like.
 */
export function parseBody(text: string): BodySection[] {
  const sections: BodySection[] = []
  const current = (): BodySection => {
    let section = sections.at(-1)
    if (section === undefined) {
      section = { heading: undefined, rows: [], topFences: 0 }
      sections.push(section)
    }
    return section
  }
  const pad = (level: number): string => '  '.repeat(level - 1)
  let open: number[] = []
  let fence: { indent: number; level: number } | undefined
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (fence !== undefined) {
      const code = line.replace(new RegExp(`^\\s{0,${fence.indent}}`), '')
      current().rows.push({ kind: 'block', level: fence.level, text: code === '' ? '' : pad(fence.level) + code, isCode: true, isProse: false })
      if (FENCE.test(line)) fence = undefined
      continue
    }
    if (line.trim() === '') continue
    const indent = indentOf(line)
    if (indent === 0 && HEADING.test(line)) {
      sections.push({ heading: headingText(line), rows: [], topFences: 0 })
      open = []
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet !== null) {
      while (open.length > 0 && (open.at(-1) ?? 0) >= indent) open.pop()
      open.push(indent)
      current().rows.push({ kind: 'bullet', level: open.length, text: (bullet[2] ?? '').trim(), head: '', tail: '' })
      continue
    }
    const depth = open.filter(at => at < indent).length
    const level = depth + 1
    const isFence = FENCE.test(line)
    const isTable = TABLE.test(line)
    if (isFence || isTable || depth >= 2) {
      const section = current()
      if (isFence && depth === 0) section.topFences += 1
      section.rows.push({ kind: 'block', level, text: pad(level) + line.trim(), isCode: isFence, isProse: !isFence && !isTable })
      if (isFence && opensFence(line)) fence = { indent, level }
      continue
    }
    current().rows.push({ kind: 'bullet', level: 1, text: line.trim(), head: '', tail: '', isStray: true })
  }
  for (const section of sections) {
    for (const row of section.rows) if (row.kind === 'bullet') Object.assign(row, splitHeadTail(row.text))
  }
  return sections
}

/** A diagram section: a heading, then exactly one fenced code block and nothing else. It is exempt from the bullet rules. */
export const isDiagram = (section: BodySection): boolean =>
  section.heading !== undefined && section.topFences === 1 && section.rows.every(row => row.kind === 'block' && row.isCode && row.level === 1)

/** The first sentence of a text, and the rest ("" when it is one sentence). */
export function splitFirstSentence(text: string): [string, string] {
  const trimmed = oneLine(text)
  const masked = trimmed.replace(ABBREVIATION, '$1$2․')
  const match = /[.!?](?=\s+[A-Z0-9])/.exec(masked)
  if (match === null) return [trimmed, '']
  const cut = match.index + 1
  return [trimmed.slice(0, cut).trim(), trimmed.slice(cut).trim()]
}

/** A headline as drawn: one line, no trailing full stop. */
const headlineText = (text: string): string => oneLine(text).replace(/\.+$/, '')

/**
 * LEGACY (replies before 0.1.13, which had `questions`). A question's supporting bullet. `why` is the reason headline (bold); `details` is the evidence under it: its
 * leading prose follows the headline as `: prose`, its lists nest under it. An old multi-sentence `why` gives its
 * first sentence as the reason and the rest as leading prose. With no `why`, the details are the question's own bullets.
 * The reason is a child of the verdict; the evidence is a child of the reason (or of the verdict, with no reason).
 */
function supportLines(why: string, details: string): Line[] {
  const all = details.split('\n')
  const lines: Line[] = []
  const [headline, oldRest] = splitFirstSentence(why)
  const hasHead = headline !== ''
  // Leading prose: the non-blank rows before the first bullet, fence or indented row.
  const isListRow = (row: string): boolean => isBulletText(row) || FENCE.test(row) || /^\s/.test(row)
  let at = 0
  const proseRows: string[] = []
  if (hasHead) {
    while (at < all.length && !isListRow(all[at] ?? '')) {
      if ((all[at] ?? '').trim() !== '') proseRows.push((all[at] ?? '').trim())
      at += 1
    }
  }
  const prose = [oldRest, ...proseRows].filter(part => part !== '').join(' ')
  const indent = hasHead ? '  ' : ''
  const evidenceVia: Unit[] = hasHead ? ['verdict', 'reason'] : ['verdict']
  if (hasHead) {
    lines.push({
      kind: 'md',
      unit: 'reason',
      via: ['verdict'],
      text: `- **${headlineText(headline)}**`,
      ...(prose === '' ? {} : { extend: `: ${prose}` }),
    })
  }
  const evidence = (text: string, isCode?: boolean): Line => ({
    kind: 'md',
    unit: 'evidence',
    via: evidenceVia,
    text,
    ...(isCode === undefined ? {} : { isCode }),
  })
  let isInFence = false
  for (const row of all.slice(at)) {
    if (isInFence) {
      lines.push(evidence(`${indent}${row}`, true))
      if (FENCE.test(row)) isInFence = false
      continue
    }
    if (row.trim() === '') continue
    if (FENCE.test(row)) {
      lines.push(evidence(`${indent || '  '}${row.trimEnd()}`, true))
      isInFence = opensFence(row)
      continue
    }
    const text = isBulletText(row) ? boldBullet(row) : /^\s/.test(row) ? row : `- ${boldLabel(row.trim())}`
    lines.push(evidence(`${indent}${text.trimEnd()}`))
  }
  return lines
}

/**
 * `text` opened by an icon. A `#` heading becomes a bold line; a bullet takes the icon after its marker (so it stays
 * a list item); a table row, a code fence or an indented line is left as it is, since an icon would break it.
 */
export function withIcon(text: string, icon: string): string {
  const heading = /^#{1,6}\s+(.*)$/.exec(text)
  const plain = heading === null ? text : `**${heading[1] ?? ''}**`
  const bullet = BULLET.exec(plain)
  if (bullet !== null) return `${bullet[1] ?? ''}${icon} ${bullet[2] ?? ''}`
  if (TABLE.test(plain) || FENCE.test(plain) || /^\s/.test(plain)) return plain
  return `${icon} ${plain}`
}

type MdLine = Extract<Line, { kind: 'md' }>
type BulletLine = Extract<Line, { kind: 'bullet' }>
type Icons = (typeof ICONS)[IconSet]
const mdLine = (unit: Unit, text: string, via?: Unit[]): MdLine => ({ kind: 'md', unit, ...(via === undefined ? {} : { via }), text })
const bulletLine = (unit: Unit, marker: string, head: string, via?: Unit[]): BulletLine => ({
  kind: 'bullet',
  unit,
  ...(via === undefined ? {} : { via }),
  marker,
  head,
})

/** The units of the body's bullets by level (L1, L2, L3): a line hangs from the units of the levels above it. */
const BODY_LEVEL_UNITS: readonly Unit[] = ['bodyHead', 'bodyL2', 'bodyL3']

/**
 * The body as blocks, one per section: its heading, numbered `1. **Heading**` in the order of the reply (a diagram
 * section counts; the unnamed section before the first heading has no number), then its rows. An L1 or L2 bullet keeps
 * its head and its tail apart: an L1 tail is an `extend` that joins its head once the tail shows, an L2 tail is drawn
 * with its bullet. The head is bold only when a tail follows it (see lineMarkdown), and any `**` the model wrote in it is
 * dropped, so it cannot force bold. L3 is drawn as it was written. A diagram section draws its fenced block as one unit.
 */
function bodyBlocks(body: string): Block[] {
  const blocks: Block[] = []
  let count = 0
  for (const section of parseBody(body)) {
    const block: Block = []
    const isDiagramSection = isDiagram(section)
    // What a row of this level hangs from: the heading, then the unit of each level above it.
    const hang = (level: number): Unit[] | undefined => {
      const up: Unit[] = [...(section.heading === undefined ? [] : (['bodySection'] as const)), ...BODY_LEVEL_UNITS.slice(0, level - 1)]
      return up.length === 0 ? undefined : up
    }
    if (section.heading !== undefined) {
      count += 1
      block.push({ ...mdLine('bodySection', `${count}. **${section.heading}**`), ordinal: count })
    }
    for (const row of section.rows) {
      const unit: Unit = isDiagramSection ? 'bodyDiagram' : (BODY_LEVEL_UNITS[Math.min(row.level, 3) - 1] ?? 'bodyL3')
      const via = hang(isDiagramSection ? 1 : row.level)
      if (row.kind === 'block') {
        block.push({ ...mdLine(unit, row.text, via), ...(row.isCode ? { isCode: true } : {}), ...(row.isProse ? { isProse: true } : {}) })
        continue
      }
      const pad = '  '.repeat(row.level - 1)
      // L3 is freeform: its text goes out as it was written.
      if (row.level >= 3) {
        block.push(mdLine(unit, `${pad}- ${row.text}`, via))
        continue
      }
      const head = stripBold(row.head === '' ? row.tail : row.head)
      const tail = row.head === '' ? '' : row.tail
      const line = bulletLine(unit, `${pad}- `, head, via)
      if (tail === '') block.push(line)
      else block.push(row.level === 1 ? { ...line, extend: `: ${tail}`, extendUnit: 'bodyTail' } : { ...line, tail: `: ${tail}` })
    }
    if (block.length > 0) blocks.push(block)
  }
  return blocks
}

/**
 * Free-form text as the lines of a list nested under a head: a line that is not a bullet, a table row, an indented
 * line or code becomes a bullet; the rest stays as it was written.
 */
function freeLines(text: string, unit: Unit, via: Unit[]): MdLine[] {
  const lines: MdLine[] = []
  let isInFence = false
  for (const raw of text.split('\n')) {
    const row = raw.trimEnd()
    if (isInFence) {
      lines.push({ ...mdLine(unit, row, via), isCode: true })
      if (FENCE.test(row)) isInFence = false
      continue
    }
    if (row.trim() === '') continue
    if (FENCE.test(row)) {
      lines.push({ ...mdLine(unit, row, via), isCode: true })
      isInFence = opensFence(row)
      continue
    }
    lines.push(mdLine(unit, isBulletText(row) || TABLE.test(row) || /^\s/.test(row) ? row : `- ${row.trim()}`, via))
  }
  return lines
}

/** The outline units of `status`, for reading it as drawn. LEGACY (before 0.1.14). */
const STATUS_UNITS = { section: 'statusSection', bullet: 'statusBullet', subbullet: 'statusSub' } as const

/** LEGACY (replies before 0.1.14): the blocks a past reply's `status` and `questions` draw, right after its headline. */
function legacyOpening(legacy: LegacyFields, icon: Icons): Block[] {
  const blocks: Block[] = []
  if (legacy.status.trim() !== '') {
    for (const block of parseOutline(legacy.status, STATUS_UNITS)) {
      const first = block[0]
      if (first !== undefined && first.kind === 'md') first.text = withIcon(first.text, icon.status)
      blocks.push(block)
    }
  }
  // (before 0.1.13) the questions
  for (const q of legacy.questions) {
    if (q.ask.trim() === '' && q.verdict.trim() === '') continue
    const ask = q.ask.trim() === '' ? '' : `**${oneLine(q.ask)}**`
    const block: Block = [mdLine('verdict', `${icon.question} ${[ask, oneLine(q.verdict)].filter(part => part !== '').join(' ')}`)]
    if (q.why.trim() !== '' || q.details.trim() !== '') block.push(...supportLines(q.why, q.details))
    blocks.push(block)
  }
  return blocks
}

/** LEGACY (replies before 0.1.14): `details` and the next step, which a past reply draws after its caveats. */
function legacyClosing(legacy: LegacyFields, icon: Icons): Block[] {
  const blocks: Block[] = []
  if (legacy.details.trim() !== '') {
    for (const block of parseOutline(legacy.details)) {
      const first = block[0]
      if (first !== undefined && first.kind === 'md') first.text = withIcon(first.text, icon.details)
      blocks.push(block)
    }
  }
  if (legacy.next.trim() !== '') blocks.push([mdLine('next', `${icon.next} ${oneLine(legacy.next)}`)])
  return blocks
}

/** The whole reply as blocks, every level: headline, body, the decision, caveats, links (a past reply's other fields draw where they used to). */
export function buildBlocks(raw: unknown, icons: IconSet = ICON_SET): Block[] {
  const reply = unescapeReply(normalizeReply(raw).reply)
  const { legacy } = reply
  const icon = ICONS[icons]
  const blocks: Block[] = []

  // The headline is bold in every view and opens with the answer icon. A reply from before 0.1.9 has no headline: its
  // `answer` is drawn as the headline, and a reply from before 0.1.14 may carry a `summary`, plain text right under it.
  const head = (reply.headline ?? legacy.answer ?? '').split('\n').filter(row => row.trim() !== '')
  const top: Block = head.map((row, i) => mdLine('headline', i === 0 ? `${icon.answer} ${boldLine(row.trimEnd())}` : boldLine(row.trimEnd())))
  if (oneLine(legacy.summary) !== '') top.push(mdLine('summary', oneLine(legacy.summary), ['headline']))
  if (top.length > 0) blocks.push(top)

  blocks.push(...legacyOpening(legacy, icon))
  blocks.push(...bodyBlocks(reply.body))

  // The one decision shows the recommended option's head as its pick. A past reply's `decisions[]` (LEGACY) each
  // carry their own `pick` and draw the same way.
  const recommended = reply.decision?.options.find(option => option.stance === 'recommended')
  const decisions: LegacyDecision[] =
    reply.decision === undefined
      ? legacy.decisions
      : [...legacy.decisions, { ...reply.decision, pick: escapeMarkdown(oneLine(recommended?.head ?? '')) }]
  for (const d of decisions) {
    if (d.choice.trim() === '' && d.pick.trim() === '') continue
    const choice = d.choice.trim() === '' ? '' : `**${oneLine(d.choice)}**`
    const block: Block = [mdLine('decision', `${icon.decision} ${[choice, oneLine(d.pick)].filter(part => part !== '').join(' ')}`)]
    // The recommended option leads; the others keep their order. Its body joins its head once `optionBody` shows.
    const ordered = [...d.options.filter(o => o.stance === 'recommended'), ...d.options.filter(o => o.stance !== 'recommended')]
    for (const option of ordered) {
      const body = oneLine(option.body)
      block.push({ kind: 'option', unit: 'option', via: ['decision'], option, ...(body === '' ? {} : { extend: `: ${body}`, extendUnit: 'optionBody' }) })
    }
    blocks.push(block)
  }

  // A caveat is its own block: its text, and its details nested under it.
  for (const caveat of reply.caveats) {
    if (caveat.text.trim() === '') continue
    blocks.push([mdLine('caveat', `${icon.caveat} ${oneLine(caveat.text)}`), ...freeLines(caveat.details, 'caveatDetails', ['caveat'])])
  }

  blocks.push(...legacyClosing(legacy, icon))

  const links = reply.links.filter(l => l.label.trim() !== '' || l.path.trim() !== '')
  if (links.length > 0) {
    blocks.push([mdLine('linksHeading', `${icon.links} **Links**`), ...links.map((link): Line => ({ kind: 'link', unit: 'link', link }))])
  }
  return blocks
}

/** The blocks a view shows: the lines at or below its level, and no block left empty. */
export function viewBlocks(raw: unknown, view: ReplyView, icons: IconSet = ICON_SET): Block[] {
  const depth = DEPTH[view]
  // A line with an `extend` grows into its full form once the unit that holds the rest shows: an L1 head takes its
  // tail, an option its body (a LEGACY reason takes its evidence).
  const shown = (line: Line): Line => {
    if (line.kind === 'link' || line.extend === undefined) return line
    if (Math.max(levelOf(line), LEVELS[line.extendUnit ?? 'evidence']) > depth) return line
    return line.kind === 'md' ? { ...line, text: line.text + line.extend, extend: undefined } : { ...line, tail: line.extend, extend: undefined }
  }
  return buildBlocks(raw, icons)
    .map(block => block.filter(line => levelOf(line) <= depth).map(shown))
    .filter(block => block.length > 0)
}

/** A head and its tail: the head is bold only when a tail is drawn after it, plain when it stands alone. */
const headAndTail = (head: string, tail: string | undefined): string => (tail === undefined || tail === '' ? head : `**${head}**${tail}`)

/** One line as markdown. */
export function lineMarkdown(line: Line): string {
  if (line.kind === 'md') return line.text
  if (line.kind === 'link') return `- ${renderLink(line.link)}`
  if (line.kind === 'bullet') return `${line.marker}${headAndTail(line.head, line.tail)}`
  const { option } = line
  const tag = option.stance === 'recommended' ? `${RECOMMENDED_TAG} ` : ''
  return `- ${tag}${headAndTail(escapeMarkdown(oneLine(option.head)), line.tail)}`
}

/**
 * A run of lines as markdown, one per row. A plain line followed by another plain line gets a hard break so
 * the renderer keeps them apart, and so does a line followed by L3 prose (which would otherwise run on from it); a
 * list item, an indented line, a table row or code needs none.
 */
export function joinMarkdown(lines: Line[]): string {
  const isPlain = (line: Line | undefined): boolean => {
    if (line === undefined || line.kind !== 'md' || line.isCode === true) return false
    const t = line.text
    return !isBulletText(t) && !/^\s/.test(t) && !TABLE.test(t) && !FENCE.test(t)
  }
  const isProse = (line: Line | undefined): boolean => line?.kind === 'md' && line.isProse === true
  const needsBreak = (line: Line, next: Line | undefined): boolean =>
    (isPlain(line) && isPlain(next)) ||
    (isProse(next) && (line.kind === 'bullet' || (line.kind === 'md' && line.isCode !== true && !TABLE.test(line.text))))
  return lines.map((line, i) => (needsBreak(line, lines[i + 1]) ? `${lineMarkdown(line)}  ` : lineMarkdown(line))).join('\n')
}

/**
 * The width of the list marker a head is drawn behind, which is how far the lines under it step in: 2 for `- `, 3 for
 * a numbered section's `1. `, 4 for `10. `. Markdown nests a list under an item only by that width; the terminal pads its box by it.
 */
export function markerWidth(head: Line): number {
  return head.kind === 'md' && head.ordinal !== undefined ? `${head.ordinal}. `.length : 2
}

/**
 * A numbered section heading as the terminal draws it: the period after the number is escaped (`2\. **Heading**`), so
 * the heading is literal text, not an ordered-list item. The terminal draws each heading as its own Markdown element,
 * and a renderer that ignored a list's start number would draw every one as `1.`. Any other line is returned as it is.
 * The markdown path keeps the real list item, which CommonMark numbers from its start.
 */
export function literalOrdinal(line: Line): Line {
  if (line.kind !== 'md' || line.ordinal === undefined) return line
  return { ...line, text: `${line.ordinal}\\. ${line.text.slice(`${line.ordinal}. `.length)}` }
}

/**
 * A block as markdown. Markdown cannot nest a list under a paragraph, so a head with lines under it (HEAD_UNITS)
 * becomes a top-level list item (a numbered section is already one: `1. **Heading**`) and every line under it steps in
 * by the width of its marker: its bullets are a nested list, their own bullets nest deeper, and code under a bullet
 * stays inside it. Any other block is joinMarkdown as it is. The terminal does not use this: it indents the lines under
 * a head with a box.
 */
export function blockMarkdown(block: Block): string {
  const head = block[0]
  const rows = joinMarkdown(block).split('\n')
  if (head === undefined || block.length < 2 || !HEAD_UNITS.includes(head.unit)) return rows.join('\n')
  const [first = '', ...rest] = rows
  const pad = ' '.repeat(markerWidth(head))
  return [isBulletText(first) ? first : `- ${first}`, ...rest.map(row => (row === '' ? row : `${pad}${row}`))].join('\n')
}

/** The reply as one markdown string for a view: blocks separated by one blank line. */
export const renderReply = (raw: unknown, view: ReplyView, icons: IconSet = ICON_SET): string =>
  viewBlocks(raw, view, icons).map(blockMarkdown).join('\n\n')

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
  headline: 'Safari checkout is fixed and ready to release. The retry now covers the timeout path, which cut failures from 4% to 0.1%.',
  body: [
    '**Why it broke**',
    '- Safari dropped the session whenever the payment call timed out: no other browser was affected.',
    '  - The retry wrapper now covers that path with two attempts and a short backoff: the second attempt reuses the original session.',
    '    - Fix: retry wrapper in `checkout/pay.ts`, MR !441. Failure rate before 4%, after 0.1%. Measured on the staging mirror. Sampled hourly for 24 hours.',
    '',
    '**Rollout plan**',
    '- Canary goes to five percent of traffic on Thursday morning: it is watched for two hours.',
    '  - Full rollout starts on Friday at 10:00 if the canary stays clean: QA signs off before that.',
    '    | Stage | Traffic | When |',
    '    | --- | --- | --- |',
    '    | Canary | 5% | Thursday |',
    '    | Full | 100% | Friday 10:00 |',
  ].join('\n'),
  decision: {
    choice: 'How should we release the fix?',
    options: [
      {
        head: 'Canary on Thursday, then everyone on Friday after a two hour watch',
        body: 'Customers get the fix 5 days sooner, after a canary that is watched first.',
        stance: 'recommended',
      },
      {
        head: 'Wait a week and run the full regression pass first',
        body: 'Adds one more regression pass. Customers wait the extra week.',
        stance: 'option',
      },
      {
        head: 'Ship today to everyone and skip the QA sign-off entirely',
        body: 'Fastest, but nobody checks the timeout path for regressions.',
        stance: 'not_recommended',
      },
    ],
  },
  caveats: [
    {
      text: 'Safari 16 was not tested.',
      details: 'Only Safari 17 and 18 were in the lab, so the timeout path is untested on the older engine.',
    },
  ],
  links: [{ label: 'Test report', path: '/home/me/reports/checkout.html' }],
} as const

export const CONTRACT_ID = 'reply-tool:contract'

const RULES = [
  '1. `headline` is a bold summary of the whole reply: at most 3 sentences and 60 words, with no ids, paths, URLs or code. It is shown in every view, so it must stand alone. Say each fact once: never repeat the headline anywhere else, and a body heading or L1 head that mostly restates it is rejected.',
  '2. `body` is the only place for explanation, progress and evidence: a markdown outline of sections, each a heading (a `#` heading or a bold-only line of at most 10 words) followed by bullets (the mod numbers sections; don\'t number them yourself); bullets before the first heading are fine. Bullets nest at most 3 levels: L1, then L2 (indented 2 spaces), then L3 (indented 4). Every L1 and L2 bullet is `head: tail` with an 8 to 15 word head that reads as a sentence; L1 tails are one sentence, L2 tails up to two. L3 is freeform markdown (tables, code, lists) for evidence and detail: anything indented under an L2 bullet, with no head and no limits. Every other line is a heading or a bullet, never a plain paragraph, and a table or code block is nested under a bullet.',
  '3. The lengths decide where things land: put short claims in heads and tails, and dump detail in L3. tldr draws the headline, the decision pick and the links; exec adds the section headings, the L1 heads, every option head and the caveats; full adds the L1 tails, L2 and L3, the option bodies and the caveat details.',
  '4. Ids, paths, URLs and inline code are rejected in the headline, section headings, L1 heads and tails, the decision and the caveat text. They are allowed from L2 down, so evidence goes in L2 and L3, and deliverables go in links.',
  '5. Only when the user asks for a diagram: give it its own section, a heading followed by one fenced code block, with nothing else in that section. It is drawn in exec and full.',
  '6. At most one `decision`: the single call the user must make now, a `choice` of at most 15 words asked as a question, then 2 to 4 options that are each a whole plan; fold sub-choices into the options instead of adding decisions. Each option is a `head` (a sentence of 8 to 15 words), then a `body` of what it means and costs (up to 3 sentences). Exactly one is recommended. Add it only when the user must choose: a question or an offer for the user is that decision, or it is left out.',
  '7. Every decision option has a stance: recommended (your pick, exactly one, drawn green), option (a normal alternative, blue) or not_recommended (listed for completeness, not advised, red).',
  '8. `caveats` are at most 3 and appear only when one changes the decision: each is a `text` (at most 2 sentences and 40 words) with optional free-form `details` for the evidence.',
]

const EXAMPLE =`Example of a reply with one decision:\n${JSON.stringify(WORKED_EXAMPLE)}`

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
  // A `**` that opens on punctuation is only bold after a space or a line start, and the marker is neither.
  const gap = /^\*\*[\p{P}\p{S}]/u.test(markdown) ? ' ' : ''
  return markdown === '' ? CLOSING_EMPTY : `${CLOSING_MARK}${gap}${markdown}`
}

// Matches an AssistantMessage that is a closing step: marked, or the old bare invisible text.
export const CLOSING_MATCHER = /^(?:​⁠​|[​\s]*​[​\s]*$)/
