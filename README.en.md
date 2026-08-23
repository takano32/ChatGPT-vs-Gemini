# ChatGPT vs Gemini

[日本語](README.md)

A desktop app that shows ChatGPT and Gemini side by side, as their regular web pages, and lets the two AIs debate each other.

- Electron + TypeScript (no bundler, just tsc)
- Layout: a control pane on the top half, ChatGPT / Gemini on the bottom half (50% / 50%). Drag the bottom edge of the control pane to change the vertical ratio (for the current session; the default is a setting). The chat-pane zoom (default 75%) is configurable too
- Transcripts are stored in SQLite, with full-text search (FTS5 trigram, works for Japanese)
- No API: the free web UIs are driven by DOM manipulation

## Works without an account

The app runs in guest mode by default; no account or login is required. You may log in to ChatGPT and/or Gemini inside their panes if you want: your conversations then appear in the site's own history, and usage limits may be looser. Sessions are kept, so you log in once at most.

## Install

Pick the package for your OS on the [download site](https://takano32.github.io/ChatGPT-vs-Gemini/) (every format is on [Releases](https://github.com/takano32/ChatGPT-vs-Gemini/releases)).

- **macOS**: open the `.dmg` and drag `ChatGPT vs Gemini` to Applications (arm64 for Apple silicon, x64 for Intel). The app is **unsigned** for now, so the first launch says the developer cannot be verified or the app is "damaged": go to System Settings → Privacy & Security → "Open Anyway" (or run `xattr -d com.apple.quarantine "/Applications/ChatGPT vs Gemini.app"`).
- **Windows**: run `ChatGPT-vs-Gemini-Setup-<version>.exe` (per-user install, no admin rights). When SmartScreen says "Windows protected your PC", click "More info" → "Run anyway". A portable build, zip and msi are also available.
- **Linux**: deb (Ubuntu / Debian), rpm (Fedora) and pacman (Arch) packages are recommended. For the AppImage, `chmod +x` it and run (the Chromium sandbox is disabled). The tar.gz unpacks to a `chatgpt-vs-gemini` binary.

## Usage

1. Start the app. It is usable right away as a guest; logging in inside the ChatGPT / Gemini panes is optional.
2. Type a topic (Enter inserts a line break; Ctrl+Enter / ⌘+Enter also starts), choose a mode (debate / collaboration / brainstorm / dialectic / story relay / review / interview / Socratic / devil's advocate / quiz; parentheses show the roles of the first / second speaker), which AI speaks first, and set the maximum number of turns with ▲▼ (one AI message = one turn), then press Start. Pause / Resume / Stop control the debate.
3. The language switch at the top right (日本語 / English) changes the UI text, the transcript view and the prompt templates (a running debate keeps its language). While a debate runs, the chat panes are locked (scrolling still works). The Transcript button switches between the live view and a transcript you can copy as Markdown. ☰ opens settings, history and full-text search.

## Notes

- Unofficial tool, not affiliated with OpenAI or Google.
- It automates the web UIs (as a guest or logged in). Check each service's terms of use yourself; automation may lead to temporary rate limits or other effects on your account. Use at your own risk.
- The chat panes send a Firefox User-Agent (Google login does not complete with the default Electron UA).
- The UI, the transcript view and the default prompt templates are available in Japanese and English (top-right switch). Templates are stored per language and mode and can be edited in ☰ → Settings. A timekeeper line (turn n of N, phase: early / middle / late) is prepended to every prompt and the last two turns ask both AIs for a closing summary.
- The Gemini button selectors were measured with the Japanese UI locale and fall back to language-independent icons, so sending works in other locales; the text patterns for rate limits, errors and login prompts cover Japanese and English only.
- Real debates have only been verified on Linux (arm64). The macOS and Windows builds are smoke-tested in CI (the app starts, the database and search work) but have not been used for actual debates.
- When ChatGPT or Gemini changes its page structure the app stops working. The place to fix is `src/chat/selectors.ts`; the procedure is in [docs/selectors.md](docs/selectors.md) (Japanese).
- Transcripts are stored unencrypted in a local SQLite database, and login sessions stay on the machine. Data lives in Linux `~/.config/ChatGPT vs Gemini`, macOS `~/Library/Application Support/ChatGPT vs Gemini`, Windows `%APPDATA%\ChatGPT vs Gemini`: `settings.json` (settings), `data.db` (transcripts), `Partitions/` (login sessions). Delete what you want to reset. The admin-pane log is also written to `logs/main.log` (under userData on Linux / Windows, `~/Library/Logs/ChatGPT vs Gemini` on macOS); attach it when reporting a problem.

## Development

```sh
npm install
npm start        # build and run
npm run build    # tsc + asset copy
npm run typecheck
npm test         # page-script syntax check and Repository / settings / Markdown export tests (run after build)
npm run pack     # unpacked app only (release/*-unpacked/)
npm run dist     # distributables for the current OS, in release/
```

Packages are built with [electron-builder](https://www.electron.build/) (`electron-builder.yml`). Building deb / rpm / pacman on Linux needs `rpmbuild` and `bsdtar`.

## License

MPL-2.0
