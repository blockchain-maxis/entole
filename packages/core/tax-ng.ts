/**
 * Personal income tax in Nigeria under the Nigeria Tax Act 2025, in force
 * from 1 January 2026. An estimate to plan with, not a filing.
 *
 * Bands, per year of taxable income (Fourth Schedule):
 *   first ₦800,000 at 0%, next ₦2,200,000 at 15%, next ₦9,000,000 at 18%,
 *   next ₦13,000,000 at 21%, next ₦25,000,000 at 23%, above ₦50,000,000 at 25%.
 * Checked against the Act's own text on 12 November 2026 (Act No. 7, Gazette
 * No. 117 Vol. 112, Fourth Schedule, s.58): "First N800,000 at 0%; Next
 * N2,200,000 at 15%; Next N9,000,000 at 18%; Next N13,000,000 at 21%; Next
 * N25,000,000 at 23%; and Above N50,000,000 at 25%."
 *
 * Eligible deductions before the bands (s.30(2)(a)): contributions under the
 * National Housing Fund, the National Health Insurance Scheme and the Pension
 * Reform Act, life assurance premiums, interest on a loan for an owner-occupied
 * home, and rent relief of 20% of annual rent paid, at most ₦500,000. A
 * resident is taxed on income wherever it arises (s.12), so a freelancer's
 * foreign client income is in. Research for a lawyer, not legal advice.
 */

export type TaxBand = { uptoMinor: number | null; rateBps: number };

const naira = (value: number) => value * 100;

export const NIGERIA_PIT_BANDS: readonly TaxBand[] = [
  { uptoMinor: naira(800_000), rateBps: 0 },
  { uptoMinor: naira(3_000_000), rateBps: 1500 },
  { uptoMinor: naira(12_000_000), rateBps: 1800 },
  { uptoMinor: naira(25_000_000), rateBps: 2100 },
  { uptoMinor: naira(50_000_000), rateBps: 2300 },
  { uptoMinor: null, rateBps: 2500 },
];

/** Read against the Act's Fourth Schedule on 12 November 2026. */
export const TAX_BANDS_CONFIRMED = true;

export const RENT_RELIEF_BPS = 2000;
export const RENT_RELIEF_MAX_MINOR = naira(500_000);

export type TaxEstimate = {
  yearlyIncomeMinor: number;
  reliefMinor: number;
  taxableMinor: number;
  yearlyTaxMinor: number;
  monthlyTaxMinor: number;
  /** Share of income that goes to tax, in basis points. */
  effectiveBps: number;
  /** The highest band this income reaches, in basis points. */
  topRateBps: number;
};

/** Integer kobo throughout: each band's tax is floored to the kobo. */
export function estimateIncomeTax(input: {
  yearlyIncomeMinor: number;
  yearlyRentMinor?: number;
  /** Pension, NHF, NHIS and life assurance paid in the year, as the person states them. */
  yearlyDeductionsMinor?: number;
}): TaxEstimate {
  const yearlyIncomeMinor = Math.max(0, Math.round(input.yearlyIncomeMinor));
  const reliefMinor = Math.min(RENT_RELIEF_MAX_MINOR, Math.floor(((input.yearlyRentMinor ?? 0) * RENT_RELIEF_BPS) / 10_000));
  const taxableMinor = Math.max(0, yearlyIncomeMinor - reliefMinor - Math.max(0, Math.round(input.yearlyDeductionsMinor ?? 0)));
  let tax = 0;
  let floor = 0;
  let topRateBps = 0;
  for (const band of NIGERIA_PIT_BANDS) {
    const ceiling = band.uptoMinor ?? Number.MAX_SAFE_INTEGER;
    if (taxableMinor <= floor) break;
    const inBand = Math.min(taxableMinor, ceiling) - floor;
    tax += Math.floor((inBand * band.rateBps) / 10_000);
    if (inBand > 0) topRateBps = band.rateBps;
    floor = ceiling;
  }
  return {
    yearlyIncomeMinor,
    reliefMinor,
    taxableMinor,
    yearlyTaxMinor: tax,
    monthlyTaxMinor: Math.floor(tax / 12),
    effectiveBps: yearlyIncomeMinor ? Math.round((tax * 10_000) / yearlyIncomeMinor) : 0,
    topRateBps,
  };
}
