# MDjoa User Manual

Open this manual in MDjoa itself and you'll see the callouts, table of contents, and checkboxes rendered exactly as intended.

> [!tip] Open this document in MDjoa
> Go to Help → **User Manual** to open this exact document right away.

---

## 1. What is MDjoa?

MDjoa is a lightweight viewer for **quickly opening and reading** Markdown (`.md`) documents. It can also open `.html` and `.pdf` files directly as rendered pages.
It's especially handy for immediately re-reading a document an AI tool just edited, or for quickly jumping between many documents. No login is required, and no data ever leaves your computer (everything runs locally).

**Windows 10/11** is the primary platform, and the app works identically on macOS. Shortcuts are written with `Ctrl` (on macOS, use `⌘` instead of `Ctrl`), and they're all collected in one place at the end, in [8. Keyboard Shortcuts](#8-keyboard-shortcuts).

---

## 2. Quick Start

There are several ways to open a document — use whichever is convenient.

- The **Open File** / **Open Folder** buttons on the welcome screen
- The **hamburger menu (☰)** in the top-left → Open File/Folder
- **Drag and drop** a file into the window
- Double-click a `.md`/`.html` file in File Explorer (if MDjoa is set as the default app)
- **Create a new document**: `Ctrl+N` or hamburger menu → **New Document**. It won't ask for a name or location first — you start **editing an untitled document immediately** (auto-saved to a temporary file while you type), and a dialog to choose the file name and location appears only when you **save (`Ctrl+S`) or switch to another document**. You can also right-click a folder in the file tree → **New Document in This Folder** to create one instantly (with an auto-generated name) in that folder.

> [!tip] Opening a folder is more convenient
> You can open a single file, but **opening a folder** adds a file list (tree) on the left, letting you move quickly between documents.

When you quit and relaunch the app, **the last folder and file you had open are automatically restored** (session restore).

When moving between multiple documents, you can navigate like a browser using **Back/Forward** (`Ctrl+[` / `Ctrl+]`, or `Ctrl+←` / `Ctrl+→`, or the **← →** buttons in the top bar). You can also open a document in its own **independent window** via **Open in New Window** from the tree, Quick Open, or the hamburger menu, so you can view two documents side by side.

> [!tip] One shortcut for everything — the Command Palette
> Press `Ctrl+K` (macOS: `⌘K`) to open the **Command Palette**. It lets you **search by name and instantly run almost any feature** — opening files, creating a new document, comparing documents, search, themes, focus mode, the AI change review, and more — so you never have to memorize menu or button locations. (`↑`/`↓` to move, `Enter` to run, `Esc` to close)

---

## 3. Reading Documents

MDjoa renders GitHub-flavored (GFM) Markdown beautifully. Tables, footnotes, code blocks (with syntax highlighting and a **Copy** button in the top-right corner), images, callouts (`> [!note]`, etc.), checkboxes, and front-matter metadata (`--- … ---`) are all supported out of the box. This section covers the features unique to this app.

> [!note] Raw HTML tags are not rendered, for safety
> Raw HTML written directly inside a Markdown document is not rendered. Please use plain Markdown syntax.

### Viewing HTML and PDF Files

`.html`/`.htm` files open as **rendered pages, just like in a browser** (not as source code). `.pdf` files are displayed using the OS's built-in PDF viewer (WebView2 on Windows, WKWebView on macOS). You can open them from the Open File dialog, by drag-and-drop, or from the file tree.

> [!note] HTML and PDF don't support editing, AI tasks, or export
> Since these aren't plain Markdown text files, edit mode, AI tasks, the outline, and document stats are automatically disabled for them.

### Click-to-Save Checkboxes

`- [ ]` list items can be **checked directly from the reading view**, and the result is saved to the file immediately. There's no need to enter edit mode.

### Checking a Document's Modified Date

**Hover over the file name** in the middle of the top bar to see a tooltip with the document's **full path**, along with its **creation time** and **modified time** (e.g., `Modified 2026-06-13 14:30`). This is handy for quickly checking when an AI or another tool last changed a document.

### Table of Contents

Click the **outline icon** in the top bar to open a heading list on the right. Clicking an entry jumps to that location, and the current position is highlighted automatically as you scroll. Hover over a heading to also add it as a bookmark.

