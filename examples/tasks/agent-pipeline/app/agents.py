"""The two agents. Each takes its model as an argument, so any model can run either one."""

from __future__ import annotations

import json
from typing import Callable, Protocol, Sequence

SEARCH_PROMPT = (
    "You are a research assistant for Port Avery Transit. Search the site for every part of "
    "the question. When you have what you need, answer with JSON only: "
    '{"sources": [{"id", "url", "title", "excerpts": [sentences quoted verbatim]}]}.'
)
SUMMARY_PROMPT = (
    "Answer the rider's question from the findings only. One bullet per fact, each ending "
    "with the id of the source it came from, like [s01]. Then list the sources."
)


class ChatModel(Protocol):
    name: str

    def invoke(self, messages: list[dict], tools: list[str] | None = None) -> dict: ...


class Callback(Protocol):
    """Told about every model reply, like a LangChain callback handler's on_llm_end."""

    def on_llm_end(self, reply: dict) -> None: ...


def search_agent(
    question: str,
    model: ChatModel,
    search: Callable[[str], list[dict]],
    callbacks: Sequence[Callback] = (),
    max_turns: int = 6,
) -> dict:
    """Search until the model stops calling the tool; return its findings."""
    messages = [{"role": "system", "content": SEARCH_PROMPT}, {"role": "user", "content": question}]
    for _ in range(max_turns):
        reply = model.invoke(messages, tools=["search"])
        for cb in callbacks:
            cb.on_llm_end(reply)
        messages.append(reply)
        if not reply["tool_calls"]:
            return json.loads(reply["content"])
        for call in reply["tool_calls"]:
            hits = search(call["args"]["query"])
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(hits)})
    raise RuntimeError(f"search agent still searching after {max_turns} turns")


def summarize_agent(question: str, findings: dict, model: ChatModel, callbacks: Sequence[Callback] = ()) -> str:
    """Write the answer, citing the findings."""
    messages = [
        {"role": "system", "content": SUMMARY_PROMPT},
        {"role": "user", "content": f"QUESTION: {question}\n\nFINDINGS:\n{json.dumps(findings, indent=2)}"},
    ]
    reply = model.invoke(messages)
    for cb in callbacks:
        cb.on_llm_end(reply)
    return reply["content"]
