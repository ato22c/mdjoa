# MDjoa

> **Read what your AI wrote, the moment it writes it.**
> A lightweight desktop viewer for the Markdown files that AI tools produce every day.

🇰🇷 [한국어 README](README.ko.md)

---

## Why MDjoa?

If you work with AI, you know the pattern.

- Claude, Codex, or Cursor writes a plan, a spec, a summary, and a dozen notes in `.md` files.
- You open them in Notepad or VS Code and see raw `#`, `**`, and `|---|` symbols instead of a readable document.
- The AI edits a file, and you are not sure what changed. You reopen it, scroll, and hunt for the difference.
- You copy a file, paste it into the chat, and hope the AI has the latest version.
- Ten files later, you cannot remember which one holds the decision you need.

**MDjoa was built for that loop.** It turns AI-generated Markdown into documents you can actually read, and it keeps them up to date while the AI keeps working.

- **Read, don't parse.** Documents render as clean pages, with tables, diagrams, and code highlighting.
- **See changes as they happen.** When a file changes on disk, the view refreshes. No reopening, no manual refresh.
- **Review what the AI changed.** Compare the current version with the one you first opened.
- **Move fast across many files.** Open any document in a keystroke, search a whole folder, and jump back to where you were.
- **Stay in control.** Everything runs on your computer. No account, no sign-in.

MDjoa is a viewer, not an IDE. It does one job: help you read and check documents, quickly and reliably.

---

## Who it's for

- **Developers** who run AI agents across a project and need to review their output without leaving the flow.
- **Non-developers** who use AI for writing, research, planning, or translation and want their Markdown documents to look like documents, not code.
- **Anyone** who keeps a growing folder of notes, drafts, or AI output and needs to find and read the right one fast.

You do not need to know Markdown syntax, Git, or the command line to use MDjoa.

---

## What you can do

- **Read beautifully.** GitHub-flavored Markdown: tables, footnotes, task lists, callouts, math, Mermaid diagrams, and syntax-highlighted code. It remembers where you stopped reading.
- **Watch documents update live.** Files changed by an AI tool or another editor refresh automatically. While you are editing, MDjoa warns you instead of overwriting your work.
- **Review AI changes.** Side-by-side comparison with the version you first opened.
- **Prepare context for AI.** Collect related documents, see the token count, and copy them as a prompt for your next AI session.
- **Run AI tasks from the menu.** Review, improve, summarize, or translate a document through your local `claude` CLI. Optional, and only when you click.
- **Navigate quickly.** Command palette (`Cmd/Ctrl+K`), quick open (`Cmd/Ctrl+O`), folder-wide search, back and forward history, and multiple windows.
- **Manage files.** Rename and delete from the file tree. Favorites and recent files stay in sync.
- **Make small edits.** Edit the Markdown source with a split preview and auto-save.
- **Open more than Markdown.** Plain text and source code files open with syntax highlighting.
- **Use your language.** Korean and English UI, switchable in Settings, including the native menu and window title.
- **Share as documents.** Export to PDF, Word, and HTML. Use focus mode (`Cmd/Ctrl+Shift+Enter`) to read without distractions.

Full user guide: [English](docs/user-manual.en.md) · [한국어](docs/user-manual.md)

---

## Installation

1. Open the [GitHub Releases](https://github.com/ato22c/mdjoa/releases) page.
2. Download the installer for your system:
   - Windows: `.exe` installer
   - macOS: `.dmg` image
3. Run the installer and follow the prompts.

**winget**: Coming soon.

### Build from source

Requirements: Node.js 20+, Rust (rustup), and the platform toolchain (Visual Studio Build Tools with C++ on Windows, Xcode Command Line Tools on macOS).

```bash
npm install
npm run tauri dev     # development mode with hot reload
npm run release       # build an installer for your OS
```

Installers are written to `src-tauri/target/release/bundle/`.

---

## Reporting issues

Please report bugs on [GitHub Issues](https://github.com/ato22c/mdjoa/issues). Use the bug report template and include:

1. **App version**: Hamburger menu → About.
2. **OS and steps to reproduce**.
3. **Diagnostic log (optional but helpful)**:
   1. Open **Settings** and click **Open log folder** (the command palette has it too).
   2. Attach `mdjoa.log` to the issue, or paste the relevant lines.
   3. **Check the log before posting.** It may contain file paths. Remove anything private, such as folder names or document titles you don't want to share.

---

## License

MIT License. Copyright © 2026 sy.baek@fusionsoft.co.kr. See [LICENSE](LICENSE) for details.

Bundled fonts Pretendard and JetBrains Mono are licensed under the SIL Open Font License 1.1. See `THIRD-PARTY-LICENSES.txt`.
