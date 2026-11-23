# reply-tool

A Claude Code mod that makes Claude deliver every reply through a `respond` tool whose input is a structured reply: a headline (the shortest possible answer) with an optional summary, one verdict per question you asked, the decisions you need to make with Claude's pick, caveats, a next step, links, and details. The tool checks each reply against a few rules and sends back the exact issues when it breaks one, and the mod draws the tool row as the formatted reply, at the level of detail you choose.

## Why

Long replies bury the answer. With reply-tool the answer comes first, and you decide how much of the rest you read:

Three views, for three readers:

- `tldr` is for someone who wants fully autonomous execution without knowing how or why: only the shortest status updates towards progress. The bold headline (at most 8 words), the decisions (the choice in bold, then Claude's pick: the recommended option in at most 8 words), the next step, and the links. No verdicts, no options.
- `exec` is for someone who also wants a say in the decisions, with very few whys to build each decision in their head. tldr plus the `status` outline (where things stand, what waits on you: its headings and top-level bullets), one verdict line per question with its one-line reason, each decision's options with their one-line consequences, the caveats, and a `Links` heading. No summary, evidence, nested status bullets or details.
- `full` is for working on one specific problem fully by hand, with every control and every detail. exec plus the summary (1 to 2 sentences under the headline), each question's `details` (the evidence), the nested `status` bullets, and the whole `details` outline (background, how-to, history).

Claude always sends the full reply. The view only changes how it is drawn, so switching views redraws the replies already in the transcript, with nothing lost and nothing to ask again.

## Install

At the prompt of a terminal session (replace `<owner>` with the GitHub account or organization that hosts this repository):

```
/plugin marketplace add <owner>/ai_mods
/plugin install reply-tool@ai_mods
```

The first command asks `Add marketplace?`: answer `y`. The second asks for a scope: pick one with Enter.

The same thing in one line:

```
/plugin install reply-tool --marketplace <owner>/ai_mods
```

From a shell:

```
claude plugin install reply-tool --marketplace <owner>/ai_mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `<owner>/ai_mods`, then Add plugin.

To try it from a local clone without installing it, run this from the repository root:

```
claude --plugin-dir claude_mods/plugins/reply-tool
```

## Usage

reply-tool is off at the start of every session. Two commands:

- `/reply <off|tldr|exec|full>` sets it. With no argument it shows the current setting and the usage.
  - `off`: Claude replies in plain text again. Replies already drawn stay in the transcript, drawn in full.
  - `tldr`, `exec`, `full`: Claude ends each turn with the `respond` tool, and replies are drawn at that level.
- `/reply_stats` shows counters kept across sessions: turns while enabled, replies delivered through `respond`, plain-text fallbacks, replies that still had a validation issue, first calls that passed validation, and rejections.

What each view shows. The three views are one outline cut at three levels: every line of `tldr` is in `exec`, and every line of `exec` is in `full`, in the same order and styled the same. Lines only appear or disappear; nothing reorders.

Every view has the same fixed block order: headline and summary, status sections, questions, decisions, caveats, details sections, next step, links. Links are always last.

Every drawn line is one unit of a type, and one exported table, `LEVELS` in `hooks/reply.ts`, says which view first shows each type (1 = tldr, 2 = exec, 3 = full). Moving a type between views is a one-line edit there.

| Unit | What it is | Level |
| --- | --- | --- |
| `headline` | the bold shortest answer | 1 (tldr) |
| `summary` | the line under the headline | 3 (full) |
| `verdict` | a question's `**ask** verdict` line | 2 (exec) |
| `reason` | a question's one-line bold reason bullet | 2 (exec) |
| `evidence` | a question's `details`, nested under the reason | 3 (full) |
| `decision` | the `**choice** pick` line | 1 (tldr) |
| `option` | `- [Recommended] **Name**: consequence` | 2 (exec) |
| `caveat` | `⚠ caveat` | 2 (exec) |
| `section` | a `details` outline heading | 3 (full) |
| `bullet` | a `details` top-level bullet or paragraph | 3 (full) |
| `subbullet` | a nested `details` bullet | 3 (full) |
| `statusSection` | a `status` outline heading | 2 (exec) |
| `statusBullet` | a `status` top-level bullet or paragraph | 2 (exec) |
| `statusSub` | a nested `status` bullet | 3 (full) |
| `next` | `→ next` | 1 (tldr) |
| `link` | each link | 1 (tldr) |
| `linksHeading` | the bold heading above the links | 2 (exec) |

A block shows when any of its units shows. A child never shows before its parent: when a parent's level is higher than its child's, the child takes the parent's (headline, then summary; verdict, then reason, then evidence; decision, then option; section, then bullet, then subbullet; status section, then status bullet, then status sub-bullet).

Every view has the same fixed block order: headline and summary, status sections, questions, decisions, caveats, details sections, next step, links. Links are always last.

Section icons. The first line of each block opens with an icon, so the eye can find a section: `●` the answer (before the bold headline; the summary under it has none), `◆` each question, `◇` each decision, `⚠` the caveats, `▸` each status section, `≡` each details section, `→` the next step, `↗` the Links heading (exec and full; tldr has no heading). They are in the one exported `ICONS` table, which also holds an emoji set (🎯 💬 🔀 ⚠️ 📍 📋 ➡️ 🔗); `ICON_SET` picks which one is used, `glyph` by default. A `#` heading in the status or details is drawn as a bold line behind its icon; a details block that starts with a bullet takes the icon after the list marker, and one that starts with a table or code block gets none. The icons are part of the markdown, so the terminal and Desktop draw the same.

Spacing and emphasis:

- **One blank line between blocks,** none inside one: each question, each decision, the caveats, each details section, the next step and the links are separate blocks, and lists are tight.
- **Bold before the colon.** Every bullet of the form `Label: text` (label up to 6 words, no backticks or URLs) has a bold label; the mod adds the bold when the model did not. A colon in a time such as `10:00`, or one not followed by a space, does not count.
- **No generic labels.** A reason is never drawn as `**Why**:` or `**Details**:`. The `why` is a one-line headline that states the reason itself, and the `details` are the rest of that bullet. The `why` shows from exec on, its `details` in full only. A question with `details` but no `why` draws the details in full as the question's own bullets. A `why` written before 0.1.8 with several sentences draws its first sentence as the headline and the rest as full-only detail, ahead of the old `details`.
- **Options.** `- [Recommended] **Name**: consequence` for the recommended option, always first, then the others in their given order as `- **Name**: consequence`.
- **Option colors (terminal only).** `[Recommended]` and the name of the recommended option are green, `option` names blue, `not_recommended` names red. Desktop and mobile show markdown, which has no colors, so they show `[Recommended]` only. Each decision has exactly one `recommended` option.
- **Links show just their label,** as a clickable link: an OSC 8 hyperlink in the terminal (no path, no `file:///` text), `[label](url)` in markdown. They are always the last block.
- **A blank line above every reply** in the terminal, between your prompt and the answer.
- **No decision label, bar or blockquote:** a decision is a bold choice and the pick, followed by its options.

`status` and `details` are written as outlines: bold section headings (`**Rollout**`), top-level bullets as `**Label**: one line`, and deeper material as nested bullets. `status` is where things stand and what is waiting on you (in a progress update: active work and items waiting on you); it is drawn right after the headline, its headings and top-level bullets from `exec`, its nested bullets in `full`. `details` is background, how-to, history and evidence (in a progress update: shipped history and parked work); it is drawn in `full` only, including a code block nested under a bullet. Add a decision only when you must choose; never restate the headline as one.

Replies written before 0.1.9 have an `answer` and no `headline`: the `answer` is drawn as the headline, as it always was (the schema and the contract no longer offer `answer`, and the validator turns a new call that only has one away). Replies written before 0.1.6 (with `picked` booleans) still draw: `picked: true` reads as `recommended`, the rest as `option`.

There is no footer under a reply.

While reply-tool is on, a small indicator under the prompt shows the view, for example `exec` (the terminal draws it in the notice area just above `bypass permissions on`, as `⚠ reply-tool: exec`; Claude Code adds the prefix and glyph, and `$.ui.status` takes only text). It is set with `$.ui.status`, the mod's own pinned status line, so it never touches the `statusLine` setting. It changes the moment `/reply` does and is gone while the mod is off. `/reply` still shows a toast when the setting changes.

A `respond` call the validator rejects draws nothing in the terminal: no row and no `respond rejected` line, live or when the transcript is redrawn or resumed. The model still reads the rejection text, and `/reply_stats` still counts it. Only the accepted call is drawn. Press `ctrl+o` on a reply to see the raw `respond` call, rejected ones included.

### Example

The same reply, as Claude sends it:

```json
{
  "headline": "Checkout fixed; ship Friday",
  "summary": "The retry covers the timeout path, so Safari no longer fails. Only the release date is left to decide.",
  "questions": [
    {
      "ask": "Does checkout still fail on Safari?",
      "verdict": "No, the failure rate fell from 4% to 0.1%.",
      "why": "The retry now covers the timeout path.",
      "details": "- Fix: retry wrapper in `checkout/pay.ts`\n- MR !441"
    },
    {
      "ask": "Can we ship Friday?",
      "verdict": "Yes, if QA signs off by Thursday."
    }
  ],
  "decisions": [
    {
      "choice": "Ship Friday or wait a week?",
      "pick": "Ship Friday",
      "options": [
        {
          "name": "Wait a week",
          "consequence": "One more regression pass.",
          "stance": "option"
        },
        {
          "name": "Ship Friday",
          "consequence": "Customers get the fix 5 days sooner.",
          "stance": "recommended"
        },
        {
          "name": "Skip QA",
          "consequence": "Ships today with no regression check.",
          "stance": "not_recommended"
        }
      ]
    }
  ],
  "caveats": [
    "Safari 16 was not tested."
  ],
  "status": "**Waiting on you**\n- **QA sign-off**: needed by Thursday\n  - Regression suite is green",
  "details": "**Rollout**\n- **Canary**: 5% on Thursday\n  - Watch the error dashboard for 2 hours\n- **Full**: Friday 10:00\n\n**Risks**\n- **Old sessions**: carts opened before the deploy keep the old code\n  - They expire within 24 hours",
  "next": "Want me to draft the QA sign-off request?",
  "links": [
    {
      "label": "Test report",
      "path": "/home/me/reports/checkout.html"
    }
  ]
}
```

Drawn at `tldr`:

```
● **Checkout fixed; ship Friday**

◇ **Ship Friday or wait a week?** Ship Friday

→ Want me to draft the QA sign-off request?

- [Test report](file:///home/me/reports/checkout.html)
```

Drawn at `exec`:

```
● **Checkout fixed; ship Friday**

▸ **Waiting on you**
- **QA sign-off**: needed by Thursday

◆ **Does checkout still fail on Safari?** No, the failure rate fell from 4% to 0.1%.
- **The retry now covers the timeout path**

◆ **Can we ship Friday?** Yes, if QA signs off by Thursday.

◇ **Ship Friday or wait a week?** Ship Friday
- [Recommended] **Ship Friday**: Customers get the fix 5 days sooner.
- **Wait a week**: One more regression pass.
- **Skip QA**: Ships today with no regression check.

⚠ Safari 16 was not tested.

→ Want me to draft the QA sign-off request?

↗ **Links**
- [Test report](file:///home/me/reports/checkout.html)
```

Drawn at `full`: `exec` plus the summary, the evidence under each reason, the nested status bullets and the details sections:

```
● **Checkout fixed; ship Friday**  
The retry covers the timeout path, so Safari no longer fails. Only the release date is left to decide.

▸ **Waiting on you**
- **QA sign-off**: needed by Thursday
  - Regression suite is green

◆ **Does checkout still fail on Safari?** No, the failure rate fell from 4% to 0.1%.
- **The retry now covers the timeout path**
  - **Fix**: retry wrapper in `checkout/pay.ts`
  - MR !441

◆ **Can we ship Friday?** Yes, if QA signs off by Thursday.

◇ **Ship Friday or wait a week?** Ship Friday
- [Recommended] **Ship Friday**: Customers get the fix 5 days sooner.
- **Wait a week**: One more regression pass.
- **Skip QA**: Ships today with no regression check.

⚠ Safari 16 was not tested.

≡ **Rollout**
- **Canary**: 5% on Thursday
  - Watch the error dashboard for 2 hours
- **Full**: Friday 10:00

≡ **Risks**
- **Old sessions**: carts opened before the deploy keep the old code
  - They expire within 24 hours

→ Want me to draft the QA sign-off request?

↗ **Links**
- [Test report](file:///home/me/reports/checkout.html)
```

The text above is the markdown source (what Desktop and mobile show); the terminal draws the same lines itself, with the options colored by stance and a label-only hyperlink. The closing text that Desktop and mobile show is this same markdown (valid GitHub markdown).

## Screenshots

TODO: add screenshots of `/reply tldr`, `/reply exec` and `/reply full` on the same reply.

## The reply schema

The `respond` tool takes one JSON object. Only `headline` is required.

| Field | Type | Meaning |
| --- | --- | --- |
| `headline` | string | The shortest possible answer: at most 8 words, no colon, one sentence (`JSON`, or `JSON for config, spaces for code`). For a yes/no question: Yes, No or Partly plus at most a few words. Drawn bold in every view. |
| `summary` | string | Optional: 1 to 2 sentences of context for the headline. Drawn as plain text directly under it in `full` only. |
| `questions` | array | One entry per question you asked, in your order, at most 5. Omitted when you asked one question. |
| `questions[].ask` | string | Your question in your words, at most 12 words. Required. |
| `questions[].verdict` | string | One sentence: the verdict first, then the number or effect. No ids, paths, URLs or code. Required. |
| `questions[].why` | string | Optional: ONE line that states the reason itself, written as a headline (about 14 words at most, one sentence, no colon; never a label such as "Why"). Drawn bold as the question's bullet in `exec` and `full`. |
| `questions[].details` | string | Optional, `full` only: the rest of the `why` bullet. Leading prose follows the headline as `: prose`; any list nests under the bullet. Without a `why`, drawn as the question's own bullets. |
| `decisions` | array | Only when you must choose. One entry per choice. |
| `decisions[].choice` | string | The decision, phrased as a question. Required. |
| `decisions[].pick` | string | The recommended option in at most 8 words, with no reason (`Ship Friday`). The reason lives in the options' consequences. Required. |
| `decisions[].options` | array | At least 2 entries of `name`, `consequence` (one line) and `stance` (`recommended`, `option` or `not_recommended`); exactly one is `recommended`. Required. |
| `caveats` | array of strings | At most 2, one clause each, only when one changes a decision. |
| `next` | string | A question or offer that reads on its own. |
| `links` | array | Deliverables you open: `label` and `path` (an absolute path or an http(s) URL). Always drawn as the label alone, as a clickable link to the path or URL. |
| `status` | string | Optional outline of where things stand and what is waiting on you (a progress update: active work, items waiting on you). Same format as `details`. Drawn right after the headline: headings and top-level bullets in `exec` and `full`, nested bullets in `full` only. |
| `details` | string | Optional outline for background, how-to, history and evidence (shipped history, parked work): bold section headings, top-level bullets as `**Label**: one line`, deeper material as nested bullets. Drawn in `full` only. |

The tool checks, and rejects with the exact issues:

- a missing or empty `headline`; a `headline` of more than 8 words, with a colon, or with more than 1 sentence (the message says: shortest possible answer, at most 8 words; move context into summary)
- more than 2 sentences in `summary`, more than 1 in a `verdict` or `why`
- a `why` that is a generic label ("Why", "Because", "Reason", "Details", or one ending in a colon) or contains a colon
- exactly 1 question (it belongs in `headline`), or more than 5
- a decision `pick` of more than 8 words (the message says: name the recommended option in at most 8 words, no reason; the reason lives in the options' consequences)
- more than 2 caveats
- a decision with fewer than 2 options, an option with no valid `stance`, or not exactly one `recommended`
- a field of the wrong type
- in the fields you read first (`headline`, `summary`, `verdict`, `pick`, option `name` and `consequence`, `caveats`, `next`): a bare id (`!123`, `ABC-123`, `ADR-12`), a URL, inline code, or a file path. These belong in `details` or `links`.

## How it works

- **The `respond` tool.** The mod registers it at session start. While reply-tool is off it is deferred and described as inactive (and a call that still comes is turned away). While it is on, the tool is active, and its description holds the reply rules, a worked example, and the delivery rule: end every turn by calling `respond`, and write nothing else after it returns `delivered`. The contract also rides in the tool description, so it reaches the model even where plugins' `prompt.compose` hooks are skipped; where they run, the mod adds the same contract as a system-prompt section.
- **Validation.** Each call is checked by the rules above. A reply with issues is rejected with a message that lists every issue word for word, and Claude calls `respond` again with the complete reply. Each turn allows 2 rejections; after that the next call is accepted as it is, so a reply is never lost to a strict rule (it counts as a reply with issues in `/reply_stats`).
- **Rendering.** The mod draws the `respond` tool row as the formatted reply, as one outline cut at the current view's depth (a list of blocks of lines, each tagged with the depth that shows it), joined into one markdown string; the terminal draws the same blocks with colored options. The row reads the setting while it draws, so `/reply` redraws past replies at once. The result row (`delivered`) is hidden, and so is a rejected call's row: it ends as an errored tool result in the transcript, which is what the row hook reads, so it stays hidden on redraw and resume.
- **The closing step.** After `delivered` the turn is over, but the model's next request would come back with no text and the loop would nudge it to write the reply again. The mod answers that one step itself, sending no further request. Its text is the reply rendered as markdown at the current view, behind an invisible zero-width marker.
- **Outside the terminal.** The Desktop app and the mobile app draw the transcript with their own interface and fold the `respond` call into the collapsed activity group ("Ran 4 commands, used reply-tool"), so the tool row never appears there. The closing step's text is ordinary assistant text, so those apps show the reply under the group. The terminal hides that marked message, because the tool row already draws the reply, so it looks as it always did, with no duplicate. The mod API has no way to show assistant text without putting it in the conversation, so the text is kept.
- **Subagents are unaffected.** `respond` is for the main conversation only, so a subagent that calls it is told to report in plain text, and its report reaches the agent that spawned it as written.

The setting lives in the session's state and is never saved, so every session starts with reply-tool off. Only the counters behind `/reply_stats` are stored.

## Limitations

- **Not schema-constrained.** Tools registered by mods cannot use strict mode, so the API does not guarantee the shape of the input. The mod reads each call defensively and the validator reports every type problem, but a malformed call costs a rejection.
- **The model is instructed, not forced.** Forced tool choice is not available on current models, so Claude follows the contract in the tool description (and the system-prompt section where it runs) rather than being made to call `respond`. A turn that ends in plain text is shown as written and counted as not structured in `/reply_stats`.
- **One extra quick round-trip per reply.** The reply is a tool call, so each reply costs the call and its result, and each rejection costs another.
- **The reply appears when complete.** A tool call's input is known only once it is whole, so the reply is drawn at the end, not streamed as it is written.
- **Context cost of the closing text.** The closing text is real assistant text, so each reply is repeated once more in the context of later turns (the `respond` call already carries it). The mod API offers no display-only assistant text, so this is accepted. `tldr` repeats the least, `full` the most.
- **Switching views outside the terminal.** `/reply tldr|exec|full` redraws past replies only in the terminal. Desktop and mobile show each closing text as it was written, at the view in force when that turn ended.
- **Heuristic rules.** Sentence counting and the id, URL, code and path checks are pattern matches. They can flag a reply that is fine, and they check form, not accuracy.
- **Early-access API.** Mods use Claude Code's plugin API, which is early access and can change between releases. This copy was built and tested on Claude Code 2.1.310.

## Development

Run these from the repository root:

```
claude plugin validate .
claude plugin validate claude_mods/plugins/reply-tool
claude plugin test claude_mods/plugins/reply-tool
claude --plugin-dir claude_mods/plugins/reply-tool
```

The first command validates the marketplace and the others work on the plugin folder.

Layout of this plugin folder (`claude_mods/plugins/reply-tool/`):

- `.claude-plugin/plugin.json`: the plugin manifest. The marketplace that lists this plugin is `.claude-plugin/marketplace.json` at the repository root.
- `hooks/reply.ts`: the schema, validator, renderer, the `LEVELS` and `ICONS` tables, and the contract text, all pure functions.
- `hooks/register.tsx`: the commands, the tool, and the hooks.
- `types/index.d.ts`: the plugin's state type.
- `tests/reply-tool.test.ts`: tests for the validator, the renderer, the rejection loop, and the commands.

The engine writes `.claude-plugin/types/` (and a `tsconfig.json` that extends it) beside a mod it loads from a folder; both are git-ignored.

## License

MIT, see the repository's [LICENSE](../../../LICENSE).
