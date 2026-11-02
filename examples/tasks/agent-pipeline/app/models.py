"""Scripted stand-ins for chat models, so the sample runs free and offline.

`init_chat_model(name)` plays the part of LangChain's function of the same
name: the app asks for a model by name and gets something it can `invoke`.
A reply is a message with `content`, `tool_calls` and `usage`, as a real
chat model's would be. What differs is that each fake model's behaviour is
written down, so the evaluation has something definite to find:

  fake/large  searches every part of the question, one query per turn, and
              summarizes faithfully. Reliable, and the priciest.
  fake/mid    searches every part at once (parallel tool calls), but its
              summaries add a claim no source supports.
  fake/small  searches only the first part of the question, and summarizes
              faithfully. The cheapest.

Swap `init_chat_model` for the real one and the agents run unchanged.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from .search import sentences, terms

# A real call also sends the system prompt and the tool schemas; this is what
# they would cost in tokens, so the fakes' token counts are realistic in size.
OVERHEAD_TOKENS = 1200


@dataclass(frozen=True)
class Behaviour:
    searches_every_part: bool
    parallel_tool_calls: bool
    invents_a_claim: bool


BEHAVIOURS = {
    "fake/large": Behaviour(searches_every_part=True, parallel_tool_calls=False, invents_a_claim=False),
    "fake/mid": Behaviour(searches_every_part=True, parallel_tool_calls=True, invents_a_claim=True),
    "fake/small": Behaviour(searches_every_part=False, parallel_tool_calls=False, invents_a_claim=False),
}


def init_chat_model(name: str) -> "FakeChatModel":
    if name not in BEHAVIOURS:
        raise ValueError(f"unknown model {name!r}; this sample knows {', '.join(BEHAVIOURS)}")
    return FakeChatModel(name, BEHAVIOURS[name])


def tokens(text: str) -> int:
    return len(text) // 4


def parts_of(question: str) -> list[str]:
    """'When did X open, and can I Y?' -> ['When did X open', 'can I Y']"""
    return [p.strip(" ?") for p in re.split(r",\s*and\s+", question) if p.strip(" ?")]


def best_sentence(text: str, query: str) -> str:
    wanted = set(terms(query))
    return max(sentences(text), key=lambda s: len(wanted & set(terms(s))))


class FakeChatModel:
    def __init__(self, name: str, behaviour: Behaviour):
        self.name = name
        self.behaviour = behaviour

    def invoke(self, messages: list[dict], tools: list[str] | None = None) -> dict:
        if tools and "search" in tools:
            content, calls = self._search_turn(messages)
        else:
            content, calls = self._summary(messages), []
        prompt = OVERHEAD_TOKENS + sum(tokens(m["content"]) for m in messages)
        completion = tokens(content) + 20 * len(calls)
        return {
            "role": "assistant",
            "content": content,
            "tool_calls": calls,
            "model": self.name,
            "usage": {"input_tokens": prompt, "output_tokens": completion},
        }

    def _search_turn(self, messages: list[dict]) -> tuple[str, list[dict]]:
        question = next(m["content"] for m in messages if m["role"] == "user")
        parts = parts_of(question)
        plan = parts if self.behaviour.searches_every_part else parts[:1]
        asked = [c for m in messages if m["role"] == "assistant" for c in m.get("tool_calls", [])]
        todo = plan[len(asked):]
        if todo:
            batch = todo if self.behaviour.parallel_tool_calls else todo[:1]
            calls = [{"id": f"call_{len(asked) + i + 1}", "name": "search", "args": {"query": q}} for i, q in enumerate(batch)]
            return "", calls

        # Every planned query has its results: keep each query's top page and
        # quote the sentence that answers it.
        query_of = {c["id"]: c["args"]["query"] for c in asked}
        sources: dict[str, dict] = {}
        for m in messages:
            if m["role"] != "tool":
                continue
            hits = json.loads(m["content"])
            if not hits:
                continue
            top, query = hits[0], query_of[m["tool_call_id"]]
            quote = best_sentence(top["text"], query)
            entry = sources.setdefault(top["id"], {"id": top["id"], "url": top["url"], "title": top["title"], "excerpts": []})
            if quote not in entry["excerpts"]:
                entry["excerpts"].append(quote)
        return json.dumps({"sources": list(sources.values())}, indent=2), []

    def _summary(self, messages: list[dict]) -> str:
        findings = json.loads(messages[-1]["content"].split("FINDINGS:\n", 1)[1])
        sources = findings["sources"]
        lines = ["## Answer", ""]
        for s in sources:
            lines += [f"- {quote} [{s['id']}]" for quote in s["excerpts"]]
        if self.behaviour.invents_a_claim and sources:
            lines.append(f"- Every route runs all night on weekends. [{sources[0]['id']}]")
        lines += ["", "## Sources", ""]
        lines += [f"- [{s['id']}] {s['title']}: {s['url']}" for s in sources]
        return "\n".join(lines) + "\n"
