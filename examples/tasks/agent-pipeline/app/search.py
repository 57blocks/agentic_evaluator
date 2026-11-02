"""The search tool, over a fixed set of pages instead of the live web.

Live results change from one run to the next, so two candidates searching the
same question would not see the same pages. Evaluating on a fixed corpus (or a
replay of recorded results) keeps the difference between candidates down to
the model. Your app would put a record-and-replay layer here, in front of its
real search API.
"""

from __future__ import annotations

import re
from pathlib import Path

CORPUS = Path(__file__).parent / "corpus"
STOPWORDS = set(
    "a an and are at can do does how i in is it its my of on or the there to what when which with".split()
)


def stem(word: str) -> str:
    """Crude, but enough for this corpus: opened, opens -> open; capped -> cap; buses -> bus."""
    if len(word) <= 4:
        return word
    for suffix in ("ing", "ed"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            word = word[: -len(suffix)]
            return word[:-1] if word[-1] == word[-2] and word[-1] not in "ls" else word
    if re.search(r"(s|sh|ch|x)es$", word):
        return word[:-2]
    return word[:-1] if word.endswith("s") and not word.endswith("ss") else word


def terms(text: str) -> list[str]:
    """Lowercased words, stopwords dropped, stemmed."""
    return [stem(w) for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOPWORDS]


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def load_page(path: Path) -> dict:
    head, body = path.read_text().split("---\n", 1)
    meta = dict(line.split(": ", 1) for line in head.strip().splitlines())
    return {"id": path.stem, "url": meta["url"], "title": meta["title"], "text": body.strip()}


class CorpusSearch:
    """search(query) -> the top pages by how often they use the query's words."""

    def __init__(self, corpus: Path = CORPUS, k: int = 3):
        self.pages = [load_page(p) for p in sorted(corpus.glob("*.md"))]
        self.k = k

    def __call__(self, query: str) -> list[dict]:
        wanted = set(terms(query))
        scored = []
        for page in self.pages:
            words = terms(page["title"]) * 2 + terms(page["text"])
            score = sum(1 for w in words if w in wanted)
            if score > 0:
                scored.append((score, page))
        scored.sort(key=lambda s: -s[0])
        return [page for _, page in scored[: self.k]]
