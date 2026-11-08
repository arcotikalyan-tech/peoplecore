-- PeopleCore · Professional tax beyond Karnataka and Maharashtra (audit PAY-10).
--
-- A payslip's state comes from the employee's statutory profile or else their location, so any company with an office
-- in Delhi, Haryana or another state missing from the rule set had every payroll run blocked ("no professional tax
-- rules for state DL"). This adds:
--   * the states and UTs that levy no professional tax (STATES in @peoplecore/shared, less Chhattisgarh, Goa and
--     Jammu & Kashmir, where sources disagree): nothing to deduct;
--   * Andhra Pradesh and Telangana (nil to 15,000; 150 to 20,000; 200 above) and Gujarat (nil below 12,000; 200 from
--     12,000), the monthly slabs every source agreed on.
-- Other states still stop the payslip until their slabs are added (West Bengal changed its slabs in October 2026; Tamil
-- Nadu and Kerala charge by half-year and local body; Madhya Pradesh, Odisha, Bihar and Jharkhand go by annual salary).
-- Same values as packages/payroll/src/rules.ts, which must match. Still not professionally validated.

update public.statutory_rule_sets
   set rules = jsonb_set(rules, '{pt}', (rules -> 'pt') || $json${
     "AP": [{"min": 0, "max": 15000, "amount": 0}, {"min": 15001, "max": 20000, "amount": 150}, {"min": 20001, "max": null, "amount": 200}],
     "TS": [{"min": 0, "max": 15000, "amount": 0}, {"min": 15001, "max": 20000, "amount": 150}, {"min": 20001, "max": null, "amount": 200}],
     "GJ": [{"min": 0, "max": 11999, "amount": 0}, {"min": 12000, "max": null, "amount": 200}],
     "AN": [{"min": 0, "max": null, "amount": 0}], "AR": [{"min": 0, "max": null, "amount": 0}], "CH": [{"min": 0, "max": null, "amount": 0}], "DH": [{"min": 0, "max": null, "amount": 0}], "DL": [{"min": 0, "max": null, "amount": 0}], "HP": [{"min": 0, "max": null, "amount": 0}], "HR": [{"min": 0, "max": null, "amount": 0}], "LA": [{"min": 0, "max": null, "amount": 0}], "LD": [{"min": 0, "max": null, "amount": 0}], "RJ": [{"min": 0, "max": null, "amount": 0}], "UK": [{"min": 0, "max": null, "amount": 0}], "UP": [{"min": 0, "max": null, "amount": 0}]
   }$json$::jsonb),
       notes = coalesce(notes, '') || ' Professional tax added for AP, TS, GJ and the states that levy none (8 Nov 2026).'
 where code in ('IN_FY2025_26', 'IN_FY2026_27_PROVISIONAL');
