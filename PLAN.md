# ByteCaptions — Product & Build Plan

Free and open source under **GPL-3.0-or-later**. Cloud services are optional, bring-your-own-key integrations only.

A desktop subtitle editor for YouTube creators. Auto-transcribe locally, adjust on an NLE-style timeline (Premiere/Resolve feel), style captions visually, export YouTube-native styled captions (SRV3/YTT) with plain SRT/VTT fallback.

> This file is the source of truth for implementation. Update it when decisions change. Sections marked **[DESIGN]** are waiting on Figma designs; build them functional-first with neutral styling, then skin once designs land.

---

## 1. Goals / Non-goals

**Goals**
- Fastest path from "raw video" → "polished, styled YouTube captions".
- Timeline that feels instantly familiar to Premiere / DaVinci Resolve users.
- WYSIWYG styling that matches what YouTube will actually render.
- Honest compatibility: tell users what won't render on mobile/TV or after auto-translate.
- Fully local by default (privacy, offline, no per-minute cost).

**Non-goals (v1)**
- Burned-in captions / video rendering or encoding.
- Editing the video itself (cuts, effects).
- Real-time collaboration.
- Formats beyond YouTube's needs (no broadcast formats like SCC/STL).
- Web/browser version (architecture keeps it possible later).

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Shell | **Tauri 2** | Small binary, native file access, Rust sidecars. macOS first, Windows second, Linux best-effort. |
| UI | **Angular 22 (standalone components, zoneless)** + TypeScript | Zoneless so the canvas timeline/rAF loops never trigger change detection. |
| State | **Angular signals** in root services (`ProjectStore`) + **Immer** for immutable updates | Command-based mutations for undo/redo (see §5.3). |
| Timeline rendering | **Canvas 2D** (single canvas, custom renderer) | DOM per-block won't scale to thousands of cues + smooth zoom. Hit-testing done manually. |
| Video playback | HTML `<video>` + `requestVideoFrameCallback` | Frame-accurate timecode readout. WebCodecs only if frame-step accuracy proves insufficient. |
| Caption preview | Custom renderer overlaying the video (DOM/CSS absolutely positioned) | Mimics YouTube player rendering. |
| Audio / waveform | **ffmpeg** sidecar → PCM → peak generation in Rust | Cache peaks to disk per media file hash. |
| Transcription | **whisper.cpp** sidecar (Metal on macOS, CUDA/Vulkan on Windows) | Word-level timestamps. Models downloaded on demand. |
| Persistence | Project file `.bcproj` (JSON, versioned schema) | Autosave + crash recovery. |
| Styling (app UI) | CSS Modules or Tailwind — **decide after Figma** | Design tokens as CSS variables either way. |
| Tests | Angular CLI's default unit runner (Vitest), Playwright (e2e via Tauri driver), Rust `cargo test` | Golden-file tests for every exporter. |

---

## 3. Core concepts & data model

