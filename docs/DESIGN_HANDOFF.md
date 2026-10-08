# ByteCaptions — Design → Code Handoff

The UI has been designed in Penpot. This document gets a new session up to speed so it builds
the real Angular 22 + Tauri 2 app to match. Read `PLAN.md` for product scope; this file is about
the UI.

## 1. Source of truth: Penpot (via MCP)

- File: **"ByteCaptions App"** on the self-hosted Penpot at `penpot.daydreamstudio.cc`.
- MCP is configured in `.mcp.json`; the token comes from `PENPOT_MCP_TOKEN` in the gitignored
  `.claude/settings.local.json`. **Never print, log or commit the token.**
- Before using it: call `high_level_overview`, and ask the user to open the file in their browser
  and press **MCP → Connect here** (the plugin only works while that tab is awake).
- Use `execute_code` to **read** exact values (sizes, paddings, token bindings, text) and
  `export_shape` to **see** a board. Treat the designs as read-only unless the user asks for
  design changes.
- Keep each `execute_code` call small. Long scripts time out (~100 s, Cloudflare) and can wedge
  the server ("Duplicate connection for given user token"); the fix is the user restarting the
  `penpot-mcp` service, not reloading the tab.

### Pages and boards

| Page | What's there |
|---|---|
| **Design Guidelines** | Palette, tokens, typography, spacing, radius, state colors, focus ring, outline rules |
| **Core Components** | Every component with variants. "Core Components - Dark" + "Core Components - Light" side by side |
| **Main App** (dark mode only so far) | All screens below |

Main App boards (find by name with `penpot.openPage` + `findShapes`):

- **Editor - Dark - 1440 - Cues tab focus / Transcript tab focus / Problems tab focus** — main editor
- **Style Presets - Dark - 1440 - Dialogue / Sound effect (edge on)** — preset editor dialog
- **Start - Dark - 1440 - Default / Dragging video** — start screen + drop-zone state
- **Auto-transcribe - Dark - 1440 - Setup / Running / Error / Done / Running in background**
- **Export - Dark - 1440 - SRV3 / SRT (drops styles)**
- **Command Palette - Dark - 1440 - Searching / Empty query**
- **Timeline Menus - Dark** — right-click menus (cue, empty track, track header, multi-select, submenu)
- **Timeline Interactions - Dark** — trim, snapping, box select

## 2. Design system (implement as CSS custom properties first)

Token sets in Penpot: **Core**, **Mode/Dark**, **Mode/Light**, **Palette**. `color.*` tokens alias
`{dark.*}` / `{light.*}` palette values; themes are "Dark" and "Light". Build these as CSS variables
(`--color-bg`, `--spacing-sm`, …) with a `[data-theme]` switch, and never hardcode hex in components.

**Core**
- Brand "A Byte of Melon" `#809d6d`; "A Byte of Dark" `#5f7a4e` (light-mode focus ring)
- Radius: panel 16, control 8, small 4
- Spacing: xs 4, sm 8, md 12, lg 16, xl 24, xxl 32

**Dark** (default) / **Light**
| token | dark | light |
|---|---|---|
| bg | #151517 | #f8f8ff |
| panel | #1b1b1e | #e4e4ef |
| card | #27272b | #fdfdff |
| selected | #2d2d3a | #dcdcff |
| text | #fcfcfc | #030303 |
| text-faded | text @ 50% | text @ 60% |
| control-border | #6a6a7a | #7c7c90 |
| info | #6b9bea | #00409f |
| warning | #c89a08 | #7d5f00 |
| success | #3dba5c | #006b1d |
| danger | #f06464 | #c80808 |
| brand-hover / pressed | #8fab7c / #718d5f | same |
| on-brand | #151517 | #030303 |
| focus | brand | brand-dark |
| track-1..4 | #4a6fa5 #7e60a6 #9a6a3e #3b7c6f | same (placeholders) |

Re-read the live values from Penpot before finalizing; the user may have tweaked them.

**Typography**: Inter (UI) and Space Mono (timecodes, shortcuts, numbers). Styles: Heading 1–3,
Body, Body Bold, Small, Mono, Mono Small. Max weight 500 for normal UI text (bold styles excepted).
Timecodes are Mono/Mono Small, 12px in the player.

**Icons**: Lucide, 2px stroke, round caps, colored with the text tokens.

**Rules the user cares about**
- Depth via **1px outlines** (`color.selected` in dark, Light Selected in light), not shadows.
- Spacing is 8px-based; panel gaps 8, panel padding 16.
- Separators in UI text **must** be "•" (U+2022), never "·".
- Modal scrims: black at **≥50%** (designs use 75%).
- Primary button = brand fill (e.g. Export, Save). Secondary = card fill. Ghost = no fill.
- Centered tool groups (undo/redo, player controls, timeline cut/magnet) are truly centered using
  equal-width side groups.
- Colors must not be "AI-ified": stick to the palette.
- Frame rate in the sample project is **60 fps** (timecodes `HH:MM:SS:FF`, FF 00–59).

## 3. Mockup workarounds — build the *intended* version

Penpot MCP forced some compromises. Build these properly in code:
- **Buttons** need a leading-icon slot ("+ New preset" is fake text in the mockup).
- **Inputs** accept any trailing icon (e.g. folder on "Save to") plus long-path ellipsis.
- **Text overflow**: use CSS ellipsis (middle-ellipsis for file paths); mockups truncated by hand.
- **Progress button** ("Transcribing… 4%") should be a real Button progress variant.
- **Caption previews / "Aa" chips** must render real YouTube caption fonts and edge styles
  (none, drop shadow, raised, depressed, outline), not Roboto + Penpot shadows.
- **Auto-transcribe Done** should also show the new "Transcript" track appearing in a scrollable
  timeline.
- **Focus rings** use `color.focus` (outline/box-shadow); mockups hardcode strokes.
- **Radio** needs a real component; Checkbox/Toggle labels are part of the clickable control.
- **Menus** need a composable Menu/MenuItem (icon, label, value, shortcut keys, submenu chevron,
  check, danger, header, separator); the library Context Menu has fixed items.

## 4. Product decisions captured during design

- Cue list is on the **left**; Inspector on the right; timeline at the bottom.
- Tabs in the left panel: **Cues**, **Transcript** (document view with karaoke current-word
  highlight in brand green bold, low-confidence words underlined in warning yellow, "•" cue breaks),
  **Problems** (errors/warnings with one-click fixes, synced selection).
- Auto-transcribe runs **locally**; default output is a **new track**, never overwriting.
- Export: SRV3 default; SRT/SBV drop styling (info notice), VTT keeps basic styling; warnings
  link to the Problems tab but don't block export; multiple tracks combine into one file.
- Track headers show a style sample chip ("Aa") + preset name; eye/lock/headphones = visibility,
  lock editing, solo audio.
- Shortcuts shown in designs (S split, M merge, F8 next problem, Ctrl K palette, etc.) are
  **placeholders**; confirm the keymap with the user.

## 5. Suggested build order

1. Tokens + theme (CSS vars), fonts, icon setup.
2. Core components (match Core Components page, all states).
3. Editor shell layout (toolbar, three panels, timeline) with static data.
4. Wire to the existing Phase 0 document model (undo/redo, SRV3/SRT/VTT/SBV import/export).
5. Start screen, Export, Style Presets, Command palette, Timeline menus/interactions,
   Auto-transcribe UI.
6. Light mode last (only Core Components have light versions so far).

Verify each screen against its board with `export_shape` side by side with the running app.