### Wikilinks and Backlinks

Writing `[[filename]]` or `[[filename#heading]]` in a document lets you click it to jump straight to that document in the same folder (add a heading to scroll to that specific spot). If the target document can't be found, a brief "File not found" notice appears.

Conversely, **other documents that link to the one you're currently viewing** via `[[…]]` are collected in the **Backlinks** list near the bottom of the sidebar. If no documents link to it, the backlinks area doesn't appear.

### Document Stats (Tokens, Words, Characters)

**Token, word, and character counts** appear next to the file name in the top bar. Tokens are calculated locally on your computer using GPT-4o/Claude-family tokenization, and the count updates to its precise value shortly after a file is opened.

### Focus Mode

When reading closely or sharing your screen, turn on **Focus Mode** to hide the top bar and sidebar, leaving **just the document body**. Turn it on with `Ctrl+Shift+Enter` (macOS: `⌘⇧Enter`), **View menu → Focus Mode**, **right-click the document → Focus Mode**, or the Command Palette (`Ctrl+K`), and turn it off with `Esc`.

> [!tip] Scroll with the keyboard right after opening a document
> Opening a document focuses the body immediately, so you can scroll with `↑`/`↓`, `Page Up`/`Page Down`, or `Space` without clicking first.

### Remembering Your Reading Position, and Scroll-to-Top

- **Remembering your position**: When reading a long document, even if you navigate away and back — or **quit and relaunch the app** — your last reading position is restored automatically. (No settings needed.)
- **Scroll-to-top button**: Once you've scrolled down far enough, a small **↑ button appears in the bottom-right** of the document body. Click it to smoothly scroll back to the top.

### Links, Zoom, and Theme

- Web links (`http`) and email links open in your **OS's default browser** when clicked. Such **external links get a small ↗ mark** to indicate they lead outside the document. (This mark doesn't appear on `[[wikilinks]]` between documents or on in-page navigation links.)
- Adjust body text size with the `-` / `%` / `+` buttons in the top bar, keyboard shortcuts, or `Ctrl` + mouse wheel.
- Change the **theme (Light / Dark / System)** from the **right-click menu on the document body**, **Settings**, or the **Command Palette (`Ctrl+K`)**.

---

## 4. Finding and Opening Things Quickly

Tools that come in handy when working with many documents.

| Tool | Shortcut | Description |
| --- | --- | --- |
| **Command Palette** | `Ctrl+K` | Search by name and run almost any feature — open, new document, compare, search, theme, focus mode, change review, and more. (`↑`/`↓` to move, `Enter` to run, `Esc` to close) |
| **Recent** | — | Recently opened files and folders. Find them on the welcome screen, in the hamburger menu, or under `File → Recent` in the OS menu. |
| **Favorites** | `Ctrl+D` | Pin frequently viewed files/folders to the top of the sidebar. Add them via the **star (☆)** next to a tree item or file name, and drag to reorder. `Ctrl+D` toggles the **currently open document** in or out of favorites. |
| **Quick Open** | `Ctrl+O` | Type part of a name to instantly find and open a document or folder. **You can also search by folder name**, so when many files share the same name (e.g. `SKILL.md`), you can tell them apart by their folder (e.g. `ui-ux`) — such files show the **folder name in bold**. **Folders (📁) also appear in results**; selecting one opens that folder. Use the **`All · Folders · Files`** tabs in the header to narrow the scope (cycle with `Tab`), and results include not just the current folder but also files/folders from **`.claude` skills, favorites, and recents**. With an empty query, recent files are shown first. (`↑`/`↓` to move, `Enter` to open, `Esc` to close) |
| **Search in Folder** | `Ctrl+Shift+F` | Search the **contents** of every document in a folder for a piece of text. Clicking a result opens that file. |
| **Search in Document** | `Ctrl+F` | Search for text within the currently open document. Also opens via the **search icon** in the top bar. The search box **closes when you click elsewhere**, and closes automatically when you switch between view and edit modes. |
| **Find & Replace while Editing** | `Ctrl+F` | Pressing `Ctrl+F` in edit mode opens a **Find & Replace** bar. Use `Enter`/`Shift+Enter` for next/previous, `Aa` for case sensitivity, **Replace** (current match), and **Replace All** (`Shift+Enter`). Replacements can be undone with `Ctrl+Z`. |
| **Context Section** | — | When you open a folder, guide documents like `CLAUDE.md` and `README.md` are automatically collected at the top of the sidebar (see Section 5 below). |
| **Skills Section** | — | If a folder contains `.claude/`, its **skills, agents, and commands** are shown grouped by type in a "Skills" section of the sidebar. Clicking an item opens that document, and the list refreshes automatically when files are added, changed, or removed. If there's no `.claude`, the section doesn't appear. |