```ts
type Ms = number; // all times are integer milliseconds

interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  media: MediaRef | null;
  fps: number;                    // detected from media, used for frame snapping / timecode
  tracks: Track[];                // ordered top→bottom in UI
  styles: Record<StyleId, CaptionStyle>;
  positions: Record<PosId, Position>;
  settings: ProjectSettings;      // line-length limits, min gap, etc.
  transcript?: TranscriptMeta;    // model used, language, date
}

interface MediaRef { path: string; hash: string; durationMs: Ms; width: number; height: number; }

interface Track {
  id: TrackId;
  name: string;                   // e.g. "Dialogue", "Speaker A", "Lyrics", "SFX"
  color: string;                  // UI color of blocks
  defaultStyleId: StyleId;
  defaultPositionId: PosId;
  muted: boolean;                 // excluded from preview + export ("eye" toggle)
  locked: boolean;
  solo: boolean;
  cues: Cue[];                    // kept sorted by start
}

interface Cue {
  id: CueId;
  start: Ms;
  end: Ms;
  runs: TextRun[];                // rich text, supports per-run styling
  styleId?: StyleId;              // override track default
  positionId?: PosId;             // override track default
  words?: WordTiming[];           // from ASR; enables karaoke + smart split
  karaoke?: boolean;
  flags?: CueFlag[];              // computed lint warnings (not persisted)
}

interface TextRun {
  text: string;                   // may include "\n"
  styleOverride?: Partial<CaptionStyle>;
  ruby?: string;                  // furigana/ruby annotation
}

interface WordTiming { text: string; start: Ms; end: Ms; confidence?: number; }

interface CaptionStyle {        // maps ~1:1 onto SRV3 <pen>
  name: string;
  font: YtFont;                   // YouTube's fixed font list, NOT arbitrary fonts
  sizePct: number;                // relative size (SRV3 sz)
  bold: boolean; italic: boolean; underline: boolean;
  textColor: string; textOpacity: number;        // 0–1
  bgColor: string; bgOpacity: number;
  edge: 'none' | 'hardShadow' | 'bevel' | 'glow' | 'softShadow';
  edgeColor: string;
  // Anything not representable in SRV3 must not exist in this type.
}

interface Position {            // maps onto SRV3 <wp> + <ws>
  name: string;
  anchor: 0|1|2|3|4|5|6|7|8;      // 3x3 grid, TL→BR
  x: number; y: number;           // 0–100 % of video frame
  align: 'left' | 'center' | 'right';
  vertical?: boolean;             // vertical text
}
```

**Rules**
- The internal model is deliberately limited to what YouTube can render. If a feature can't export to SRV3, it doesn't go in the model.
- Overlapping cues are allowed across tracks and within a track (flagged as a warning within a track).
- Export flattens all non-muted tracks into one caption file.

---

## 4. Output formats

### 4.1 SRV3 / YTT (primary)
- XML: `<timedtext format="3">` with `<head>` (`<pen>`, `<wp>`, `<ws>` definitions) and `<body>` (`<p t= d= wp= ws= p=>` containing `<s p=>` spans).
- No official spec. Reference implementations to study before writing the exporter:
  - YTSubConverter source (arcusmaximus/YTSubConverter): the de facto reference, incl. workarounds for YouTube rendering quirks.
  - yttml (FyraLabs/yttml): documents the format.
- Karaoke is implemented as a sequence of `<p>` elements with progressively re-styled spans (the way YTSubConverter does it); verify output size.
- **Deduplicate pens/positions** in `<head>`; keep file size down.
- **Complexity budget**: YouTube disabled SRV3 in Jan 2026 because heavy files lagged/crashed the player (later restored). Compute an estimated "weight" (element count, karaoke expansions, file size) and show a warning meter. Hard warning over a threshold to be tuned by testing.

### 4.2 Fallbacks
- **SRT**: plain text, `<b>/<i>/<u>` stripped or kept (option).
- **WebVTT**: basic tags + line/position cue settings where possible.
- **SBV**: YouTube's legacy format (cheap to add).
- Export dialog shows a **"what you lose"** diff when exporting to a less capable format.

