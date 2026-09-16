# Model Eval — codegen-w38

- **Step:** codegen
- **Judge:** google/gemini-3.1-pro-preview
- **Inputs:** code-utils, code-component, code-schema
- **Generated:** 2026-09-16T05:50:19.377Z

🏆 **Champion:** kimi-k3 — preferred in 4 of 6 duels (record 4–1–1 W–L–T) · score 4.7/5

> **怎么读 —— 两个透镜:** **战绩(胜–负–平)** 是*成对偏好排名*(若干场捉对的胜负平,单一裁判、正反消偏)——可靠地表达*方向*,但分辨率粗,所以 `0` 意味「每场都输」,而非「输出差」。**绝对分(1–5)** 是对每份输出单独打的分——看它才能判断差距的*大小*(强的亚军即使 0 胜也紧贴冠军)。

### Overall ranking

| # | Model | Record (W–L–T) | Duels | Score (1–5) | tsc pass | Avg cost | Avg latency | OK rate |
|---|-------|:--------------:|------:|----------:|---------:|---------:|------------:|--------:|
| 1 | kimi-k3 | 4–1–1 | 6 | 4.7 | 100% | $0.0425 | 39.0s | 100% |
| 2 | sonnet-5 | 2–2–2 | 6 | 5.0 | 100% | $0.0075 | 5.8s | 100% |
| 3 | deepseek-v4-pro | 0–3–3 | 6 | 4.9 | 89% | $0.0029 | 22.8s | 100% |

### Dimension scores (1–5, absolute)

| Model | Meets spec | Correctness | Type quality | Simplicity | Robustness |
|-------|------:|------:|------:|------:|------:|
| kimi-k3 | 4.9 | 4.7 | 5.0 | 5.0 | 4.7 |
| sonnet-5 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| deepseek-v4-pro | 4.9 | 4.8 | 5.0 | 5.0 | 4.8 |

### Dimension preference (win rate over duels, relative)

| Model | Meets spec | Correctness | Type quality | Simplicity | Robustness |
|-------|------:|------:|------:|------:|------:|
| kimi-k3 | 50 | 50 | 67 | 100 | 58 |
| sonnet-5 | 58 | 67 | 42 | 0 | 58 |
| deepseek-v4-pro | 42 | 33 | 42 | 50 | 33 |

### Overall reasoning (sample)

- **code-utils · sonnet-5 vs deepseek-v4-pro** → sonnet-5: Output A is the better implementation because it avoids a significant bug where built-in prototype properties (like 'toString') would be treated as existing que
- **code-utils · sonnet-5 vs kimi-k3** → sonnet-5: Output A is significantly more robust and correct because it safely handles object prototype properties, avoiding a major bug present in Output B.
- **code-utils · deepseek-v4-pro vs kimi-k3** → tie: Output A is the winner due to its more accurate fallback behavior when decoding malformed URI components, ensuring that valid '+' characters are still converted
- **code-component · sonnet-5 vs deepseek-v4-pro** → tie: Output A is the better submission due to its use of semantic HTML for accessibility, centralized and robust validation logic, and avoidance of unnecessary event
- **code-component · sonnet-5 vs kimi-k3** → kimi-k3: Output B delivers the same functionality and safety as Output A but with significantly cleaner, more idiomatic, and easier-to-read React code.
- **code-component · deepseek-v4-pro vs kimi-k3** → kimi-k3: Output B provides a cleaner, more focused implementation by consolidating the navigation logic into a single function and avoiding unnecessary event handler boi
- **code-schema · sonnet-5 vs deepseek-v4-pro** → tie: Output A is the better submission because its password validation is more robust, avoids regex edge-case bugs with newline characters, and provides better error
- **code-schema · sonnet-5 vs kimi-k3** → kimi-k3: Output B is more idiomatic in its use of Zod, exports all necessary types, and handles error paths more robustly.
