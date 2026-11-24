# reply-tool

A Claude Code mod that makes Claude deliver every reply through a `respond` tool whose input is a structured reply: a headline (a bold summary of the whole reply), a body (one markdown outline, the only place for explanation, progress and evidence), at most one decision (2 to 4 whole plans, one of them recommended), caveats, and links. The tool checks each reply against a ladder of length rules and sends back the exact issues when it breaks one, and the mod draws the tool row as the formatted reply, at the level of detail you choose.

## Why

Long replies bury the answer. With reply-tool the answer comes first, and you decide how much of the rest you read:

Three views, for three readers:

- `tldr` is for someone who wants fully autonomous execution without knowing how or why: only the shortest status. The bold headline (at most 3 sentences and 60 words), the decision (the choice in bold, then Claude's pick: the head of the recommended option), and the links. No body, no options.
- `exec` is for someone who also wants a say in the decision, with only the few words that build it in their head. tldr plus the body's section headings and L1 heads (the head only, no tail), every option's head (the recommended one first, in its stance color), the caveat texts, and a `Links` heading.
- `full` is for working on one specific problem fully by hand, with every control and every detail. exec plus the L1 tails (on the same bullet as their head), every L2 and L3 bullet (and the tables, code and prose under them), the option bodies, and the caveat details.

Claude always sends the full reply. The view only changes how it is drawn, so switching views redraws the replies already in the transcript, with nothing lost and nothing to ask again.

### The length ladder

The fields never overlap: each fact has one place, and exec is always a deterministic cut of full. The length allowed at each level tells Claude where a short claim goes and where it can dump detail:

- The headline is the summary of the whole reply, and nothing else repeats it.
- A body bullet at L1 or L2 is `head: tail`. Its head is a sentence of 8 to 15 words, so exec reads as a list of claims. An L1 tail is one sentence, an L2 tail up to two.
- L3 is the dumping ground: freeform markdown (tables, code, lists) for evidence and detail, with no head and no limits. Ids, paths, URLs and inline code go there.
- Ids, paths, URLs and inline code are turned away wherever exec shows them: the headline, section headings, L1 heads and tails, the decision and the caveat text.

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

Every view has the same fixed block order: headline, body sections, the decision, caveats, links. Links are always last.

Every drawn line is one unit of a type, and one exported table, `LEVELS` in `hooks/reply.ts`, says which view first shows each type (1 = tldr, 2 = exec, 3 = full). Moving a type between views is a one-line edit there.

| Unit | What it is | Level |
| --- | --- | --- |
| `headline` | the bold summary of the whole reply | 1 (tldr) |
| `bodySection` | a body section heading | 2 (exec) |
| `bodyHead` | an L1 bullet: its head, in bold | 2 (exec) |
| `bodyTail` | an L1 bullet's tail, on the same bullet as its head | 3 (full) |
| `bodyL2` | an L2 bullet (`head: tail`), or a table or code block nested at L2 | 3 (full) |
| `bodyL3` | L3: freeform markdown under an L2 bullet | 3 (full) |
| `bodyDiagram` | a diagram section's fenced block | 2 (exec) |
| `decision` | the `**choice** <recommended option head>` line | 1 (tldr) |
| `option` | `- [Recommended] **Head**` | 2 (exec) |
| `optionBody` | the option's `: body`, on the same line as its head | 3 (full) |
| `caveat` | `⚠ text` | 2 (exec) |
| `caveatDetails` | a caveat's details, nested under it | 3 (full) |
| `link` | each link | 1 (tldr) |
| `linksHeading` | the bold heading above the links | 2 (exec) |

Units for replies from before 0.1.14 (`summary`, `verdict`, `reason`, `evidence`, `section`, `bullet`, `subbullet`, `statusSection`, `statusBullet`, `statusSub`, `next`) are in the same table, marked LEGACY.

A block shows when any of its units shows. A child never shows before its parent: when a parent's level is higher than its child's, the child takes the parent's (body section, then L1 head, then L2, then L3; decision, then option; caveat, then its details). An L1 head and an option grow on the same line when the view reaches their tail or body, so a head is never a separate line from its tail.

Section icons. The first line of each block opens with an icon, so the eye can find a section: `●` the headline, `≡` each body section, `◇` the decision, `⚠` each caveat, `↗` the Links heading (exec and full; tldr has no heading). They are in the one exported `ICONS` table, which also holds an emoji set (🎯 📋 🔀 ⚠️ 🔗); `ICON_SET` picks which one is used, `glyph` by default. A `#` heading in the body is drawn as a bold line behind its icon, and a body that starts with bullets (an unnamed section) takes the icon after the first list marker. The icons are part of the markdown, so the terminal and Desktop draw the same.

Spacing and emphasis:

- **One blank line between blocks,** none inside one: each body section, the decision, each caveat and the links are separate blocks, and lists are tight.
- **Heads are bold.** An L1 or L2 bullet is drawn as `**head**: tail`, with the head in bold whether or not Claude bolded it. An L3 bullet is drawn as it was written.
- **Indented under a head.** Markdown cannot nest a list under a paragraph, so a head with lines under it (a body section, the decision, a caveat with details, the Links heading) is drawn as a list item and the lines under it nest two spaces in, in the markdown that Desktop, VS Code and mobile show and in the closing text. The terminal indents them with a box instead. L2 and L3 nest deeper by their own indentation, and a table or a code fence under a bullet keeps that indentation, so it stays inside the list item.
- **Options.** Under the decision, `- [Recommended] **Head**` for the recommended option, always first, then the others in their given order as `- **Head**`. In `full` each takes its body: `- **Head**: body`.
- **Option colors (terminal only).** `[Recommended]` and the head of the recommended option are green, `option` heads blue, `not_recommended` heads red. Desktop and mobile show markdown, which has no colors, so they show `[Recommended]` only. The decision has exactly one `recommended` option.
- **Links show just their label,** as a clickable link in blue: an OSC 8 hyperlink in the terminal (no path, no `file:///` text), `[label](url)` in markdown. They are always the last block.
- **A blank line above every reply** in the terminal, between your prompt and the answer.
- **No decision label, bar or blockquote:** the decision is a bold choice and the head of the recommended option, followed by its options.

### The body

The body is one markdown outline: the only place for explanation, progress and evidence.

- **Sections.** A section is a heading (a `#` heading or a line that is only bold, at most 10 words) followed by bullets. Bullets before the first heading are an unnamed section. The number of sections and of bullets in one is not limited.
- **Depth.** Bullets nest at most 3 levels under a heading: L1, L2 (indented 2 spaces) and L3 (indented 4). A 4th bullet level is turned away.
- **Bullets.** Every L1 and L2 bullet is `head: tail`: the head is the text before the first colon that is followed by a space or the line end (so `10:00` and `https://...` do not split), and it must be a sentence of 8 to 15 words (words are whitespace-separated, `**` markers ignored). With no such colon the whole bullet is the head and the tail is empty. An L1 tail is at most 1 sentence, an L2 tail at most 2.
- **L3.** Anything indented under an L2 bullet is L3: bullets, prose, block quotes, tables, fenced code. None of it is checked, so ids, paths, URLs and code go there. It is drawn intact in `full`, nested under its L2 bullet.
- **Only headings and bullets.** A plain paragraph line outside L3 is turned away. A table or a fenced code block belongs under a bullet (L2 or deeper), never at the top of a section.
- **A diagram section.** Only when you ask for a diagram: a heading followed by exactly one fenced code block (an ASCII or mermaid diagram) and nothing else. It is exempt from the bullet rules, and drawn intact in `exec` and `full`, not in `tldr`. Mixing bullets with a top-level fence in one section is turned away.
- **No repeating the headline.** A section heading or an L1 head is turned away when at least 70% of its content words (lowercased, punctuation stripped, a small stopword list removed, at least 3 of them) are in the headline.

Add a decision only when you must choose. There is at most one: sub-choices are folded into its options, so each option is a whole plan.

Replies written before 0.1.14 have `summary`, `status`, `details` and `next` (the old outline fields and the next step), none of which the schema offers any more. They still redraw where they used to: the summary under the headline in full, the status after the headline, the details and the next step after the caveats. Replies written before 0.1.13 have `questions` (an `ask`, a `verdict` and optionally a `why` and `details` each) and `decisions[]` (each with its own `pick`): a question is a `◆` line with its one-line reason from exec and its evidence in full, a decision shows its `pick`. A decision from 0.1.13 has options with `name` and `consequence`, drawn as head and body. Replies written before 0.1.9 have an `answer` and no `headline`: the `answer` is drawn as the headline. Replies written before 0.1.6 (with `picked` booleans) still draw: `picked: true` reads as `recommended`, the rest as `option`. The validator turns a new call that sends any of these fields away and says where the content goes now.

There is no footer under a reply.

While reply-tool is on, a small indicator under the prompt shows the view, for example `exec` (the terminal draws it in the notice area just above `bypass permissions on`, as `⚠ reply-tool: exec`; Claude Code adds the prefix and glyph, and `$.ui.status` takes only text). It is set with `$.ui.status`, the mod's own pinned status line, so it never touches the `statusLine` setting. It changes the moment `/reply` does and is gone while the mod is off. `/reply` still shows a toast when the setting changes.

A `respond` call the validator rejects draws nothing in the terminal: no row and no `respond rejected` line, live or when the transcript is redrawn or resumed. The model still reads the rejection text, and `/reply_stats` still counts it. Only the accepted call is drawn. Press `ctrl+o` on a reply to see the raw `respond` call, rejected ones included.

### Example

The same reply, as Claude sends it:

```json
{
  "headline": "Safari checkout is fixed and ready to release. The retry now covers the timeout path, which cut failures from 4% to 0.1%.",
  "body": "**Why it broke**\n- Safari dropped the session whenever the payment call timed out: no other browser was affected.\n  - The retry wrapper now covers that path with two attempts and a short backoff: the second attempt reuses the original session.\n    - Fix: retry wrapper in `checkout/pay.ts`, MR !441. Failure rate before 4%, after 0.1%. Measured on the staging mirror. Sampled hourly for 24 hours.\n\n**Rollout plan**\n- Canary goes to five percent of traffic on Thursday morning: it is watched for two hours.\n  - Full rollout starts on Friday at 10:00 if the canary stays clean: QA signs off before that.\n    | Stage | Traffic | When |\n    | --- | --- | --- |\n    | Canary | 5% | Thursday |\n    | Full | 100% | Friday 10:00 |",
  "decision": {
    "choice": "How should we release the fix?",
    "options": [
      {
        "head": "Canary on Thursday, then everyone on Friday after a two hour watch",
        "body": "Customers get the fix 5 days sooner, after a canary that is watched first.",
        "stance": "recommended"
      },
      {
        "head": "Wait a week and run the full regression pass first",
        "body": "Adds one more regression pass. Customers wait the extra week.",
        "stance": "option"
      },
      {
        "head": "Ship today to everyone and skip the QA sign-off entirely",
        "body": "Fastest, but nobody checks the timeout path for regressions.",
        "stance": "not_recommended"
      }
    ]
  },
  "caveats": [
    {
      "text": "Safari 16 was not tested.",
      "details": "Only Safari 17 and 18 were in the lab, so the timeout path is untested on the older engine."
    }
  ],
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
● **Safari checkout is fixed and ready to release. The retry now covers the timeout path, which cut failures from 4% to 0.1%.**

◇ **How should we release the fix?** Canary on Thursday, then everyone on Friday after a two hour watch

- [Test report](file:///home/me/reports/checkout.html)
```

Drawn at `exec`: `tldr` plus the section headings and L1 heads, every option head, the caveat text and the Links heading:

```
● **Safari checkout is fixed and ready to release. The retry now covers the timeout path, which cut failures from 4% to 0.1%.**

- ≡ **Why it broke**
  - **Safari dropped the session whenever the payment call timed out**

- ≡ **Rollout plan**
  - **Canary goes to five percent of traffic on Thursday morning**

- ◇ **How should we release the fix?** Canary on Thursday, then everyone on Friday after a two hour watch
  - [Recommended] **Canary on Thursday, then everyone on Friday after a two hour watch**
  - **Wait a week and run the full regression pass first**
  - **Ship today to everyone and skip the QA sign-off entirely**

⚠ Safari 16 was not tested.

- ↗ **Links**
  - [Test report](file:///home/me/reports/checkout.html)
```

Drawn at `full`: `exec` plus the L1 tails, L2 and L3, the option bodies and the caveat details:

```
● **Safari checkout is fixed and ready to release. The retry now covers the timeout path, which cut failures from 4% to 0.1%.**

- ≡ **Why it broke**
  - **Safari dropped the session whenever the payment call timed out**: no other browser was affected.
    - **The retry wrapper now covers that path with two attempts and a short backoff**: the second attempt reuses the original session.
      - Fix: retry wrapper in `checkout/pay.ts`, MR !441. Failure rate before 4%, after 0.1%. Measured on the staging mirror. Sampled hourly for 24 hours.

- ≡ **Rollout plan**
  - **Canary goes to five percent of traffic on Thursday morning**: it is watched for two hours.
    - **Full rollout starts on Friday at 10:00 if the canary stays clean**: QA signs off before that.
      | Stage | Traffic | When |
      | --- | --- | --- |
      | Canary | 5% | Thursday |
      | Full | 100% | Friday 10:00 |

- ◇ **How should we release the fix?** Canary on Thursday, then everyone on Friday after a two hour watch
  - [Recommended] **Canary on Thursday, then everyone on Friday after a two hour watch**: Customers get the fix 5 days sooner, after a canary that is watched first.
  - **Wait a week and run the full regression pass first**: Adds one more regression pass. Customers wait the extra week.
  - **Ship today to everyone and skip the QA sign-off entirely**: Fastest, but nobody checks the timeout path for regressions.

- ⚠ Safari 16 was not tested.
  - Only Safari 17 and 18 were in the lab, so the timeout path is untested on the older engine.

- ↗ **Links**
  - [Test report](file:///home/me/reports/checkout.html)
```

The text above is the markdown source (what Desktop and mobile show): a head with lines under it is a list item and those lines nest two spaces in. The terminal draws the same lines itself, indenting them with a box, with the options colored by stance and a label-only hyperlink. The closing text that Desktop and mobile show is this same markdown (valid GitHub markdown).

A diagram section, when the user asks for one, is a heading and one fenced block, drawn at `exec` and `full`:

````
● **The retry sits between the cart and the payment call.**

- ≡ **Architecture**
  ```
  cart --> retry wrapper --> payment API
  ```
````

## Screenshots

TODO: add screenshots of `/reply tldr`, `/reply exec` and `/reply full` on the same reply.

## The reply schema

The `respond` tool takes one JSON object, with no other fields. Only `headline` is required.

| Field | Type | Meaning |
| --- | --- | --- |
| `headline` | string | A bold summary of the whole reply: at most 3 sentences and 60 words, with no ids, paths, URLs or code. Drawn bold in every view. Nothing else in the reply repeats it. |
| `body` | string | The only place for explanation, progress and evidence: a markdown outline of sections (a heading of at most 10 words, then bullets), 3 bullet levels deep. L1 and L2 bullets are `head: tail` with an 8 to 15 word head that reads as a sentence; an L1 tail is at most 1 sentence, an L2 tail at most 2; L3 is freeform markdown with no limits. See The body above. |
| `decision` | object | Optional, only when you must choose: the one call to make now. There is at most one; every sub-choice is folded into its options. |
| `decision.choice` | string | The one call you must make now, as a question of at most 15 words. Required, not blank. |
| `decision.options` | array | 2 to 4 whole plans that each bundle every sub-choice, never one decision per item. Each has a `head` (the plan as a sentence of 8 to 15 words), a `body` (what the plan means and costs, up to 3 sentences) and a `stance` (`recommended`, `option` or `not_recommended`). Exactly one is `recommended`; its head is the pick that `tldr` shows. Required. |
| `caveats` | array | At most 3, only when one changes the decision. Each is `{ text, details? }`: `text` is at most 2 sentences and 40 words; `details` is free. A plain string is read as `{ text }`. |
| `links` | array | Deliverables you open: `label` and `path` (an absolute path or an http(s) URL). Always drawn as the label alone, as a clickable link to the path or URL. |

The tool checks, and rejects with the exact issues:

- a missing or empty `headline`; a `headline` of more than 60 words or more than 3 sentences
- `summary`, `status`, `details`, `next`, `questions` or `decisions` in a new call (each is no longer a field; the message says where the content goes now: fold the summary into the headline, put status and details in the body, drop the next step or make it a decision option, answer questions in the headline and their own body sections, send one decision whose 2 to 4 options are whole plans)
- in the `body`:
  - a heading of more than 10 words
  - an L1 or L2 bullet whose head has fewer than 8 or more than 15 words, an L1 tail of more than 1 sentence, an L2 tail of more than 2
  - a 4th level of bullets (`body section "<heading>" goes 4 levels deep (max 3): condense the top levels`)
  - a plain paragraph line (`body: write "<first words>" as a bullet under a heading`)
  - a top-level table or code block, which includes bullets mixed with a top-level code block (a heading with exactly one code block is a diagram section and is fine)
  - a heading or L1 head that mostly repeats the headline (`body "<head>" repeats the headline: say something the headline doesn't`)
  - a bare id (`!123`, `ABC-123`, `ADR-12`), a URL, inline code, or a file path in a heading or in an L1 head or tail
- a `decision` with no `choice`, a blank one, or one of more than 15 words; with fewer than 2 or more than 4 options; with an option that has no valid `stance`, or without exactly one `recommended`; or with an option that still has `name` and `consequence`
- an option `head` of fewer than 8 or more than 15 words, or a `body` of more than 3 sentences
- more than 3 caveats; a caveat `text` of more than 2 sentences or 40 words
- a field of the wrong type
- in the fields drawn in exec (`headline`, `choice`, option `head` and `body`, caveat `text`, body headings and L1 bullets): a bare id, a URL, inline code, or a file path. These belong in L2 and L3 bullets or in `links`.

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
- **Heuristic rules.** Sentence counting, word counting, the repetition check and the id, URL, code and path checks are pattern matches. They can flag a reply that is fine, and they check form, not accuracy. A head is split at its first colon followed by a space, so a colon inside inline code (allowed from L2 down) splits there too.
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
- `hooks/reply.ts`: the schema, validator, body reader, renderer, the `LEVELS` and `ICONS` tables, and the contract text, all pure functions.
- `hooks/register.tsx`: the commands, the tool, and the hooks.
- `types/index.d.ts`: the plugin's state type.
- `tests/reply-tool.test.ts`: tests for the validator, the renderer, the rejection loop, and the commands.

The engine writes `.claude-plugin/types/` (and a `tsconfig.json` that extends it) beside a mod it loads from a folder; both are git-ignored.

## License

MIT, see the repository's [LICENSE](../../../LICENSE).
