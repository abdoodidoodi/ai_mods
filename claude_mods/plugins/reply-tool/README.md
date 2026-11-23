# reply-tool

A Claude Code mod that makes Claude deliver every reply through a `respond` tool whose input is a structured reply: a bottom line, one verdict per question you asked, the decisions you need to make with Claude's pick, caveats, a next step, links, and details. The tool checks each reply against a few rules and sends back the exact issues when it breaks one, and the mod draws the tool row as the formatted reply, at the level of detail you choose.

## Why

Long replies bury the answer. With reply-tool the answer comes first, and you decide how much of the rest you read:

- `tldr`: the bottom line, Claude's pick for each decision, and the links.
- `exec`: the bottom line, one numbered verdict per question you asked, the decisions with their options, caveats, and the next step.
- `full`: everything, including the support for each verdict and all the details.

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

What each view shows:

- `tldr`: the answer (or each question's verdict as a bullet when the answer is empty), `★ **<choice>**` plus Claude's pick for each decision (just `★` plus the pick when the choice is empty), and the links.
- `exec`: the answer, a numbered line per question (your question in bold, then the verdict), each decision (the choice in bold, with Claude's pick) and its options as a list with the picked one starred, `⚠` caveats, the next step on a line of its own starting with `→`, and the links.
- `full`: `exec` plus each question's `why` and `details` (indented under its number), and the reply's `details` after the links.

In every view the bottom line is bold and a blank line separates each block (answer, questions, decisions, caveats, next step, links), so nothing runs into the next. There is no footer under a reply.

While reply-tool is on, a small indicator under the prompt shows the view, for example `reply: exec` (the terminal draws it in the notice area just above `bypass permissions on`, as `⚠ reply-tool: reply: exec`). It is set with `$.ui.status`, the mod's own pinned status line, so it never touches the `statusLine` setting. It changes the moment `/reply` does and is gone while the mod is off. `/reply` still shows a toast when the setting changes.

A `respond` call the validator rejects draws nothing in the terminal: no row and no `respond rejected` line, live or when the transcript is redrawn or resumed. The model still reads the rejection text, and `/reply_stats` still counts it. Only the accepted call is drawn. Press `ctrl+o` on a reply to see the raw `respond` call, rejected ones included.

### Example

The same reply, as Claude sends it:

```json
{
  "answer": "Partly: checkout is fixed, shipping waits on QA.",
  "questions": [
    {
      "ask": "Does checkout still fail?",
      "verdict": "No, failures fell from 4% to 0.1%.",
      "why": "The retry covers timeouts.",
      "details": "Fix is in MR !441."
    },
    { "ask": "Can we ship Friday?", "verdict": "Yes, if QA signs off Thursday." }
  ],
  "decisions": [
    {
      "choice": "Ship Friday?",
      "pick": "Ship, the risk is low.",
      "options": [
        { "name": "Ship", "consequence": "5 days sooner.", "picked": true },
        { "name": "Wait", "consequence": "One more regression pass.", "picked": false }
      ]
    }
  ],
  "caveats": ["Safari 16 is untested."],
  "next": "Want me to draft the QA request?",
  "links": [{ "label": "Report", "path": "/tmp/r.html" }]
}
```

Drawn at `tldr`:

```
**Partly: checkout is fixed, shipping waits on QA.**

★ **Ship Friday?** Ship, the risk is low.

* Report: /tmp/r.html · file:///tmp/r.html
```

Drawn at `exec`:

```
**Partly: checkout is fixed, shipping waits on QA.**

1. **Does checkout still fail?** No, failures fell from 4% to 0.1%.

2. **Can we ship Friday?** Yes, if QA signs off Thursday.

**Ship Friday?** ★ Ship, the risk is low.

- ★ Ship: 5 days sooner.
- Wait: One more regression pass.

⚠ Safari 16 is untested.

→ Want me to draft the QA request?

* Report: /tmp/r.html · file:///tmp/r.html
```

The text above is the markdown source; the terminal draws it with bold, lists, and links. At `full`, the first verdict also gains "The retry covers timeouts." and "Fix is in MR !441.", each indented under its number, and the reply's `details` come last. The closing text that Desktop and mobile show is this same markdown (valid GitHub markdown).

## Screenshots

TODO: add screenshots of `/reply tldr`, `/reply exec` and `/reply full` on the same reply.

## The reply schema

The `respond` tool takes one JSON object. Only `answer` is required.

| Field | Type | Meaning |
| --- | --- | --- |
| `answer` | string | The bottom line: plain prose, at most 2 sentences. Starts with Yes, No or Partly for a yes/no question. With 2 or more questions it is one sentence that repeats no verdict (and may be empty). |
| `questions` | array | One entry per question you asked, in your order, at most 5. Omitted when you asked one question. |
| `questions[].ask` | string | Your question in your words, at most 12 words. Required. |
| `questions[].verdict` | string | One sentence: the verdict first, then the number or effect. No ids, paths, URLs or code. Required. |
| `questions[].why` | string | Optional: at most 2 sentences of support. Drawn in `full`. |
| `questions[].details` | string | Optional markdown: evidence, mechanics, ticket ids, file paths. Drawn in `full`. |
| `decisions` | array | Only when you must choose. One entry per choice. |
| `decisions[].choice` | string | The decision, phrased as a question. Required. |
| `decisions[].pick` | string | One line: what Claude recommends and why. Required. |
| `decisions[].options` | array | At least 2 entries of `name`, `consequence` (one line) and `picked` (boolean); at least one is picked. Required. |
| `caveats` | array of strings | At most 2, one clause each, only when one changes a decision. |
| `next` | string | A question or offer that reads on its own. |
| `links` | array | Deliverables you open: `label` and `path` (an absolute path or an http(s) URL). Always drawn; an absolute path also gets a `file://` URL. |
| `details` | string | Optional markdown for everything else. Drawn in `full`. |

The tool checks, and rejects with the exact issues:

- a missing `answer`, or an empty one with no questions
- more than 2 sentences in `answer` or `why`, more than 1 in a `verdict`
- exactly 1 question (it belongs in `answer`), or more than 5
- more than 2 caveats
- a decision with fewer than 2 options, or none picked
- a field of the wrong type
- in the fields you read first (`answer`, `verdict`, `pick`, option `name` and `consequence`, `caveats`, `next`): a bare id (`!123`, `ABC-123`, `ADR-12`), a URL, inline code, or a file path. These belong in `details` or `links`.

## How it works

- **The `respond` tool.** The mod registers it at session start. While reply-tool is off it is deferred and described as inactive (and a call that still comes is turned away). While it is on, the tool is active, and its description holds the reply rules, a worked example, and the delivery rule: end every turn by calling `respond`, and write nothing else after it returns `delivered`. The contract also rides in the tool description, so it reaches the model even where plugins' `prompt.compose` hooks are skipped; where they run, the mod adds the same contract as a system-prompt section.
- **Validation.** Each call is checked by the rules above. A reply with issues is rejected with a message that lists every issue word for word, and Claude calls `respond` again with the complete reply. Each turn allows 2 rejections; after that the next call is accepted as it is, so a reply is never lost to a strict rule (it counts as a reply with issues in `/reply_stats`).
- **Rendering.** The mod draws the `respond` tool row as the formatted reply, as one markdown string for the current view. The row reads the setting while it draws, so `/reply` redraws past replies at once. The result row (`delivered`) is hidden, and so is a rejected call's row: it ends as an errored tool result in the transcript, which is what the row hook reads, so it stays hidden on redraw and resume.
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
- `hooks/reply.ts`: the schema, validator, renderer, and the contract text, all pure functions.
- `hooks/register.tsx`: the commands, the tool, and the hooks.
- `types/index.d.ts`: the plugin's state type.
- `tests/reply-tool.test.ts`: tests for the validator, the renderer, the rejection loop, and the commands.

The engine writes `.claude-plugin/types/` (and a `tsconfig.json` that extends it) beside a mod it loads from a folder; both are git-ignored.

## License

MIT, see the repository's [LICENSE](../../../LICENSE).
