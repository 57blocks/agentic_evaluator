"""The app as it runs in production: search, then summarize, one model per agent.

    python3 -m app.pipeline "How much is a monthly pass, and is it valid on the Gull Island ferry?"

Each agent's model comes from configuration, not from the code. That one
property is what lets an evaluation try other models agent by agent.
"""

from __future__ import annotations

import sys

from .agents import search_agent, summarize_agent
from .models import init_chat_model
from .search import CorpusSearch

DEFAULT_MODELS = {"search": "fake/large", "summarize": "fake/large"}


def answer(question: str, models: dict[str, str] = DEFAULT_MODELS) -> str:
    findings = search_agent(question, init_chat_model(models["search"]), CorpusSearch())
    return summarize_agent(question, findings, init_chat_model(models["summarize"]))


if __name__ == "__main__":
    print(answer(" ".join(sys.argv[1:])))
