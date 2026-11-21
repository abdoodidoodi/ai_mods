/** What reply-tool is set to: off, or on with replies drawn as tldr, exec or full. */
export type ReplyToolMode = 'off' | 'tldr' | 'exec' | 'full'

declare module 'claude-code' {
  interface PluginState {
    'reply-tool': {
      /** The setting: off, or on (the prompt contract and the active respond tool) drawing tldr, exec or full. Session-only: never persisted, so every session starts off. */
      mode: ReplyToolMode
    }
  }
}
