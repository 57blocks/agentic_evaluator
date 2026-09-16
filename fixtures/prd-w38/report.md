# Model Eval — prd-w38

- **Step:** prd
- **Judge:** google/gemini-3.1-pro-preview
- **Inputs:** todo-app, chat-app
- **Generated:** 2026-09-16T05:57:03.777Z

🏆 **Champion:** kimi-k3 — preferred in 3 of 4 duels (record 3–0–1 W–L–T) · score 5.0/5

> **怎么读 —— 两个透镜:** **战绩(胜–负–平)** 是*成对偏好排名*(若干场捉对的胜负平,单一裁判、正反消偏)——可靠地表达*方向*,但分辨率粗,所以 `0` 意味「每场都输」,而非「输出差」。**绝对分(1–5)** 是对每份输出单独打的分——看它才能判断差距的*大小*(强的亚军即使 0 胜也紧贴冠军)。

### Overall ranking

| # | Model | Record (W–L–T) | Duels | Score (1–5) | Avg cost | Avg latency | OK rate |
|---|-------|:--------------:|------:|----------:|---------:|------------:|--------:|
| 1 | kimi-k3 | 3–0–1 | 4 | 5.0 | $0.0615 | 51.8s | 100% |
| 2 | deepseek-v4-pro | 0–1–3 | 4 | 5.0 | $0.0086 | 62.2s | 100% |
| 3 | sonnet-5 | 0–2–2 | 4 | 5.0 | $0.0236 | 24.1s | 100% |

### Dimension scores (1–5, absolute)

| Model | Completeness | Testability | No hallucination | Structure |
|-------|------:|------:|------:|------:|
| kimi-k3 | 5.0 | 5.0 | 5.0 | 5.0 |
| deepseek-v4-pro | 5.0 | 5.0 | 5.0 | 5.0 |
| sonnet-5 | 5.0 | 5.0 | 4.8 | 5.0 |

### Dimension preference (win rate over duels, relative)

| Model | Completeness | Testability | No hallucination | Structure |
|-------|------:|------:|------:|------:|
| kimi-k3 | 50 | 100 | 75 | 88 |
| deepseek-v4-pro | 50 | 0 | 38 | 0 |
| sonnet-5 | 50 | 50 | 38 | 63 |

### Overall reasoning (sample)

- **todo-app · sonnet-5 vs deepseek-v4-pro** → tie: Output A is the stronger PRD because it strictly follows the brief without adding unrequested feature sections, and its Given/When/Then acceptance criteria prov
- **todo-app · sonnet-5 vs kimi-k3** → kimi-k3: Output B is the superior PRD because it maintains strict discipline against scope creep, provides highly testable edge-case criteria, and uses a more robust ref
- **todo-app · deepseek-v4-pro vs kimi-k3** → kimi-k3: Output B is the superior PRD because its numbered acceptance criteria make it highly testable, and it maintains strict discipline regarding the scope of the bri
- **chat-app · sonnet-5 vs deepseek-v4-pro** → tie: Output A is the superior PRD because it maintains strict product focus without dictating technical architecture, and its numbered acceptance criteria make it hi
- **chat-app · sonnet-5 vs kimi-k3** → kimi-k3: Output B delivers a more robust and developer-ready PRD by addressing edge cases like full history pagination and explicitly documenting its product decisions t
- **chat-app · deepseek-v4-pro vs kimi-k3** → tie: Although Output B has slightly better structure and testability, Output A wins overall because it strictly follows the prompt's rule to avoid scope creep and un
