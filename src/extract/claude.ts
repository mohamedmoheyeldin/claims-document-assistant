import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { FALLBACK_BETA, MODEL, ModelRefusalError } from "../claude.js";
import { ClaimFieldsSchema } from "../schema.js";
import type { Extractor } from "./types.js";

export const EXTRACTION_SYSTEM = `You extract fields from community-care claim documents for a claims-processing team. The documents vary: structured claim forms, cover letters from billing offices, and terse encounter notes.

Read the attached PDF and fill in every field of the output schema.

- Copy identifiers (claim number, member ID, referral number, NPI, diagnosis and procedure codes) exactly as written, even if they look malformed. A separate validation step checks them; do not correct them.
- Write dates as YYYY-MM-DD and the billed amount as a plain number of US dollars.
- Use null when a field is blank, marked "--", absent, or not legible. Never infer a value from other fields or from general knowledge. A missing value that a human reviewer can see is far better than a plausible guess they cannot.
- For a single-day service with no end date written, set serviceDateTo to null.
- Give the provider name as written, including credentials (for example "Jordan Patel, MD").`;

/**
 * Claude-based extractor. The PDF goes to the model as a document block, and
 * structured outputs constrain the answer to the claim schema, so the result
 * is validated JSON rather than free text.
 */
export function createClaudeExtractor(client: Anthropic): Extractor {
  return {
    name: "claude",
    async extract(pdf) {
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 4096,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(ClaimFieldsSchema) },
        system: EXTRACTION_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } },
              { type: "text", text: "Extract the claim fields from this document." },
            ],
          },
        ],
      });
      if (response.stop_reason === "refusal") {
        throw new ModelRefusalError(response.stop_details?.category ?? null);
      }
      if (!response.parsed_output) {
        throw new Error(`Extraction returned no parseable output (stop_reason: ${response.stop_reason}).`);
      }
      return {
        fields: response.parsed_output,
        extractor: "claude",
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        servedBy: response.model,
      };
    },
  };
}
