// Calendário fictício embutido no Seed 3.1 — bancada permanente, sem importação manual.
import { buildCompanyCalendar, parseCompanyCalendarCsv, type CompanyCalendar } from "./company-calendar";
import type { WorkSettings } from "./types";

const SETTINGS: WorkSettings = {
  workStart: "08:00",
  workEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  maxDailyMinutes: 600,
  autoDeductLunch: true,
};

/** Timestamp estável — restore duas vezes produz o mesmo JSON. */
export const SEED_IMPORTED_AT = "2026-08-25T12:00:00.000Z";

/** Ciclo anual 01/05/2026 → 30/04/2027 (mesmo conteúdo do fixture fictício). */
const CSV_2026_2027 = `data;descricao;categoria;tratamento;horas_a_compensar;jornada_esperada_horas;observacao
2026-05-01;Dia do Trabalho;Feriado Nacional;ABONADO;0;0;
2026-05-04;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2026-05-10;Aniversário do SEBRAE/PA;Aniversário do SEBRAE/PA;ABONADO;0;0;
2026-06-04;Corpus Christi;Feriado Nacional;ABONADO;0;0;
2026-06-05;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2026-07-03;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2026-07-10;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2026-07-17;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2026-07-24;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2026-08-15;Adesão do Pará;Feriado Estadual/Municipal;ABONADO;0;0;
2026-08-25;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2026-09-07;Independência do Brasil;Feriado Nacional;ABONADO;0;0;
2026-10-12;N. Sra. Aparecida;Feriado Nacional;ABONADO;0;0;
2026-11-02;Finados;Feriado Nacional;ABONADO;0;0;
2026-11-15;Proclamação da República;Feriado Nacional;ABONADO;0;0;
2026-11-20;Dia da Consciência Negra;Feriado Nacional;ABONADO;0;0;
2026-11-27;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2026-12-21;Recesso Fim de Ano;Recesso Final de Ano;COMPENSAR;8;0;Recesso de final de ano: 8h a compensar.
2026-12-22;Recesso Fim de Ano;Recesso Final de Ano;COMPENSAR;8;0;Recesso de final de ano: 8h a compensar.
2026-12-24;Abonado;Abono;ABONADO;0;0;
2026-12-25;Natal;Feriado Nacional;ABONADO;0;0;
2026-12-28;Recesso Fim de Ano;Recesso Final de Ano;COMPENSAR;8;0;Recesso de final de ano: 8h a compensar.
2026-12-29;Recesso Fim de Ano;Recesso Final de Ano;COMPENSAR;8;0;Recesso de final de ano: 8h a compensar.
2026-12-30;Recesso Fim de Ano;Recesso Final de Ano;COMPENSAR;8;0;Recesso de final de ano: 8h a compensar.
2026-12-31;Abonado;Abono;ABONADO;0;0;
2027-01-01;Confraternização Universal;Feriado Nacional;ABONADO;0;0;
2027-01-04;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2027-01-18;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2027-01-20;São Sebastião;Feriado Estadual/Municipal;ABONADO;0;0;
2027-02-09;Carnaval;Feriado Nacional;ABONADO;0;0;
2027-02-10;Cinzas;Abono;ABONADO_PARCIAL;0;4;"Abono parcial 08:00-12:00; jornada regular 13:00-17:00."
2027-02-15;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2027-04-01;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2027-04-02;Paixão de Cristo;Feriado Nacional;ABONADO;0;0;
2027-04-04;Páscoa;Feriado Nacional;ABONADO;0;0;
2027-04-20;Compensado;Compensação 8 Horas;COMPENSAR;8;0;Folga com 8h a compensar.
2027-04-21;Tiradentes;Feriado Nacional;ABONADO;0;0;
`;

export function seedCompanyCalendars(): CompanyCalendar[] {
  const parsed = parseCompanyCalendarCsv(CSV_2026_2027, SETTINGS);
  if (!parsed.ok) throw new Error(`Seed calendar inválido: ${parsed.error}`);
  const cal = buildCompanyCalendar(parsed.entries);
  return [{ ...cal, importedAt: SEED_IMPORTED_AT }];
}
