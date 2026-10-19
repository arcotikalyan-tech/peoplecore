import { z } from 'zod';

/**
 * Statutory rules are DATA (ADR-010): effective-dated, versioned rule sets stored in the database and validated
 * against this schema before the engine uses them. Nothing statutory is a constant in the engine.
 *
 * Amounts are rupees per month unless stated; rates are fractions (0.12 = 12%).
 */
const slab = z.object({ upTo: z.number().positive().nullable(), rate: z.number().min(0).max(1) });
const ptSlab = z.object({
  min: z.number().min(0),             // monthly gross from (inclusive)
  max: z.number().positive().nullable(), // up to (inclusive); null = no upper bound
  amount: z.number().min(0),
  februaryAmount: z.number().min(0).optional(), // states that collect the balance of the annual cap in February
});

export const ruleSetSchema = z.object({
  pf: z.object({
    employeeRate: z.number().min(0).max(1),
    employerEpsRate: z.number().min(0).max(1),  // pension share of the employer's contribution
    employerTotalRate: z.number().min(0).max(1),
    edliRate: z.number().min(0).max(1),
    adminRate: z.number().min(0).max(1),
    wageCeiling: z.number().positive(),
    capAtCeiling: z.boolean(),
  }),
  esi: z.object({
    employeeRate: z.number().min(0).max(1),
    employerRate: z.number().min(0).max(1),
    grossCeiling: z.number().positive(), // eligibility: contracted monthly gross at or below this
  }),
  pt: z.record(z.string().regex(/^[A-Z]{2}$/), z.array(ptSlab).min(1)),
  incomeTax: z.object({
    regime: z.literal('new'),
    standardDeduction: z.number().min(0),
    slabs: z.array(slab).min(1),
    rebateIncomeLimit: z.number().min(0),  // section 87A: no tax up to this taxable income…
    marginalRelief: z.boolean(),           // …and, just above it, tax capped at the excess
    cessRate: z.number().min(0).max(1),
    surchargeThreshold: z.number().positive(), // the engine refuses to estimate above this (surcharge not modelled)
    /** The old regime, for employees who choose it in their declaration (exemptions and deductions apply). */
    oldRegime: z.object({
      standardDeduction: z.number().min(0),
      slabs: z.array(slab).min(1),
      rebateIncomeLimit: z.number().min(0),  // section 87A (old regime): no tax up to this taxable income
      marginalRelief: z.boolean(),
      cessRate: z.number().min(0).max(1),
    }).optional(),
    /** Annual caps on old-regime deductions (rupees). */
    deductionCaps: z.object({
      sec80C: z.number().min(0),          // 80C + 80CCC + 80CCD(1)
      sec80CCD1B: z.number().min(0),      // additional NPS
      sec80DSelf: z.number().min(0),
      sec80DSelfSenior: z.number().min(0),
      sec80DParents: z.number().min(0),
      sec80DParentsSenior: z.number().min(0),
      sec80TTA: z.number().min(0),
      sec24b: z.number().min(0),          // interest on a self-occupied home loan
    }).optional(),
  }),
});
export type RuleSet = z.infer<typeof ruleSetSchema>;

/**
 * FY 2025-26 values as understood when this was written (new tax regime from the Union Budget 2025, the old regime
 * with its usual deduction caps; EPF/ESI rates; Karnataka and Maharashtra professional tax). NOT professionally validated: the database marks rule sets
 * built from this as validated = false, and the app warns on every run until a professional signs one off.
 */
export const IN_FY2025_26: RuleSet = {
  pf: { employeeRate: 0.12, employerEpsRate: 0.0833, employerTotalRate: 0.12, edliRate: 0.005, adminRate: 0.005, wageCeiling: 15000, capAtCeiling: true },
  esi: { employeeRate: 0.0075, employerRate: 0.0325, grossCeiling: 21000 },
  pt: {
    KA: [{ min: 0, max: 24999, amount: 0 }, { min: 25000, max: null, amount: 200, februaryAmount: 300 }],
    MH: [{ min: 0, max: 7500, amount: 0 }, { min: 7501, max: 10000, amount: 175 }, { min: 10001, max: null, amount: 200, februaryAmount: 300 }],
  },
  incomeTax: {
    regime: 'new',
    standardDeduction: 75000,
    slabs: [
      { upTo: 400000, rate: 0 }, { upTo: 800000, rate: 0.05 }, { upTo: 1200000, rate: 0.1 }, { upTo: 1600000, rate: 0.15 },
      { upTo: 2000000, rate: 0.2 }, { upTo: 2400000, rate: 0.25 }, { upTo: null, rate: 0.3 },
    ],
    rebateIncomeLimit: 1200000,
    marginalRelief: true,
    cessRate: 0.04,
    surchargeThreshold: 5000000,
    oldRegime: {
      standardDeduction: 50000,
      slabs: [{ upTo: 250000, rate: 0 }, { upTo: 500000, rate: 0.05 }, { upTo: 1000000, rate: 0.2 }, { upTo: null, rate: 0.3 }],
      rebateIncomeLimit: 500000,
      marginalRelief: false,
      cessRate: 0.04,
    },
    deductionCaps: {
      sec80C: 150000, sec80CCD1B: 50000, sec80DSelf: 25000, sec80DSelfSenior: 50000, sec80DParents: 25000, sec80DParentsSenior: 50000,
      sec80TTA: 10000, sec24b: 200000,
    },
  },
};
