import { extractText } from "unpdf";
import { toAmount, toIsoDate } from "../normalize.js";
import type { ClaimFields } from "../schema.js";
import type { Extractor } from "./types.js";

const DATE = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Z][a-z]+ \d{1,2}, \d{4})`;

export async function pdfToText(pdf: Uint8Array): Promise<string> {
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  return text;
}

const empty = (): ClaimFields => ({
  claimNumber: null, claimantFirstName: null, claimantLastName: null, memberId: null, dateOfBirth: null,
  referralNumber: null, referralExpirationDate: null, providerName: null, providerNpi: null, facilityName: null,
  serviceDateFrom: null, serviceDateTo: null, diagnosisCode: null, procedureCode: null, serviceDescription: null,
  billedAmount: null, submittedDate: null,
});

function labelled(text: string, label: string): string | null {
  const m = text.match(new RegExp(`^${label}:[ \\t]*(.*)$`, "m"));
  const value = m?.[1]?.trim();
  return value ? value : null;
}

function parseForm(text: string): ClaimFields {
  const f = empty();
  f.claimNumber = labelled(text, "Claim Number");
  const name = labelled(text, String.raw`Claimant Name \(Last, First\)`);
  if (name) {
    const [last, first] = name.split(",").map((s) => s.trim());
    f.claimantLastName = last || null;
    f.claimantFirstName = first || null;
  }
  f.memberId = labelled(text, "Member ID");
  f.dateOfBirth = toIsoDate(labelled(text, "Date of Birth"));
  f.referralNumber = labelled(text, "Referral Number");
  f.referralExpirationDate = toIsoDate(labelled(text, "Referral Expiration Date"));
  f.providerName = labelled(text, "Treating Provider");
  f.providerNpi = labelled(text, "Provider NPI");
  f.facilityName = labelled(text, "Treating Facility");
  f.serviceDateFrom = toIsoDate(labelled(text, "Service Date From"));
  f.serviceDateTo = toIsoDate(labelled(text, "Service Date To"));
  f.diagnosisCode = labelled(text, String.raw`Diagnosis Code \(ICD-10\)`);
  f.procedureCode = labelled(text, String.raw`Procedure Code \(CPT\)`);
  f.serviceDescription = labelled(text, "Service Description");
  f.billedAmount = toAmount(labelled(text, "Total Billed Amount"));
  f.submittedDate = toIsoDate(labelled(text, "Date Submitted"));
  return f;
}

function parseLetter(raw: string): ClaimFields {
  const text = raw.replace(/\s+/g, " ");
  const f = empty();
  const grab = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;
  f.submittedDate = toIsoDate(grab(new RegExp(`PROVIDER ${DATE} Claims Processing Unit`)));
  f.facilityName = grab(/To whom it may concern, (.+?) is submitting this claim/);
  if (f.facilityName === "Our office") f.facilityName = null;
  f.claimNumber = grab(/\(claim (CLM-[\d-]+)\)/);
  const patient = grab(/for services provided to (.+?)\. /);
  if (patient && !patient.startsWith("the patient named")) {
    const parts = patient.split(" ");
    if (parts.length >= 2) {
      f.claimantFirstName = parts[0]!;
      f.claimantLastName = parts.slice(1).join(" ");
    }
  }
  f.memberId = grab(/member ID (\S+)/);
  f.dateOfBirth = toIsoDate(grab(new RegExp(`date of birth ${DATE}`)));
  f.referralNumber = grab(/under referral ([A-Z0-9]+)/);
  f.referralExpirationDate = toIsoDate(grab(new RegExp(`valid through ${DATE}`)));
  const provider = grab(/\. ([^.]*?(?:MD|DO|DPT|PhD|NP)) (?:\(NPI|provided)/);
  f.providerName = provider;
  f.providerNpi = grab(/\(NPI (\d+)\)/);
  const range = text.match(new RegExp(`from ${DATE} to ${DATE}`));
  if (range) {
    f.serviceDateFrom = toIsoDate(range[1]);
    f.serviceDateTo = toIsoDate(range[2]);
  } else {
    f.serviceDateFrom = toIsoDate(grab(new RegExp(` on ${DATE}\\.`)));
  }
  const description = grab(new RegExp(`(?:\\(NPI \\d+\\)|MD|DO|DPT|PhD|NP|provider) provided (.+?)(?: from ${DATE} to ${DATE}| on ${DATE})?\\. `));
  f.serviceDescription = description && description !== "the services listed" ? description : null;
  f.procedureCode = grab(/procedure code (\S+?)(?:[ .]|$)/);
  f.diagnosisCode = grab(/diagnosis code (\S+?)\.?(?: |$)/);
  f.billedAmount = toAmount(grab(/total billed amount is (\$?[\d,]+\.\d{2}(?: USD)?)/));
  return f;
}

/**
 * Deterministic baseline: fixed regular expressions written for the two
 * document templates it knows (the claim form and the cover letter). It needs
 * no API key, so the test suite and the offline demo use it, and the
 * evaluation reports it next to Claude so the difference is measured, not
 * claimed. It has no rules for any other layout and returns nulls there.
 */
export const rulesExtractor: Extractor = {
  name: "rules",
  async extract(pdf) {
    const text = await pdfToText(pdf);
    let fields: ClaimFields;
    if (/CLAIM SUBMISSION FORM/.test(text)) fields = parseForm(text);
    else if (/To whom it may concern/.test(text)) fields = parseLetter(text);
    else fields = empty();
    return { fields, extractor: "rules" };
  },
};
