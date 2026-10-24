import type { StructureFields } from "../lib/payroll";

export function toStructure(s: [number, number, number, number, number, string, string, string, string, string, string]): StructureFields {
  const y = (v: string) => v === "Yes";
  return {
    basic: s[0], hra: s[1], medical: 0, conveyance: s[2], mobile: 0, site_allowance: s[3], supervisor_allowance: s[4], overtime: 0,
    esi_applicable: y(s[5]), pf_applicable: y(s[6]), lwf_applicable: y(s[7]), bonus_applicable: y(s[8]),
    pt_applicable: y(s[9]), gratuity_applicable: y(s[10]),
  };
}
