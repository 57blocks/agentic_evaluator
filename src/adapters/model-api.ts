import { complete } from "../llm.js";
import {
  requireModel,
  toCandidateResult,
  type CandidateAdapter,
  type CandidateRequest,
  type CandidateResult,
  type ExecutionContext,
} from "./types.js";

/** One completion on the candidate's route (OpenRouter unless it declares another). */
export const modelApiAdapter: CandidateAdapter = {
  id: "model-api",

  async execute(request: CandidateRequest, context: ExecutionContext): Promise<CandidateResult> {
    const prompt = request.promptTemplate.replace("{{input}}", request.inputText);
    return toCandidateResult(
      await complete({
        model: requireModel(request, "model-api"),
        prompt,
        temperature: request.temperature,
        timeoutMs: request.timeoutMs,
        maxTokens: request.maxTokens,
        ...request.sampling,
        ...(request.endpoint ? { endpoint: request.endpoint } : {}),
        trace: context.emit,
        traceContext: context.traceContext,
      }),
    );
  },
};
