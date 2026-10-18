import { describe, expect, it } from "vitest";
import { createRng } from "../src/random.js";
import { makeNpi } from "../src/generate.js";
import type { ClaimFields } from "../src/schema.js";
import { isValidIsoDate, isValidNpi, validateClaim } from "../src/validate.js";

const complete: ClaimFields = {
  claimNumber: "CLM-2026-100001",
  claimantFirstName: "Jordan",
  claimantLastName: "Ellison",
  memberId: "SYN12345678",
  dateOfBirth: "1970-05-04",
  referralNumber: "RF26ABCDEFGH",
  referralExpirationDate: "2026-12-31",
  providerName: "Avery Patel, MD",
  providerNpi: "1234567893",
  facilityName: "Lakeside Community Physical Therapy",
  serviceDateFrom: "2026-03-02",
  serviceDateTo: "2026-03-02",
  diagnosisCode: "M54.50",
  procedureCode: "97110",
  serviceDescription: "Therapeutic exercise, 15 minutes",
  billedAmount: 120,
  submittedDate: "2026-03-10",
};

describe("isValidNpi", () => {
  it("accepts the CMS reference example and rejects a wrong check digit", () => {
    expect(isValidNpi("1234567893")).toBe(true);
    expect(isValidNpi("1234567890")).toBe(false);
    expect(isValidNpi("12345")).toBe(false);
  });

  it("agrees with the generator for valid and corrupted NPIs", () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      expect(isValidNpi(makeNpi(rng, true))).toBe(true);
      expect(isValidNpi(makeNpi(rng, false))).toBe(false);
    }
  });
});

describe("isValidIsoDate", () => {
  it("rejects impossible dates", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("02/28/2026")).toBe(false);
  });
});

describe("validateClaim", () => {
  it("finds nothing wrong with a complete, consistent claim", () => {
    expect(validateClaim(complete)).toEqual([]);
  });

  it("flags each missing required field as blocking", () => {
    const issues = validateClaim({ ...complete, memberId: null, billedAmount: null });
    expect(issues.map((i) => [i.code, i.field, i.severity])).toEqual([
      ["MISSING_FIELD", "memberId", "blocking"],
      ["MISSING_FIELD", "billedAmount", "blocking"],
    ]);
  });

  it("treats blank strings as missing", () => {
    expect(validateClaim({ ...complete, claimNumber: "  " })[0]).toMatchObject({ code: "MISSING_FIELD", field: "claimNumber" });
  });

  it("only warns when the referral expiration date is absent", () => {
    const issues = validateClaim({ ...complete, referralExpirationDate: null });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "referralExpirationDate", severity: "warning" });
  });

  it("catches invalid codes, amounts and dates", () => {
    const codes = validateClaim({ ...complete, providerNpi: "1234567890", diagnosisCode: "540.5", procedureCode: "9711", billedAmount: 0, dateOfBirth: "1970-13-01" }).map((i) => i.code);
    expect(codes).toEqual(["INVALID_NPI", "INVALID_DIAGNOSIS_CODE", "INVALID_PROCEDURE_CODE", "INVALID_AMOUNT", "INVALID_DATE"]);
  });

  it("catches out-of-order dates and expired referrals", () => {
    expect(validateClaim({ ...complete, submittedDate: "2026-03-01" }).map((i) => i.code)).toEqual(["DATE_ORDER"]);
    expect(validateClaim({ ...complete, serviceDateTo: "2026-03-01" }).map((i) => i.code)).toEqual(["DATE_ORDER"]);
    expect(validateClaim({ ...complete, referralExpirationDate: "2026-02-28" }).map((i) => i.code)).toEqual(["REFERRAL_EXPIRED"]);
  });
});
