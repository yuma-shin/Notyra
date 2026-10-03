<h1 align="center"><img src="./docs/images/icon.png" width="30" /> Notyra</h1>

[日本語版](./README.md)

Notyra is a desktop Markdown editor built with **Tauri v2 + React**.
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
- PDF / HTML export

### Basic Usage

1. Launch the app and select your root folder for notes
2. Choose a folder from the left folder tree
3. Open a note from the note list or create a new one
4. Edit the content (changes are auto-saved)
5. Use tag filters, sorting, and separate-window view as needed

### Note Format

Notyra reads Markdown front matter as note metadata.

```yaml
---
title: Sample
tags:
  - memo
  - notyra
createdAt: 2026-02-12T00:00:00.000Z
updatedAt: 2026-02-12T00:00:00.000Z
---

# Content
```

## For Developers

### Tech Stack

| Layer | Technology |
|-------|------------|
| UI Framework | React 19 + TypeScript |
| Desktop Runtime | **Tauri v2** (Rust) |
| Build | Vite 7 + Tauri CLI |
| Styling | Tailwind CSS v4 |
| Editor | CodeMirror 6 |
| Testing | Vitest |
| Linter | Biome |

### Requirements

#### Running distributed binaries

- OS: Windows 10/11 / macOS 12+ / Linux (Ubuntu 22.04+)
- No Rust installation required (bundled in the binary)

#### Development environment

- Node.js: `22.x` (from `.nvmrc`)
- pnpm: `10.x` (from `packageManager`)
- **Rust toolchain**: Install via [rustup](https://rustup.rs/)
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- Linux only: System packages required
  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  ```

### Setup

```bash
pnpm install
```

### Development

```bash
pnpm dev        # tauri dev (starts frontend + backend together)
```

### Main Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development mode (Tauri dev server) |
| `pnpm build` | Build distributable binary (`tauri build`) |
| `pnpm lint` | Run Biome lint checks |
| `pnpm lint:fix` | Run lint with auto-fix |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm test` | Run Vitest tests |
| `pnpm test:watch` | Run Vitest in watch mode |
| `pnpm test:coverage` | Run tests with coverage report |

### Project Structure (Excerpt)

```text
src-tauri/          # Tauri / Rust backend
  src/
    commands/       # Tauri commands (markdown, image, export, window)
    lib.rs          # App entry point & plugin registration
    state.rs        # Shared state (file watchers, etc.)
  tauri.conf.json   # Window config, CSP, build settings
  Cargo.toml        # Rust dependencies

src/
  renderer/         # React UI (frontend)
    lib/
      tauriApi.ts   # Tauri invoke wrapper (IPC adapter)
      windowState.ts # Window state persistence
    hooks/          # Custom hooks
    components/     # UI components
    screens/        # Screen components (main, editor)
    plugins/        # rehype plugins
  shared/           # Shared type definitions
```

### Running Distributed Unsigned App

See `RUN_UNSIGNED_APPS.en.md` for platform-specific instructions.

### Branches and Releases

Create change branches and `release/vX.Y.Z` branches from `main`, and target `main` in pull requests.
CI runs on pull request creation and updates. Merging a release PR creates a tag, builds packages, and uploads them to a release draft.
See [Branch and release workflow (Japanese)](docs/release.md) for the procedure and migration from `develop`.

## Contribution

If you find a bug in the source code, it would help a lot if you could create an issue in the GitHub repository.
It would help even more if you fix the bug and submit a pull request.

## License

MIT. See `LICENSE.md`.