### 4.3 Import
- SRT, VTT, SBV, SRV3/YTT (round-trip), ASS/SSA (map what's representable, report the rest).
- YouTube auto-captions via API (§6.6).

### 4.4 Golden tests
Each exporter has fixture projects → expected output files. Every SRV3 fixture is also manually uploaded to an unlisted test video once, and the result is screenshotted (desktop web, iOS app, Android app) and recorded in `docs/compat/`.

---

## 5. Features

Priority: **P0** = MVP, **P1** = v1.0, **P2** = later.

### 5.1 Project & media
- P0 New / open / save project; recent projects list. **[DESIGN: welcome screen]**
- P0 Import video by drag & drop (MP4/MOV/WebM, anything ffmpeg can extract audio from; playback needs a browser-playable codec).
- P1 Auto-generate a playback proxy (H.264) via ffmpeg for unplayable codecs (ProRes, MKV, etc.), with progress.
- P0 Autosave every N seconds + on blur; crash recovery on launch.
- P1 Relink missing media (path moved).

### 5.2 Auto-transcription
- P0 "Transcribe" action: pick model + language (auto-detect default) → progress bar with ETA → cues appear on a new track.
- P0 Model manager: download/delete whisper models, show size + expected speed. First-run downloads a recommended default.
- P0 Word-level timestamps stored on each cue.
- P0 Auto-segmentation into cues using project settings: max chars/line, max lines (2), max duration, min duration, split on punctuation + pauses > X ms.
- P1 Transcribe a selected range only (re-do a bad section).
- P1 Low-confidence words highlighted (underline) for review.
- P1 Forced alignment pass to tighten timings (WhisperX-style) — evaluate; may be a separate model.
- P2 Speaker diarization → one track per speaker.
- P1 Pluggable ASR provider interface (local whisper = built-in default).
- P2 Cloud ASR providers (Deepgram, AssemblyAI, OpenAI, …) — user supplies own API key, stored in OS keychain. Never on by default, never proxied through any ByteCaptions server (there is none).
- P2 Custom vocabulary / prompt (names, jargon).

### 5.3 Editing core
- P0 **Undo/redo** for everything (command pattern; each command has `do`/`undo`, grouped for drags).
- P0 Select, multi-select (shift/cmd click, marquee on timeline).
- P0 Edit cue text inline (in list and on preview).
- P0 Split cue at playhead (words redistributed by timing if available, else by character ratio).
- P0 Merge adjacent cues.
- P0 Delete, ripple delete (P1).
- P0 Copy / cut / paste (paste at playhead).
- P0 Find & replace (P1: regex, scope to track/selection).
- P1 Spellcheck (OS spellchecker).
- P1 Shift times: selected / all after playhead, by offset.
- P1 Global timing sync: "set this cue's start to playhead and shift everything".
- P2 Translate track (duplicate track → machine translate via BYO-key provider, keep timings).

### 5.4 Timeline (the heart) **[DESIGN: timeline]**
Must feel like Premiere/Resolve. Behaviors:
- P0 Horizontal time ruler with timecode (HH:MM:SS:FF and ms toggle).
- P0 Playhead: click ruler to seek, drag to scrub (with audio scrub P1).
- P0 Multiple tracks stacked vertically; track header with name, color, eye (mute), lock, solo.
- P0 Add / remove / rename / reorder tracks.
- P0 Cues as blocks showing their text (truncated).
- P0 Drag block to move (within and across tracks); drag edges to trim.
- P0 Snapping (toggle `S`): to playhead, other cue edges, word boundaries, silence edges, frames.
- P0 Waveform lane under/behind tracks, cached peaks.
- P0 Zoom: `+`/`-`, ctrl/cmd+scroll, zoom slider, "zoom to fit" (`\`). Zoom centered on cursor.
- P0 Horizontal scroll: scroll wheel/trackpad; shift+scroll.
- P0 Keep-playhead-in-view (page scroll) during playback.
- P1 Create cue by dragging on empty track area.
- P1 Ripple / roll edit (trim with neighbor adjust) with modifier keys.
- P1 Word markers inside a block (ticks); drag a tick to retime a word.
- P1 Markers (`M`) with notes.
- P1 In/out range (`I`/`O`) for loop playback and range operations.
- P1 Track height resize.
- P2 Minimap / overview bar.

Performance target: 60fps scroll/zoom with 5,000 cues on a 2-hour video.

### 5.5 Playback & preview **[DESIGN: preview panel]**
- P0 Video player with caption overlay rendered the way YouTube renders SRV3.
- P0 Transport: play/pause, J/K/L shuttle (repeat L = faster), frame step (←/→), jump to prev/next cue (↑/↓).
- P0 Playback rate 0.5×–2×.
- P1 Preview mode toggle: **Desktop web / Mobile app / TV / Plain (fallback)**, simulating how each renders (mobile drops some styling → show degraded version).
- P1 Click caption in preview to select cue; drag caption in preview to reposition (creates/edits a Position).
- P1 Safe-area guides overlay.
- P1 Loop selected cue(s) while editing.

### 5.6 Cue list / text panel **[DESIGN: side panel]**
- P0 Scrollable list of cues (index, start, end, duration, text, track color).
- P0 Selection synced with timeline and preview; auto-scroll to playing cue.
- P0 Edit timecodes numerically.
- P1 Reading-speed indicator (chars/sec) per cue with color coding.
- P1 Filter by track / warnings.
- P1 "Transcript mode": edit the whole track as one flowing document, cue boundaries shown inline (Descript-like).

### 5.7 Styling **[DESIGN: inspector]**
- P0 Inspector panel for the selection: text style (font from YouTube's list, size, B/I/U, colors + opacity, background, edge type/color) and position.
- P0 Named style presets (project-level) — apply to cue/track; edit preset updates all users of it.
- P0 Position presets: 3×3 anchor picker + x/y fine-tune.
- P1 Per-run (partial text) styling: select words in the text editor → style them.
- P1 Karaoke toggle per cue: choose highlight style; uses word timings.
- P1 Ruby text.
- P1 Vertical text.
- P1 Global preset library (shared across projects).
- P2 Simple animated effects that SRV3 can express (fade in, typewriter), each showing a weight cost.

### 5.8 Quality checks (linting)
Live, non-blocking warnings shown as badges on blocks + in a Problems panel:
- P0 Overlap within same track.
- P0 Too fast reading speed (CPS over threshold).
- P0 Too short/long duration; too many chars per line; too many lines.
- P1 Gap too small between cues (flicker).
- P1 Styling that won't render on mobile / is dropped by auto-translate.
- P1 SRV3 weight budget exceeded.
- P1 "Fix" quick actions (e.g. extend to min duration, split long cue).

### 5.9 Export & YouTube integration **[DESIGN: export dialog]**
- P0 Export dialog: format, tracks to include, output path, "what you lose" summary, weight meter.
- P1 Sign in with Google (OAuth, user's own channel) via YouTube Data API:
  - pick a video from your channel,
  - import YouTube's auto-captions as a starting track,
  - upload captions directly (as a draft or published track, language selectable).
- P2 Multi-language: one track group per language, export/upload each.

### 5.10 App-level
- P0 Keyboard-first: every action has a shortcut; shortcuts customizable (P1). Presets: "Premiere" and "Resolve" keymaps (P1).
- P0 Command palette (`cmd+K`).
- P0 Light/dark theme (dark default, like NLEs). **[DESIGN]**
- P1 Resizable/collapsible panels, layout persisted.
- P1 Onboarding: sample project + shortcut cheat sheet overlay (`?`).
- P1 Auto-update (Tauri updater).
- P2 Localization of the app UI.

---

## 6. Default keyboard shortcuts (P0 unless noted)

| Action | Key |
|---|---|
| Play / pause | `Space` / `K` |
| Shuttle back / forward | `J` / `L` (repeat = faster) |
| Frame step | `←` / `→` (shift = 1s) |
| Prev / next cue | `↑` / `↓` |
| Split at playhead | `cmd+B` (Resolve "blade") |
| Toggle snapping | `N` |
| Set cue start / end to playhead | `Q` / `W` (Premiere trim-to-playhead style) |
| New cue at playhead | `Enter` (when timeline focused) |
| Merge | `cmd+J` |
| Delete / ripple delete | `Delete` / `shift+Delete` |
| Zoom in / out / fit | `=` / `-` / `\` |
| In / out | `I` / `O` |
| Marker | `M` |
| Undo / redo | `cmd+Z` / `cmd+shift+Z` |
| Command palette | `cmd+K` (reserved; never rebind by default) |
| Transcribe | `cmd+T` |
| Export | `cmd+E` |



---

## 7. Architecture

```
src/app/                 # Angular app
  app/                   # shell, layout, panels, routing
  features/
    timeline/            # canvas renderer, hit-testing, interactions, snapping
    player/              # video element wrapper, transport, caption overlay renderer
    cuelist/
    inspector/
    transcribe/          # UI for ASR jobs + model manager
    export/
    lint/
  core/                  # PURE TS, no Angular, no Tauri — fully unit-tested
    model/               # types, schema, migrations
    commands/            # undo/redo command implementations
    segment/             # words → cues segmentation
    formats/             # srv3, srt, vtt, sbv, ass importers/exporters
    lint/                # rules
    time/                # timecode parsing/formatting, frame math
  platform/              # thin adapter over Tauri APIs (fs, dialogs, sidecars) → mockable
src-tauri/
  src/
    media.rs             # ffmpeg: probe, extract audio, proxy transcode
    peaks.rs             # waveform peak generation + cache
    asr.rs               # whisper.cpp job runner, progress events, cancellation
    models.rs            # model download/verify/delete
  sidecars/              # ffmpeg, whisper binaries per platform
```

Principles:
- `core/` has zero dependencies on UI or platform → future web version reuses it.
- Long jobs (transcribe, peaks, proxy) run in Rust, report progress via Tauri events, and are cancellable.
- Timeline renderer reads state from signals via `effect()` and redraws on rAF — never through template bindings per cue.

---

## 8. Build phases

**Phase 0 — Foundations (no design needed)** — core done: model, undo/redo, SRV3/SRT/VTT/SBV import+export, .bcproj save/load. Remaining: Tauri file I/O adapter.
Tauri + Angular scaffold (done), `core/model`, command/undo system, SRT/VTT/SRV3 import+export with golden tests, project save/load.

**Phase 1 — MVP (P0)**
Media import + playback, waveform, timeline (tracks, move/trim/snap/zoom), cue list, inspector with presets, preview overlay, whisper transcription + segmentation, lint basics, export dialog. Neutral styling until Figma arrives.

**Phase 2 — v1.0 (P1)**
Karaoke, per-run styling, preview-mode simulation, transcript mode, YouTube sign-in/import/upload, proxy transcode, keymap presets, polish per Figma.

**Phase 3 — Later (P2)**
Diarization, cloud ASR, translation, effects, minimap, web build.

**Exit criteria for MVP:** take a 20-minute talking-head video → transcribe → fix errors and timing → apply 2 styles across 2 tracks → export SRV3 → upload to YouTube → renders as previewed on desktop web. Under 15 minutes of user effort.

---

## 9. Design handoff (Figma) **[DESIGN]**

Screens/components to design, in priority order:
1. **Main editor layout** — preview (top-left), inspector (top-right), cue list (left or right), timeline (bottom). Panel resizing behavior.
2. **Timeline** — ruler, playhead, track headers (name/color/eye/lock/solo), cue blocks (normal / selected / warning / locked / muted), waveform, word ticks, snapping indicator, zoom controls.
3. **Inspector** — style controls, preset picker, 3×3 anchor picker, karaoke controls.
4. **Cue list row** states.
5. **Transcribe dialog** + progress + model manager.
6. **Export dialog** incl. "what you lose" + weight meter.
7. **Welcome / recent projects**, empty states (no media, no cues).
8. **Problems panel**, toasts, command palette.
9. Light theme variant.

When sending designs, include (if possible): design tokens (colors, type scale, spacing, radii), component states, and dark/light variants. I'll map tokens to CSS variables in `src/app/theme/`.

---

## 10. Open questions / to verify
- [ ] Exact SRV3 attribute set and quirks — verify against YTSubConverter source before writing the exporter.
- [ ] YouTube's current mobile/TV rendering of SRV3 — test upload matrix (§4.4).
- [ ] Safe SRV3 weight threshold after the Jan 2026 incident.
- [x] Shortcuts: `cmd+K` = command palette, `cmd+B` = split.
- [ ] whisper.cpp model default (speed vs accuracy) per platform; bundle vs download ffmpeg (licensing: use LGPL build).
- [x] App name: ByteCaptions.
- [x] Free & open source. Cloud features = optional plugins/providers with user's own keys (Settings → Integrations). **[DESIGN: integrations settings page]**
- [x] License: GPL-3.0-or-later (forks must stay open source). ffmpeg: LGPL or GPL build both compatible.
