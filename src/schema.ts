import { z } from "zod";

/**
 * Fields the assistant extracts from a claim document. The names mirror the
 * referral records produced by the author's earlier synthetic test-data
 * generator (ReferralNumber, TreatingProvider, TreatingProviderNPI,
 * DiagnosisCode, ServiceRequested, TreatingFacility), flattened for a claim.
 *
 * Every field is nullable: null means "not present or not legible in the
 * document". Extractors must never guess a value.
 */
export const ClaimFieldsSchema = z.object({
  claimNumber: z.string().nullable(),
  claimantFirstName: z.string().nullable(),
  claimantLastName: z.string().nullable(),
  memberId: z.string().nullable(),
  dateOfBirth: z.string().nullable().describe("ISO date YYYY-MM-DD"),
  referralNumber: z.string().nullable(),
  referralExpirationDate: z.string().nullable().describe("ISO date YYYY-MM-DD"),
  providerName: z.string().nullable(),
  providerNpi: z.string().nullable().describe("10-digit National Provider Identifier"),
  facilityName: z.string().nullable(),
  serviceDateFrom: z.string().nullable().describe("ISO date YYYY-MM-DD"),
  serviceDateTo: z.string().nullable().describe("ISO date YYYY-MM-DD"),
  diagnosisCode: z.string().nullable().describe("ICD-10-CM code, e.g. M54.50"),
  procedureCode: z.string().nullable().describe("CPT/HCPCS code, e.g. 97110"),
  serviceDescription: z.string().nullable(),
  billedAmount: z.number().nullable().describe("Total billed amount in US dollars"),
  submittedDate: z.string().nullable().describe("ISO date YYYY-MM-DD"),
});

export type ClaimFields = z.infer<typeof ClaimFieldsSchema>;
export type FieldName = keyof ClaimFields;

export const FIELD_NAMES = Object.keys(ClaimFieldsSchema.shape) as FieldName[];

export const FIELD_LABELS: Record<FieldName, string> = {
  claimNumber: "Claim number",
  claimantFirstName: "Claimant first name",
  claimantLastName: "Claimant last name",
  memberId: "Member ID",
  dateOfBirth: "Date of birth",
  referralNumber: "Referral number",
  referralExpirationDate: "Referral expiration date",
  providerName: "Treating provider",
  providerNpi: "Provider NPI",
  facilityName: "Treating facility",
  serviceDateFrom: "Service date (from)",
  serviceDateTo: "Service date (to)",
  diagnosisCode: "Diagnosis code",
  procedureCode: "Procedure code",
  serviceDescription: "Service description",
  billedAmount: "Billed amount",
  submittedDate: "Submitted date",
};

/** Fields a claim cannot be adjudicated without. */
export const REQUIRED_FIELDS: FieldName[] = [
  "claimNumber",
  "claimantFirstName",
  "claimantLastName",
  "memberId",
  "dateOfBirth",
  "referralNumber",
  "providerName",
  "providerNpi",
  "serviceDateFrom",
  "diagnosisCode",
  "procedureCode",
  "billedAmount",
  "submittedDate",
];

export type IssueCode =
  | "MISSING_FIELD"
  | "INVALID_NPI"
  | "INVALID_DIAGNOSIS_CODE"
  | "INVALID_PROCEDURE_CODE"
  | "INVALID_DATE"
  | "DATE_ORDER"
  | "REFERRAL_EXPIRED"
  | "INVALID_AMOUNT";

export interface Issue {
  code: IssueCode;
  field: FieldName;
  severity: "blocking" | "warning";
  message: string;
}

export type Layout = "form" | "letter" | "note";

export interface GroundTruth {
  id: string;
  layout: Layout;
  scenario: "complete" | "missing" | "invalid";
  fields: ClaimFields;
  expectedIssues: { code: IssueCode; field: FieldName }[];
}
