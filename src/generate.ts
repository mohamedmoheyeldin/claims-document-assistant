import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createRng, type Rng } from "./random.js";
import { REQUIRED_FIELDS, type ClaimFields, type FieldName, type GroundTruth, type Issue, type Layout } from "./schema.js";
import { validateClaim } from "./validate.js";

// Every name, ID and number below is invented. Nothing is drawn from real
// people, providers or claims.
const FIRST_NAMES = ["Jordan", "Avery", "Morgan", "Riley", "Casey", "Quinn", "Taylor", "Reese", "Dakota", "Rowan", "Emerson", "Hayden"];
const LAST_NAMES = ["Ellison", "Marquez", "Okafor", "Lindqvist", "Brennan", "Castillo", "Nakamura", "Whitfield", "Adeyemi", "Sorensen", "Delacroix", "Hargrove"];
const PROVIDER_LAST = ["Patel", "Greer", "Abernathy", "Vasquez", "Kowalski", "Mensah", "Thornton", "Iverson"];
const FACILITIES = ["Lakeside Community Physical Therapy", "Northgate Orthopedic Group", "Riverbend Imaging Center", "Summit Behavioral Health", "Cedar Valley Family Clinic", "Harbor Point Sleep Center"];
const SERVICES = [
  { procedureCode: "97110", diagnosisCode: "M54.50", description: "Therapeutic exercise, 15 minutes", amount: [85, 160] },
  { procedureCode: "72148", diagnosisCode: "M51.26", description: "MRI lumbar spine without contrast", amount: [900, 1900] },
  { procedureCode: "90837", diagnosisCode: "F43.10", description: "Psychotherapy, 60 minutes", amount: [140, 260] },
  { procedureCode: "95810", diagnosisCode: "G47.33", description: "Polysomnography, attended sleep study", amount: [1200, 2800] },
  { procedureCode: "99214", diagnosisCode: "E11.9", description: "Office visit, established patient, moderate complexity", amount: [120, 240] },
  { procedureCode: "29881", diagnosisCode: "S83.241A", description: "Arthroscopy, knee, with meniscectomy", amount: [3200, 7400] },
] as const;

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = (rng: Rng, length: number) => Array.from({ length }, () => rng.pick([...ALNUM])).join("");

