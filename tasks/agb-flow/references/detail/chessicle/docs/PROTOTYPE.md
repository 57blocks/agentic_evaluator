# 原型参考（不进本仓库的构建图）

Figma Make 导出的可交互原型**不复制进这个仓库**。它在：

    /Users/liuxing/workspace/57b/agb-test-repo/docs/AI Chess Analysis Tool/

Figma 设计稿：`https://www.figma.com/design/0IyzUw8wZAadl9rSQPM19l/AI-Chess-Analysis-Tool`

## 为什么不放进来

放进来试过一次，代价立刻可见：它自带 `package.json`（`vite build`）与一整套
shadcn 组件，于是

- `build` 门禁把它当成本仓库的一个 workspace，跑 `npm run build` 失败 → **hard，阻断提交**；
- `unsanitised-html` 在它的 `components/ui/chart.tsx` 上报 partial —— 那是 shadcn
  的上游代码，不是这个项目写的。

两条都是**关于一份参考资料**的判定，而门禁的判定对象应该是这个项目的产物。

## 它的技术形态（`Q-029` 要裁的就是这个）

React 18 + TypeScript + Vite 6 + Tailwind v4 + Radix/shadcn + recharts + lucide。
`src/app/App.tsx` 单文件约 2000 行，含六个视图（dashboard / analyze / prep /
study / profile / help）与分析流的四个步骤（upload / processing / ocr / analysis），
以及九档着法分类的配色表（`CLS_COLOR` / `CLS_BG` / `CLS_LABEL` / `CLS_SYM`）。

`Q-029` 未答之前，**不要**把它当成 v1 UI 的准绳去抽设计 token 或组件骨架。
答案是「是准绳」时，它的 `src/styles/theme.css` 与那四张分类表是
`.ab/design-tokens.json` 与 `UI_CONTRACT.md` 的直接来源。
