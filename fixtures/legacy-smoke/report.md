# Model Eval — smoke-codegen

- **Step:** codegen
- **Judge:** google/gemini-3.1-pro-preview
- **Inputs:** code-utils
- **Generated:** 2026-09-16T03:14:03.668Z

🏆 **Champion:** anthropic/claude-sonnet-5 — preferred in 1 of 1 duels (record 1–0–0 W–L–T) · score 5.0/5

> **怎么读 —— 两个透镜:** **战绩(胜–负–平)** 是*成对偏好排名*(若干场捉对的胜负平,单一裁判、正反消偏)——可靠地表达*方向*,但分辨率粗,所以 `0` 意味「每场都输」,而非「输出差」。**绝对分(1–5)** 是对每份输出单独打的分——看它才能判断差距的*大小*(强的亚军即使 0 胜也紧贴冠军)。

### Overall ranking

| # | Model | Record (W–L–T) | Duels | Score (1–5) | tsc pass | Avg cost | Avg latency | OK rate |
|---|-------|:--------------:|------:|----------:|---------:|---------:|------------:|--------:|
| 1 | anthropic/claude-sonnet-5 | 1–0–0 | 1 | 5.0 | 100% | $0.0069 | 5.2s | 100% |
| 2 | deepseek/deepseek-v4-pro | 0–1–0 | 1 | 5.0 | 100% | $0.0018 | 4.3s | 100% |

### Dimension scores (1–5, absolute)

| Model | Meets spec | Correctness | Type quality | Simplicity | Robustness |
|-------|------:|------:|------:|------:|------:|
| anthropic/claude-sonnet-5 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| deepseek/deepseek-v4-pro | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |

### Dimension preference (win rate over duels, relative)

| Model | Meets spec | Correctness | Type quality | Simplicity | Robustness |
|-------|------:|------:|------:|------:|------:|
| anthropic/claude-sonnet-5 | 50 | 100 | 50 | 50 | 100 |
| deepseek/deepseek-v4-pro | 50 | 0 | 50 | 50 | 0 |

### Overall reasoning (sample)

- **code-utils · anthropic/claude-sonnet-5 vs deepseek/deepseek-v4-pro** → anthropic/claude-sonnet-5: Output A is the clear winner due to its safer handling of object properties via hasOwnProperty, preventing bugs with keys that match Object.prototype methods.