/** Builds an NPI with a valid check digit (or a deliberately wrong one). */
export function makeNpi(rng: Rng, valid = true): string {
  const base = `1${Array.from({ length: 8 }, () => rng.int(0, 9)).join("")}`;
  const digits = `80840${base}`;
  let sum = 0;
  for (let i = digits.length - 1, double = true; i >= 0; i--, double = !double) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${base}${valid ? check : (check + rng.int(1, 9)) % 10}`;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

function baseClaim(rng: Rng, index: number): ClaimFields {
  const service = rng.pick(SERVICES);
  const year = 2026;
  const serviceDateFrom = iso(new Date(Date.UTC(year, rng.int(0, 7), rng.int(1, 28))));
  const multiDay = rng.chance(0.3);
  const referralStart = addDays(serviceDateFrom, -rng.int(10, 60));
  const amount = rng.int(service.amount[0] * 100, service.amount[1] * 100) / 100;
  return {
    claimNumber: `CLM-${year}-${String(100000 + index * 7919 + rng.int(0, 999)).padStart(6, "0")}`,
    claimantFirstName: rng.pick(FIRST_NAMES),
    claimantLastName: rng.pick(LAST_NAMES),
    memberId: `SYN${rng.int(10000000, 99999999)}`,
    dateOfBirth: iso(new Date(Date.UTC(rng.int(1948, 2001), rng.int(0, 11), rng.int(1, 28)))),
    referralNumber: `RF${String(year).slice(2)}${code(rng, 8)}`,
    referralExpirationDate: addDays(referralStart, rng.pick([90, 180, 365])),
    providerName: `${rng.pick(FIRST_NAMES)} ${rng.pick(PROVIDER_LAST)}, ${rng.pick(["MD", "DO", "DPT", "PhD", "NP"])}`,
    providerNpi: makeNpi(rng),
    facilityName: rng.pick(FACILITIES),
    serviceDateFrom,
    serviceDateTo: multiDay ? addDays(serviceDateFrom, rng.int(1, 4)) : serviceDateFrom,
    diagnosisCode: service.diagnosisCode,
    procedureCode: service.procedureCode,
    serviceDescription: service.description,
    billedAmount: amount,
    submittedDate: addDays(serviceDateFrom, rng.int(3, 40)),
  };
}

type InvalidKind = "badNpi" | "expiredReferral" | "dateOrder" | "badDiagnosis";

function applyScenario(rng: Rng, fields: ClaimFields, scenario: GroundTruth["scenario"]): ClaimFields {
  const out = { ...fields };
  if (scenario === "missing") {
    const removable = REQUIRED_FIELDS.filter((f) => f !== "claimNumber");
    for (const field of rng.shuffle(removable).slice(0, rng.int(1, 2))) {
      (out as Record<FieldName, unknown>)[field] = null;
      // A document without a start date shows no service dates at all.
      if (field === "serviceDateFrom") out.serviceDateTo = null;
    }
  } else if (scenario === "invalid") {
    const kind = rng.pick<InvalidKind>(["badNpi", "expiredReferral", "dateOrder", "badDiagnosis"]);
    if (kind === "badNpi") out.providerNpi = makeNpi(rng, false);
    if (kind === "expiredReferral") out.referralExpirationDate = addDays(out.serviceDateFrom!, -rng.int(5, 30));
    if (kind === "dateOrder") out.submittedDate = addDays(out.serviceDateFrom!, -rng.int(2, 10));
    if (kind === "badDiagnosis") out.diagnosisCode = rng.pick(["M5450", "U99.X", "540.5"]);
  }
  return out;
}

// --- Formatting variety: the same value is written differently across documents.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function formatDate(rng: Rng, value: string): string {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return rng.pick([
    `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`,
    value,
    `${MONTHS[m - 1]} ${d}, ${y}`,
  ]);
}
const formatAmount = (rng: Rng, value: number) =>
  rng.chance(0.5) ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${value.toFixed(2)} USD`;

const show = (value: string | null) => value ?? "";

function formLines(rng: Rng, f: ClaimFields): string[] {
  const date = (v: string | null) => (v ? formatDate(rng, v) : "");
  return [
    "COMMUNITY CARE CLAIM SUBMISSION FORM",
    "",
    "SECTION A - CLAIMANT",
    `Claim Number: ${show(f.claimNumber)}`,
    `Claimant Name (Last, First): ${f.claimantLastName ?? ""}, ${f.claimantFirstName ?? ""}`,
    `Member ID: ${show(f.memberId)}`,
    `Date of Birth: ${date(f.dateOfBirth)}`,
    "",
    "SECTION B - REFERRAL",
    `Referral Number: ${show(f.referralNumber)}`,
    `Referral Expiration Date: ${date(f.referralExpirationDate)}`,
    "",
    "SECTION C - TREATING PROVIDER",
    `Treating Provider: ${show(f.providerName)}`,
    `Provider NPI: ${show(f.providerNpi)}`,
    `Treating Facility: ${show(f.facilityName)}`,
    "",
    "SECTION D - SERVICES",
    `Service Date From: ${date(f.serviceDateFrom)}`,
    `Service Date To: ${date(f.serviceDateTo)}`,
    `Diagnosis Code (ICD-10): ${show(f.diagnosisCode)}`,
    `Procedure Code (CPT): ${show(f.procedureCode)}`,
    `Service Description: ${show(f.serviceDescription)}`,
    `Total Billed Amount: ${f.billedAmount === null ? "" : formatAmount(rng, f.billedAmount)}`,
    "",
    "SECTION E - SUBMISSION",
    `Date Submitted: ${date(f.submittedDate)}`,
    "Provider Signature: ______________________",
  ];
}

function letterLines(rng: Rng, f: ClaimFields): string[] {
  const date = (v: string | null) => (v ? formatDate(rng, v) : null);
  const sentences: string[] = [];
  sentences.push(`${f.facilityName ?? "Our office"} is submitting this claim${f.claimNumber ? ` (claim ${f.claimNumber})` : ""} for services provided to ${[f.claimantFirstName, f.claimantLastName].filter(Boolean).join(" ") || "the patient named in the attached records"}.`);
  const ids: string[] = [];
  if (f.memberId) ids.push(`member ID ${f.memberId}`);
  if (f.dateOfBirth) ids.push(`date of birth ${date(f.dateOfBirth)}`);
  if (ids.length) sentences.push(`The patient's ${ids.join(" and ")} are on file.`);
  if (f.referralNumber) {
    sentences.push(`Care was authorized under referral ${f.referralNumber}${f.referralExpirationDate ? `, which is valid through ${date(f.referralExpirationDate)}` : ""}.`);
  }
  const svc: string[] = [];
  if (f.serviceDateFrom) {
    svc.push(f.serviceDateTo && f.serviceDateTo !== f.serviceDateFrom ? `from ${date(f.serviceDateFrom)} to ${date(f.serviceDateTo)}` : `on ${date(f.serviceDateFrom)}`);
  }
  sentences.push(`${f.providerName ?? "The treating provider"}${f.providerNpi ? ` (NPI ${f.providerNpi})` : ""} provided ${f.serviceDescription ? f.serviceDescription.toLowerCase() : "the services listed"}${svc.length ? ` ${svc[0]}` : ""}.`);
  const codes: string[] = [];
  if (f.procedureCode) codes.push(`procedure code ${f.procedureCode}`);
  if (f.diagnosisCode) codes.push(`diagnosis code ${f.diagnosisCode}`);
  if (codes.length) sentences.push(`The services were billed under ${codes.join(" with ")}.`);
  if (f.billedAmount !== null) sentences.push(`The total billed amount is ${formatAmount(rng, f.billedAmount)}.`);
  sentences.push("Please contact our billing office with any questions about this claim.");
  return [
    f.submittedDate ? date(f.submittedDate)! : "",
    "",
    "Claims Processing Unit",
    "Community Care Program",
    "",
    "RE: Request for payment",
    "",
    "To whom it may concern,",
    "",
    sentences.join(" "),
    "",
    "Sincerely,",
    "Billing Office",
  ];
}

/**
 * A third layout the rules-based extractor was never written for: terse
 * clinical-note shorthand with different labels and ordering. It exists to
 * show where fixed parsing rules stop working.
 */
function noteLines(rng: Rng, f: ClaimFields): string[] {
  const date = (v: string | null) => (v ? formatDate(rng, v) : "--");
  return [
    "ENCOUNTER SUMMARY / BILLING NOTE",
    "",
    `Pt: ${f.claimantFirstName ?? "--"} ${f.claimantLastName ?? "--"}    DOB ${date(f.dateOfBirth)}    Mbr# ${f.memberId ?? "--"}`,
    `Auth/Ref# ${f.referralNumber ?? "--"} (exp ${date(f.referralExpirationDate)})`,
    `DOS ${date(f.serviceDateFrom)}${f.serviceDateTo && f.serviceDateTo !== f.serviceDateFrom ? ` thru ${date(f.serviceDateTo)}` : ""}`,
    `Rendering: ${f.providerName ?? "--"} / NPI ${f.providerNpi ?? "--"} @ ${f.facilityName ?? "--"}`,
    `Dx ${f.diagnosisCode ?? "--"}  |  CPT ${f.procedureCode ?? "--"} ${f.serviceDescription ?? ""}`,
    `Charges ${f.billedAmount === null ? "--" : formatAmount(rng, f.billedAmount)}`,
    "",
    `Ref claim ${f.claimNumber ?? "--"}, sent ${date(f.submittedDate)}`,
  ];
}

const WATERMARK = "SYNTHETIC TEST DOCUMENT - NOT A REAL CLAIM - NO REAL PERSON OR PROVIDER";

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  if (!text) return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  lines.push(line);
  return lines;
}