> [!tip] **Quick Open** (`Ctrl+O`) and **Search in Folder** (`Ctrl+Shift+F`) open via keyboard shortcut
> These two tools have no dedicated button — they're launched **by shortcut only**. With a folder open, pressing `Ctrl+O` opens the quick-open-by-name window, and `Ctrl+Shift+F` opens the folder-wide content search window. (On macOS, use `⌘` instead of `Ctrl`.)

> [!note] Search in Folder shows only some results when there are many
> In large folders, not all results are displayed — only a subset. When this happens, you'll see a note like "Showing partial results — try a more specific search term."

The folder tree automatically reflects changes on disk — **newly created files get a green dot (●)**, **modified files get an amber dot (●)**, and **deleted files disappear from the list**. Opening a file clears its dot. If the automatic refresh doesn't catch something (especially a new subfolder), use the **refresh (↻)** button in the explorer header, or **right-click anywhere in the tree → Refresh Explorer**.

### Renaming and Deleting Files

**Right-click** a file or folder in the explorer to do the following.

- **Rename**: The name turns into an editable field in place. Type the new name and press `Enter` to save, or `Esc` to cancel. If a file with that name already exists, you'll be notified instead of overwriting it. If the renamed file is in favorites or recents, or currently open, its path is updated automatically (for folders, this includes documents inside them).
- **Delete**: Sends the file or folder to the **system Recycle Bin/Trash** (not a permanent delete, so you can restore it from the OS trash if needed). It's also cleaned up from favorites and recents, and if it was the currently open document, its view closes.

---

## 5. Features Useful for AI Work

Features that are especially useful when creating and refining documents with AI.

