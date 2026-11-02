"""Stands in for your application: a research assistant with two stages.

    search(question, model)    -> the passages that answer the question, each with its source id
    summarize(passages, model) -> an answer built from those passages, citing them

Each stage takes its model as a parameter. That is the one thing an
evaluation needs from your app: a way to run a stage with a model it chooses.

The models here are fakes with known weaknesses, so the sample runs free and
offline. In your app, each stage would call a real LLM, for example through
LangChain's `init_chat_model(model)`.
"""

import re

PAGES = {
    "s1": "The Harbor Line opened on 14 March 2024.",
    "s2": "Bikes are allowed on Harbor Line trains outside peak hours.",
    "s3": "A monthly pass costs $68.",
    "s4": "The monthly pass is valid on the Gull Island ferry.",
    "s5": "The Harbor Line has nine stations.",
}

# What one call costs with each model. A real app would read the token usage
# from the LLM's response instead.
COST_PER_CALL = {"large": 0.01, "mid": 0.002, "small": 0.0005}


def words(text):
    return {w[:4] for w in text.lower().replace(",", " ").replace("?", " ").split() if len(w) > 3}


def search(question, model):
    # Fake behaviour: "small" only searches the first part of a two-part question.
    parts = question.strip().split(", and ")
    if model == "small":
        parts = parts[:1]
    found = []
    for part in parts:
        best = max(PAGES, key=lambda page: len(words(part) & words(PAGES[page])))
        if best not in found:
            found.append(best)
    return "\n".join(f"[{page}] {PAGES[page]}" for page in found)


def summarize(passages, model):
    # Fake behaviour: "mid" adds a claim that no passage supports.
    lines = [f"- {text} {source}" for source, text in re.findall(r"^(\[s\d+\]) (.+)$", passages, re.M)]
    if model == "mid":
        lines.append("- Every route runs all night on weekends. [s1]")
    return "\n".join(lines)
