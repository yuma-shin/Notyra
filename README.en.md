<h1 align="center"><img src="https://raw.githubusercontent.com/yuma-shin/flowmark/heads/main/docs/images/icon.png" width="30" /> FlowMark</h1>

[日本語版](./README.md)

FlowMark is a desktop Markdown editor built with Electron + React.  
It uses a local folder as the root workspace and lets you edit and preview `.md` files in a single app.

## For Users

### Key Features

- Automatically scans Markdown notes under the selected root folder
- Folder tree navigation with folder-based note filtering
- Create / move / delete notes
- Create / delete folders
- Edit note metadata (title and tags)
- Search notes by title, excerpt, and tags
- Sort notes by updated date or title
- Switch layout mode: `editor` / `preview` / `split`
- Auto-save with debounce
- Auto-reload when files are changed externally
- Open notes in a separate window

### Basic Usage

1. Launch the app and select your root folder for notes
2. Choose a folder from the left folder tree
3. Open a note from the note list or create a new one
4. Edit the content (changes are auto-saved)
5. Use tag filters, sorting, and separate-window view as needed

### Note Format

FlowMark reads Markdown front matter as note metadata.

```yaml
---
title: Sample
tags:
  - memo
  - flowmark
createdAt: 2026-02-12T00:00:00.000Z
updatedAt: 2026-02-12T00:00:00.000Z
---

# Content
```

## For Developers

### Tech Stack

- Electron
- React 19
- TypeScript
- Vite (electron-vite)
- Tailwind CSS v4
- CodeMirror 6
- Vitest
- Biome

### Requirements

- Node.js: `22.x` (from `.nvmrc`)
- pnpm: `10.x` (from `packageManager`)
- Target OS: Windows / macOS (configured in `electron-builder.ts`)

### Setup

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

### Main Commands

- `pnpm dev`: Start development mode
- `pnpm start`: Start preview mode
- `pnpm lint`: Run lint checks
- `pnpm lint:fix`: Run lint checks with auto-fix
- `pnpm typecheck`: Run TypeScript type checks
- `pnpm test`: Run tests
- `pnpm test:watch`: Run tests in watch mode
- `pnpm test:coverage`: Run tests with coverage
- `pnpm prebuild`: Build app + prepare package metadata
- `pnpm build`: Build distributable packages
- `pnpm release`: Publish release build

### Running Distributed Unsigned App

See `RUN_UNSIGNED_APPS.en.md` for platform-specific instructions.

### Project Structure (Excerpt)

```text
src/
  main/       # Electron main process
  preload/    # contextBridge API
  renderer/   # React UI
  shared/     # Shared types/constants
```

## Contribution

If you find a bug in the source code, it would help a lot if you could create an issue in the GitHub repository.
It would help even more if you fix the bug and submit a pull request.

## License
MIT. See `LICENSE.md`.