- **Context Section** — When you open a folder, guide and design documents like `CLAUDE.md`, `AGENTS.md`, `SKILL.md`, `README.md`, `*.spec.md`, and `plan*.md` are **automatically collected at the top of the sidebar**. This makes it easy to spot at a glance the documents that define what you want an AI to do. (The file patterns collected can be changed in Settings; the section is hidden if no matching documents exist.)
- **Combined Token Gauge** — Check **one or more checkboxes** next to documents in the Context Section, and the sidebar shows a bar chart of the **combined token count** for the selected documents against a model limit (e.g., 128k / 200k / 1M). This lets you estimate ahead of time whether the documents you plan to feed an AI will exceed its limit. (The limit can be changed with a button or by typing a value directly.)
- **Copy Context to Prompt** — After checking documents in the Context Section, click the **clipboard icon** in the combined-token panel to **merge the selected documents into a single block of text with file-boundary headers and copy it to the clipboard** (in the order you selected them). This is a quick way to gather context to paste into an AI conversation.
- **AI Change Review Center** — After an AI edits several documents in a folder, review **everything that changed, in one screen**. Open it via **Change Review** in the Command Palette (`Ctrl+K`) or **Review N Changes** in the sidebar to see a list of changed files (created/modified/deleted) along with a line-by-line diff between **what you first saw and the current contents on disk**. Once you've reviewed everything, use **Mark All Reviewed** to clear the markers at once.
- **Wikilinks / Backlinks** — Linking related documents together with `[[document]]` lets you jump between them with a single click and instantly see which documents reference this one (backlinks). Great for tying together scattered design documents.
- **Compare Two Documents** — Use `Ctrl+\` or hamburger menu → **Compare with Another Document…** to do a **line-by-line comparison** between the current document and another one (lines only in the other document are shown in green, lines only in the current document in red). Useful for comparing similar documents, like prompt v1 vs. v2. Close with `Esc` or ✕.
- **AI Tasks (Review, Improve, Summarize, Translate)** — Available from **AI Tasks** in the hamburger menu or the body's right-click menu. All of these run through the locally installed `claude` CLI (Claude Code), so they use your **existing Claude Code login with no extra API key or additional charges**.
  - **Review** — Points out problems and improvements without rewriting the document (read-only).
  - **Improve** — Rewrites the document to be clearer while preserving its meaning.
  - **Summarize** — Produces a short summary of the key points.
  - **Translate to Korean / English** — Translates the document. Also reachable directly from the **translate icon** in the top bar.

  Results are shown as a **side-by-side original ↔ result view**. Improve and Translate results can be copied or **saved as a new file** (Review and Summarize can only be copied, not saved), and chunked tasks like translation show live progress with a **Cancel** button to stop at any time.

> [!note] AI tasks only use the network when you trigger them yourself
> The app only communicates with Anthropic via the `claude` CLI when you click an AI task in the menu.
> Everything else (token calculation, rendering, etc.) happens locally, with no network access.

> [!tip] All processing happens on your computer
> All processing, including token counting, happens locally with no network access
> (except for AI tasks — see the note above).

---

## 6. Editing

Editing in MDjoa is **light-touch — think typo fixes**, not a full rich-text authoring tool. There's no elaborate toolbar; you edit the raw Markdown directly. Just turn on edit mode while a file is open.

- **Line numbers** — Line numbers appear to the left of the editing area. Even when a long line wraps, the numbers stay aligned to logical lines.
- **Split view** — The first time you enter edit mode with `Ctrl+E`, a **split edit + preview view** opens by default. Your typing is reflected in the preview on the right immediately. Use the **"Edit Only"** button in the toolbar to switch to a single-pane editor, and click it again to go back to split view.
- **Undo/Redo** — Supports multiple steps (rapid consecutive keystrokes are grouped into a single step).
- **Auto-save** — Saves automatically shortly after you stop typing (can be turned off in Settings).
- **Find & Replace** — Use `Ctrl+F` to find and replace within the editing area (`Enter`/`Shift+Enter` for next/previous, `Aa` for case sensitivity, **Replace** and **Replace All**). Any replacement can be undone.
- **Save As** — Use `Ctrl+Shift+S` (or the hamburger menu/Command Palette) to save the current content as a new file and switch to it. The original file is left untouched.

> [!tip] New documents start as temporary files
> A new document created with `Ctrl+N` starts unnamed and is auto-saved to a temporary file while you type.
> A dialog to choose the file name and location appears only when you **save (`Ctrl+S`) or move to another document while there's content**.
> If you leave without typing a single character, the temporary file is quietly cleaned up.

> [!warning] External changes while editing — your edits are never silently lost
> If another tool (e.g., an AI) modifies the same file while you're editing it:
> - **If you have no unsaved edits** → the external changes are **applied to the editor automatically**.
> - **If you have unsaved edits** → nothing is overwritten. Instead, you'll see a "Changed externally — saving will overwrite it with your edits" warning along with a **[Load Disk Content]** button. Saving directly (`Ctrl+S`) keeps your edits; clicking [Load Disk Content] switches to the external content — the choice is yours.
> - **If the file is deleted externally** → you'll see a "Deleted externally — saving will recreate it" notice, and **your in-progress edits are preserved** (recreate the file with `Ctrl+S`).

If you try to turn off edit mode or open another file while there are unsaved changes, a confirmation dialog appears first so you don't lose them.

In reading mode, if a file changes externally and **Auto-reload** is enabled in Settings (the default), it's reread automatically and a brief "Updated" notice is shown. If it's disabled, you'll only see a notification, and you can refresh manually with the **Refresh** button. If the document you're viewing is **deleted**, a "Deleted — content preserved · [Save Current Content Again]" notice appears (if a file with the same name reappears, it's picked back up automatically).

---

## 7. Settings and Export

### Settings

Adjust these from the hamburger menu → **Settings**.

- **Language** (Korean / English / auto-detect from System) — takes effect across the whole app, including the menu bar, as soon as you change it.
- Check the status of, install, or remove the conversion engine (pandoc)
- Toggle **Auto-reload on file changes**
- Toggle **Auto-save while editing**
- Edit **context document patterns** (one per line, `*` wildcards supported — e.g., `*.spec.md`)
- View app info and open-source licenses

### Export

Available from the **export icon** in the top bar (while a document is open).

| Option | Description |
| --- | --- |
| Export as PDF | Outputs to PDF via the print dialog |
| Word (DOCX) | Converts to DOCX (uses the pandoc conversion engine — if not present, a one-time download occurs with your consent from Settings) |
| Copy as Formatted HTML | Copies to the clipboard with rendered formatting preserved |

---

## 8. Keyboard Shortcuts

> [!tip] Shown as Windows shortcuts
> Shortcuts below are shown for **Windows** (`Ctrl`) by default. On macOS, use `⌘` (Command) instead of `Ctrl`. Most are also shown in the OS menus (`File`, `View`, `Edit`).

| Action | Windows | macOS |
| --- | --- | --- |
| Command Palette | `Ctrl+K` | `⌘K` |
| New Document | `Ctrl+N` | `⌘N` |
| Open File | `Ctrl+O` | `⌘O` |
| Open Folder | `Ctrl+Shift+O` | `⌘⇧O` |
| Quick Open | `Ctrl+O` | `⌘O` |
| Back (document history) | `Ctrl+[` or `Ctrl+←` | `⌘[` or `⌘←` |
| Forward (document history) | `Ctrl+]` or `Ctrl+→` | `⌘]` or `⌘→` |
| Compare with Another Document | `Ctrl+\` | `⌘\` |
| Search in Folder | `Ctrl+Shift+F` | `⌘⇧F` |
| Search in Document | `Ctrl+F` | `⌘F` |
| Toggle Sidebar | `Ctrl+B` | `⌘B` |
| Toggle Favorite for Current Document | `Ctrl+D` | `⌘D` |
| Zoom In | `Ctrl+=` or `Ctrl++` | `⌘=` or `⌘+` |
| Zoom Out | `Ctrl+-` | `⌘-` |
| Reset to 100% | `Ctrl+0` | `⌘0` |
| Print/Export as PDF | `Ctrl+P` | `⌘P` |
| Toggle Edit/View Mode | `Ctrl+E` | `⌘E` |
| Toggle Focus Mode | `Ctrl+Shift+Enter` | `⌘⇧Enter` |
| Save (edit mode) | `Ctrl+S` | `⌘S` |
| Save As | `Ctrl+Shift+S` | `⌘⇧S` |
| Find & Replace (edit mode) | `Ctrl+F` | `⌘F` |
| Undo (edit mode) | `Ctrl+Z` | `⌘Z` |
| Redo (edit mode) | `Ctrl+Shift+Z` / `Ctrl+Y` | `⌘⇧Z` / `⌘Y` |
| Open Settings | `Ctrl+,` | `⌘,` |

> [!note] `Ctrl+O` serves two purposes
> While a folder is open, `Ctrl+O` opens the **Quick Open** launcher.

> [!note] Turning Focus Mode on and off
> **Focus Mode** can be turned on with `Ctrl+Shift+Enter` (macOS: `⌘⇧Enter`), the View menu, right-clicking the document, or the Command Palette, and turned off with `Esc`.

---

## 9. Frequently Asked Questions

> [!note] I edited a file externally, but the view didn't update.
> If **Auto-reload** is turned off in Settings, you'll only see a notification. Click the **Refresh** button at the top, or turn on auto-reload in Settings.

> [!note] I clicked a checkbox and it changed the file.
> That's expected behavior. Clicking a checkbox in the reading view writes the change directly to the original file.

> [!note] I'm editing, but auto-save isn't working.
> If another tool has modified the same file (an external change), auto-save pauses so it doesn't overwrite that content. Review the content, then save manually with `Ctrl+S`.

> [!warning] Your data is never sent anywhere.
> All processing, including token counting, happens locally. There are only two cases where the network is used — ① downloading pandoc (the conversion engine) after you consent, and ② communicating with the `claude` CLI when you click an AI task in the menu yourself (no additional charges).

---

## Need Help?

MDjoa keeps getting better thanks to your feedback. If something is inconvenient to use, or you think of a feature that would help, **please feel free to reach out any time**. Send feature requests and bug reports to [sy.baek@fusionsoft.co.kr](mailto:sy.baek@fusionsoft.co.kr).
Even small feedback helps a lot. Thank you!

---

MDjoa v1.4.0 — A lightweight Markdown viewer
Copyright © 2026 sy.baek@fusionsoft.co.kr. All rights reserved.