export async function renderPdf(lines: string[], layout: Layout): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Synthetic claim (${layout})`);
  pdf.setProducer("claims-document-assistant synthetic generator");
  const font = await pdf.embedFont(layout === "note" ? StandardFonts.Courier : StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page: PDFPage = pdf.addPage([612, 792]);
  page.drawText(WATERMARK, { x: 50, y: 760, size: 8, font: bold, color: rgb(0.75, 0.1, 0.1) });
  let y = 720;
  const size = layout === "note" ? 9.5 : 11;
  for (const [i, raw] of lines.entries()) {
    const isHeading = i === 0 && layout !== "letter";
    for (const line of wrap(raw, font, size, 512)) {
      page.drawText(line, { x: 50, y, size: isHeading ? 13 : size, font: isHeading ? bold : font });
      y -= size + 6;
    }
  }
  page.drawText(WATERMARK, { x: 50, y: 30, size: 8, font: bold, color: rgb(0.75, 0.1, 0.1) });
  return pdf.save();
}

export interface GeneratedDocument {
  truth: GroundTruth;
  pdf: Uint8Array;
}

export async function generateDocument(seed: number, index: number, layout?: Layout): Promise<GeneratedDocument> {
  const rng = createRng(seed * 100003 + index);
  const chosenLayout = layout ?? rng.pick<Layout>(["form", "form", "letter", "note"]);
  const roll = rng.next();
  const scenario: GroundTruth["scenario"] = roll < 0.5 ? "complete" : roll < 0.8 ? "missing" : "invalid";
  const fields = applyScenario(rng, baseClaim(rng, index), scenario);
  const lines = chosenLayout === "form" ? formLines(rng, fields) : chosenLayout === "letter" ? letterLines(rng, fields) : noteLines(rng, fields);
  const expectedIssues = validateClaim(fields)
    .filter((issue: Issue) => issue.severity === "blocking")
    .map(({ code, field }) => ({ code, field }));
  const id = `claim-${String(index + 1).padStart(3, "0")}`;
  return {
    truth: { id, layout: chosenLayout, scenario, fields, expectedIssues },
    pdf: await renderPdf(lines, chosenLayout),
  };
}

export async function generateDataset(count: number, seed = 42): Promise<GeneratedDocument[]> {
  return Promise.all(Array.from({ length: count }, (_, i) => generateDocument(seed, i)));
}
