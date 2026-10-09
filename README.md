# ByteCaptions

Free, open-source desktop subtitle editor for YouTube. Transcribe locally, adjust captions on an NLE-style timeline, and export YouTube-native styled captions (SRV3/YTT) or plain SRT/VTT.

Status: early development. See [PLAN.md](PLAN.md).

## Develop

Requires Node, Rust (`rustup`), and Xcode command line tools on macOS.

```bash
npm install
npm run tauri dev
```

## YouTube upload

Release builds don't include YouTube upload: it needs a Google sign-in client, which Google
only approves after a lengthy review. You can add your own and build ByteCaptions yourself;
see [BUILDING.md](BUILDING.md).
