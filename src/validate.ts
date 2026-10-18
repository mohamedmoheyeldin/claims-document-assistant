import { FIELD_LABELS, REQUIRED_FIELDS, type ClaimFields, type Issue } from "./schema.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ICD10 = /^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;
const CPT_HCPCS = /^(\d{5}|\d{4}[FTU]|[A-V]\d{4})$/;

/** NPI check digit: Luhn over the 9-digit base prefixed with 80840. */
export function isValidNpi(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = `80840${npi.slice(0, 9)}`;
  let sum = 0;
  for (let i = digits.length - 1, double = true; i >= 0; i--, double = !double) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(npi[9]);
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Deterministic business rules. These run after extraction regardless of
 * which extractor produced the fields, so the model never decides on its own
 * whether a claim is complete.
 */
export function validateClaim(fields: ClaimFields): Issue[] {
  const issues: Issue[] = [];
  const blocking = (code: Issue["code"], field: Issue["field"], message: string) =>
    issues.push({ code, field, severity: "blocking", message });

  for (const field of REQUIRED_FIELDS) {
    const value = fields[field];
    if (value === null || (typeof value === "string" && value.trim() === "")) {
      blocking("MISSING_FIELD", field, `${FIELD_LABELS[field]} is missing.`);
    }
  }

  if (fields.providerNpi && !isValidNpi(fields.providerNpi)) {
    blocking("INVALID_NPI", "providerNpi", `Provider NPI ${fields.providerNpi} fails the NPI check-digit test.`);
  }
  if (fields.diagnosisCode && !ICD10.test(fields.diagnosisCode.toUpperCase())) {
    blocking("INVALID_DIAGNOSIS_CODE", "diagnosisCode", `Diagnosis code ${fields.diagnosisCode} is not a valid ICD-10-CM format.`);
  }
  if (fields.procedureCode && !CPT_HCPCS.test(fields.procedureCode.toUpperCase())) {
    blocking("INVALID_PROCEDURE_CODE", "procedureCode", `Procedure code ${fields.procedureCode} is not a valid CPT/HCPCS format.`);
  }
  if (fields.billedAmount !== null && !(fields.billedAmount > 0)) {
    blocking("INVALID_AMOUNT", "billedAmount", "Billed amount must be greater than zero.");
  }

  const dateFields = ["dateOfBirth", "referralExpirationDate", "serviceDateFrom", "serviceDateTo", "submittedDate"] as const;
  const dates: Partial<Record<(typeof dateFields)[number], string>> = {};
  for (const field of dateFields) {
    const value = fields[field];
    if (value === null) continue;
    if (isValidIsoDate(value)) dates[field] = value;
    else blocking("INVALID_DATE", field, `${FIELD_LABELS[field]} "${value}" is not a valid date.`);
  }

  const { serviceDateFrom: from, serviceDateTo: to, submittedDate: submitted, referralExpirationDate: expires, dateOfBirth: dob } = dates;
  if (from && to && to < from) {
    blocking("DATE_ORDER", "serviceDateTo", "Service end date is before the service start date.");
  }
  if (from && submitted && submitted < from) {
    blocking("DATE_ORDER", "submittedDate", "Claim was submitted before the date of service.");
  }
  if (dob && from && from < dob) {
    blocking("DATE_ORDER", "dateOfBirth", "Date of service is before the claimant's date of birth.");
  }
  if (expires && (to ?? from) && (to ?? from)! > expires) {
    blocking("REFERRAL_EXPIRED", "referralExpirationDate", `Service was provided after the referral expired on ${expires}.`);
  }
  if (!fields.referralExpirationDate && fields.referralNumber) {
    issues.push({
      code: "MISSING_FIELD",
      field: "referralExpirationDate",
      severity: "warning",
      message: "Referral expiration date is not on the document; confirm the referral was active on the date of service.",
    });
  }

  return issues;
}

export function hasBlockingIssues(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === "blocking");
}
