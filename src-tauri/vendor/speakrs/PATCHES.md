# ByteCaptions changes to speakrs 0.5.0

Upstream: https://github.com/avencera/speakrs (Apache-2.0, see LICENSE). Changed code is marked
with `ByteCaptions patch` comments.

- **No Intel MKL.** `src/linalg.rs` is rewritten with nalgebra (pure Rust) instead of
  ndarray-linalg, whose default x86-64 backend statically links the proprietary Intel MKL.
  `src/clustering/plda.rs` calls it. Output on a 14-minute test video is identical to the MKL build.
- **Trimmed manifest.** The `online` (Hugging Face download) feature and the BLAS backend
  features are gone; ByteCaptions downloads and checks the models itself.
- **DirectML.** New `directml` feature: in `ExecutionMode::Cpu` the embedding model runs on the
  GPU through DirectML on Windows, falling back to the CPU (`src/inference.rs`). Set
  `SPEAKRS_NO_DML` to turn it off.
- **All cores.** The embedding session uses every core in `ExecutionMode::Cpu`
  (`src/inference/embedding/session.rs`), and segmentation runs on every CPU core rather than
  DirectML, which was slower for its LSTM (`src/inference/segmentation.rs`; `SPEAKRS_SEG_DML`
  opts in).
- **Speaker count.** `PipelineConfig::num_speakers` forces an exact number of speakers after VBx
  clustering: extra speakers merge, quietest first, into their most similar speaker; missing
  ones are split off with k-means (`src/pipeline/config.rs`, `src/pipeline/clustering.rs`).
