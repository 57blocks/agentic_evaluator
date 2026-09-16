# legacy-smoke (non-canonical)

First run of the unmodified harness inside this repo (commit 441d4ca), before
the canonical layer existed. Two candidates × one input × one trial, codegen
suite, judge google/gemini-3.1-pro-preview.

Purpose: proves routing, the tsc gate, pairwise judging and absolute scoring
work here. It is NOT the parity fixture — that must be generated after the
canonical layer lands (see docs/HARNESS-TO-PROTOCOL-MAP.md).
