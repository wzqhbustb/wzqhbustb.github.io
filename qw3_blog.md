# 18.6 tok/s on an M3 Max: Building a Qwen3 Inference Engine from Scratch in Metal

**Repository:** https://github.com/wzqhbustb/qw3

Until recently, if you wanted to run a 30B-parameter MoE model like Qwen3-30B-A3B (only 3B parameters active per token) on a Mac, your practical choices were basically: use llama.cpp, or use llama.cpp. It is a fantastic project, but it is also a general-purpose engine. We wanted to see how far a small, focused, from-scratch implementation could go when it is allowed to assume one model family, one quantization scheme, and one GPU architecture.

The result is **qw3** — a minimal, native Metal inference engine for Qwen3-30B-A3B on Apple Silicon. It is MIT-licensed, written in C and Objective-C, compiles with `make qwen3-cli`, and needs no Xcode.

This post explains what it is, why we built it, how it works, and what we learned along the way.

---

## What it is (and is not)

qw3 is deliberately narrow:

- It supports **one model**: Qwen3-30B-A3B, loaded from GGUF.
- It targets **one GPU family**: Apple Silicon (M1/M2/M3/M4 series, Metal 3).
- It uses hand-written Metal compute kernels for attention, RoPE, RMS norm, quantized matmul, and MoE.

It is **not** a generic llama.cpp replacement. If you need multi-model support, servers, tool calling, or speculative decoding, qw3 is not there yet. But if you are curious about what a purpose-built Metal graph looks like for a modern MoE transformer, this is a clean reference point.

### Who is this for?

- Developers curious about Metal GPU programming and how a modern LLM maps to compute kernels.
- People who want to understand the full MoE inference pipeline — from GGUF tensor layout to router top-k to expert gather/scatter — in one readable codebase.
- Apple Silicon users who want to run Qwen3 locally and find llama.cpp's codebase too large to hack on or customize.

---

## Why build another engine?

Two reasons:

1. **Education.** A from-scratch engine forces you to understand every byte: GGUF tensor layout, Q4_K/Q6_K/Q8_0 quantization, grouped-query attention, RoPE layout, MoE router top-k, and how all of that maps to Metal command buffers.
2. **Efficiency.** By hard-coding shapes and quantization types, we can skip a lot of the abstraction overhead that a general engine carries. We can mmap the GGUF directly into GPU-visible memory, batch experts inside chunk prefill, and overlap layer work on the GPU with almost no CPU dispatch cost.

The goal was never to beat llama.cpp on every metric. It was to build something small, correct, and fast enough to be useful — and to document how we got there.

---

## Technical highlights

### 1. mmap zero-copy weight loading

`token_embd.weight` and `output.weight` are aliased directly from the mmap'd GGUF through a zero-copy `MTLBuffer`. There is no eager 17 GB upload at startup and no second in-memory copy of the weights. On a warm OS file cache, model load is roughly 0.03–0.05 s.

### 2. Layer-sequential, overlapped decode schedule

Transformers are strictly sequential: layer `l+1` needs the FFN output of layer `l`. We spent a lot of time proving to ourselves that faster-looking schedules (for example, running all attention first and all FFN second in two big command buffers) violate that dependency and produce wrong logits.

The schedule we ship overlaps the FFN phase of layer `l` with the attention phase of layer `l+1` in the same command buffer. The "router" step — the small MoE expert selector that runs after attention — is included in the attention phase:

```
CB 0      : layer 0 attention + router top-k
CB 1..N-1 : layer l FFN + layer l+1 attention + router top-k
CB N      : layer N-1 FFN + output projection
```

This keeps the graph correct while still keeping command-buffer flushes low.

### 3. Chunked prompt prefill + gathered MoE

Prompts of 8 or more tokens use chunked prefill by default. Inside each chunk, attention projections use batched quantized SIMD matmul, and the MoE FFN uses a gathered expert path: tokens are grouped by selected expert, gathered into contiguous buffers, run through the existing batch matmul kernels, then scatter-accumulated with router weights.

On a 256-token prompt + 32-token decode, gathered MoE reduces wall time by roughly **20%** versus the per-token fallback, while producing byte-identical greedy output.

