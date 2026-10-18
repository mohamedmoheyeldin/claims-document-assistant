import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ModelRefusalError } from "../src/claude.js";
import { claudeDraft } from "../src/draft.js";
import { createClaudeExtractor } from "../src/extract/claude.js";
import { generateDocument } from "../src/generate.js";
import { validateClaim } from "../src/validate.js";

/** Minimal stand-in for the SDK client: records the request and returns a canned message. */
function fakeClient(response: Record<string, unknown>) {
  const parse = vi.fn().mockResolvedValue({ model: "claude-opus-5-5", stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 1500, output_tokens: 300 }, ...response });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe("Claude extractor", () => {
  it("sends the PDF as a document block with a structured-output schema", async () => {
    const { truth, pdf } = await generateDocument(3, 1, "note");
    const { client, parse } = fakeClient({ parsed_output: truth.fields });
    const result = await createClaudeExtractor(client).extract(pdf);

    expect(result.fields).toEqual(truth.fields);
    expect(result.usage).toEqual({ inputTokens: 1500, outputTokens: 300 });
    const request = parse.mock.calls[0]![0];
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.fallbacks).toBe("default");
    expect(request.output_config.format.type).toBe("json_schema");
    const [doc, text] = request.messages[0].content;
    expect(doc.type).toBe("document");
    expect(Buffer.from(doc.source.data, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect(text.type).toBe("text");
    expect(request.system).toMatch(/Never infer a value/);
  });

  it("raises a refusal so the document goes to manual review", async () => {
    const { pdf } = await generateDocument(3, 1);
    const { client } = fakeClient({ stop_reason: "refusal", stop_details: { type: "refusal", category: null }, parsed_output: null });
    await expect(createClaudeExtractor(client).extract(pdf)).rejects.toBeInstanceOf(ModelRefusalError);
  });
});

describe("Claude reply draft", () => {
  it("keeps the rules' status and passes only the rule findings to the model", async () => {
    const { truth } = await generateDocument(3, 2);
    const fields = { ...truth.fields, memberId: null };
    const issues = validateClaim(fields);
    const { client, parse } = fakeClient({ parsed_output: { subject: "s", body: "b" } });
    const draft = await claudeDraft(client, fields, issues);
    expect(draft).toMatchObject({ status: "information_requested", draftedBy: "claude", subject: "s", body: "b" });
    const payload = JSON.parse(parse.mock.calls[0]![0].messages[0].content);
    expect(payload.problems.some((p: string) => p.startsWith("Member ID"))).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(truth.fields.dateOfBirth!);
  });
});
