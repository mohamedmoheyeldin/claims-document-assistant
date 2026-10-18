import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { FALLBACK_BETA, MODEL, ModelRefusalError } from "./claude.js";
import { FIELD_LABELS, type ClaimFields, type Issue } from "./schema.js";
import { hasBlockingIssues } from "./validate.js";

export type ClaimStatus = "ready_for_adjudication" | "information_requested";

export interface StatusDraft {
  status: ClaimStatus;
  subject: string;
  body: string;
  draftedBy: "claude" | "template";
}

export function claimStatus(issues: Issue[]): ClaimStatus {
  return hasBlockingIssues(issues) ? "information_requested" : "ready_for_adjudication";
}

const reference = (fields: ClaimFields) => fields.claimNumber ?? "your recent claim";

/** Deterministic reply used offline, in tests, and whenever the model is unavailable. */
export function templateDraft(fields: ClaimFields, issues: Issue[]): StatusDraft {
  const status = claimStatus(issues);
  const ref = reference(fields);
  if (status === "ready_for_adjudication") {
    return {
      status,
      draftedBy: "template",
      subject: `Claim ${ref}: received and complete`,
      body: [
        "Hello,",
        "",
        `We received claim ${ref}${fields.serviceDateFrom ? ` for services on ${fields.serviceDateFrom}` : ""}. It has everything we need and has moved to review for payment. You do not need to send anything else.`,
        "",
        "Claims Processing Unit",
      ].join("\n"),
    };
  }
  const needed = issues.filter((issue) => issue.severity === "blocking").map((issue) => `- ${issue.message}`);
  return {
    status,
    draftedBy: "template",
    subject: `Claim ${ref}: more information needed`,
    body: [
      "Hello,",
      "",
      `We received claim ${ref}, but we cannot process it yet. Please send a corrected claim or the missing details:`,
      "",
      ...needed,
      "",
      "Processing will continue as soon as we receive them.",
      "",
      "Claims Processing Unit",
    ].join("\n"),
  };
}

const DraftSchema = z.object({ subject: z.string(), body: z.string() });

export const DRAFT_SYSTEM = `You draft status replies from a claims-processing unit to the billing office that submitted a community-care claim. A human claims examiner reviews and edits every draft before anything is sent.

Write a short, plain-language email: a subject line and a body of at most 120 words, signed "Claims Processing Unit".
- State the status you are given. Do not decide or change it.
- When information is requested, list exactly the problems you are given, one per line, in words a billing clerk understands. Do not add requirements of your own.
- Refer to the claim by its claim number. Do not repeat the patient's date of birth or member ID in the email.
- Do not promise payment amounts or timelines.`;

/** Asks Claude for a friendlier draft; the status itself comes from the rules, never the model. */
export async function claudeDraft(client: Anthropic, fields: ClaimFields, issues: Issue[]): Promise<StatusDraft> {
  const status = claimStatus(issues);
  const problems = issues.filter((issue) => issue.severity === "blocking").map((issue) => `${FIELD_LABELS[issue.field]}: ${issue.message}`);
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(DraftSchema) },
    system: DRAFT_SYSTEM,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          status,
          claimNumber: fields.claimNumber,
          serviceDateFrom: fields.serviceDateFrom,
          serviceDescription: fields.serviceDescription,
          facilityName: fields.facilityName,
          problems,
        }),
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new ModelRefusalError(response.stop_details?.category ?? null);
  if (!response.parsed_output) throw new Error("Draft returned no parseable output.");
  return { status, draftedBy: "claude", ...response.parsed_output };
}