### 4. The RoPE layout bug that taught us a lesson

Early versions produced coherent first tokens but quickly fell into repetitive loops. After a long debugging session comparing hidden states against llama.cpp, we traced it to RoPE: we had implemented the adjacent-pair layout common in LLaMA models, but Qwen3 uses the GPT-NeoX half-layout `(i, i + head_dim/2)`. Fixing that in `metal/rope.metal` and `src/ds3_reference.c` made greedy output match the FP32 CPU reference end-to-end. It is a good reminder that "close enough" attention math is not close enough.

---

## Performance numbers

All numbers are from an Apple M3 Max with 48 GB RAM, `Qwen3-30B-A3B-Q4_K_M.gguf`, and a warm OS file cache. Full reproducible commands are in [`docs/BENCHMARK.md`](https://github.com/wzqhbustb/qw3/blob/main/docs/BENCHMARK.md).

| Scenario | Result |
|----------|--------|
| Short-prompt greedy decode (128 tokens) | **~18.6 tok/s** |
| Decode after 64-token prompt | **~19 tok/s** |
| Decode after 256-token prompt | **~16 tok/s** |
| Decode after 512-token prompt | **~14 tok/s** |
| Chunk prefill throughput | **~34–41 tok/s** for 61–511 token prompts |
| Model load (warm cache) | **~0.03–0.05 s** |

The 64-token prompt decode result is slightly higher than the short-prompt headline because the short-prompt figure averages over 128 generated tokens as the KV cache grows, while the 64-token-prompt measurement captures a narrower window.

A few caveats:

- The first run after process start is slower while macOS pages weights from the SSD into GPU memory.
- Decode speed falls with context length because the decode attention kernel reads the full KV cache each step.
- These are Q4_K_M numbers; Q6_K/Q8_0 move more bytes and will be slower.

---

## Try it in one minute

```bash
git clone https://github.com/wzqhbustb/qw3.git
cd qw3
make qwen3-cli

# Download the model (or place your own Qwen3-30B-A3B-Q4_K_M.gguf in ./models)
huggingface-cli download Qwen/Qwen3-30B-A3B-GGUF \
    Qwen3-30B-A3B-Q4_K_M.gguf \
    --local-dir ./models

./qwen3-cli -m models/Qwen3-30B-A3B-Q4_K_M.gguf \
            -p "What is the capital of France?" \
            -n 128 -t 0.7
```

To run the unit tests (no model required for the Metal kernel tests):

```bash
make test
./test_metal
./test_matmul_quant_metal
./test_attention_metal
./test_moe_metal
```

---

## Lessons from open-sourcing

We chose to squash the history to a single commit before release to keep the repository clean for new contributors. The trade-off is losing the day-by-day narrative of dead ends and fixes — the commit messages that explain why a line of code exists. Next time we might keep a curated history and only squash the truly messy phases.

Other takeaways:

- **Benchmark before you optimize.** Several "obvious" speedups (GPU-only MoE, cross-layer 2-CB decode) turned out to be slower or wrong. Profiling with `DS3_METAL_PROFILE=1` showed that command-buffer sync, not kernel FLOPs, was the real bottleneck.
- **Correctness before speed.** The RoPE bug and the incorrect 2-CB schedule both looked fine on the first token. You need multi-token reference comparisons to catch them.
- **Focused scope wins.** Hard-coding shapes and quant types let us delete huge amounts of indirection and make the code readable end-to-end.

---

## What is next

The open-source release is done. Next priorities are making the project easier to use and contribute to:

- CI on macOS with Metal (GitHub Actions)
- A scripted validation suite
- Better CLI errors and `--help`
- Multi-model support, starting with Qwen3-235B-A22B
- Longer contexts and KV-cache quantization

If any of that sounds interesting, we would love contributions, issues, or just feedback on the benchmarks.

---

## Get involved

- **Repo:** https://github.com/wzqhbustb/qw3
- **Benchmarks:** https://github.com/wzqhbustb/qw3/blob/main/docs/BENCHMARK.md
- **License:** MIT for the engine code; Qwen3 weights have their own model license.

If you have a Mac with Apple Silicon and a Qwen3 GGUF, give it a try and let us know what tok/s you see.
