import { produceCode } from "../producers/code-gen.js";
import {
  requireModel,
  toCandidateResult,
  type CandidateAdapter,
  type CandidateRequest,
  type CandidateResult,
  type ExecutionContext,
} from "./types.js";

/** Bare one-shot code generation. tsc stays an evaluator on the returned files. */
export const codegenAdapter: CandidateAdapter = {
  id: "codegen",

  async execute(request: CandidateRequest, context: ExecutionContext): Promise<CandidateResult> {
    const { files, ...usage } = await produceCode(request.inputText, requireModel(request, "codegen"), {
      temperature: request.temperature,
      timeoutMs: request.timeoutMs,
      trace: context.emit,
      traceContext: context.traceContext,
    });
    return toCandidateResult(usage, files);
  },
};
