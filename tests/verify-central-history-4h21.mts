/**
 * VERIFICAÇÃO — ETAPA 4H.2.1: REFINAMENTO DA CENTRAL DE HORAS —
 * REDUZIR REPETIÇÃO VISUAL DOS USOS [10+], SEM ALTERAR REGRAS,
 * CÁLCULOS OU PERSISTÊNCIA.
 *
 * A 4H.2 mostrava o mesmo uso [10+] em dois lugares visíveis:
 *   1. dentro da origem — "Destinos das horas desta origem" (mantido);
 *   2. na seção "Usos realizados" (cards verdes sempre expostos).
 *
 * A 4H.2.1 substitui a seção 2 por "Histórico de usos [10+] (N)":
 *   · recolhido por padrão (<details> sem open);
 *   · visão global/cronológica de consulta (secundária);
 *   · ao expandir, os MESMOS cards (destino, minutos, origem, estratégia,
 *     status, consolidado, link "Abrir em Registros", texto de projeção).
 *
 * Esta etapa é 100% UI/apresentação: nenhum motor, store, schema ou
 * persistência foi tocado (assertido estruturalmente em T08/T09).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-central-history-4h21.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const central = readFileSync(join(root, "src/app/(app)/compensacoes/page.tsx"), "utf8");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* Bloco de histórico: do comentário da 4H.2.1 até o </details> correspondente. */
const idxHist = central.indexOf("{/* Histórico de usos [10+]");
assert.ok(idxHist > 0, "bloco de histórico presente na página");
const histBlock = central.slice(idxHist, central.indexOf("</details>", idxHist) + 10);

check("T01 — não existe mais heading principal 'USOS REALIZADOS'", () => {
  assert.ok(!central.includes('aria-label="Usos realizados"'), "aria-label antigo removido");
  assert.ok(!central.includes(">Usos realizados</h3>"), "heading h3 'Usos realizados' removido");
  // O literal em minúsculas dentro da frase de estado vazio não é heading — aceitável.
  const headings = central.match(/<h3[^>]*>[^<]*Usos realizados[^<]*<\/h3>/g) ?? [];
  assert.equal(headings.length, 0, "nenhum h3 'Usos realizados' sobreviveu");
});

check("T02 — existe 'HISTÓRICO DE USOS [10+]' (maiusculado via CSS, como os demais títulos da Central)", () => {
  assert.ok(central.includes("Histórico de usos [10+]"), "título do bloco de histórico");
  const summary = histBlock.slice(histBlock.indexOf("<summary"), histBlock.indexOf("</summary>"));
  assert.ok(summary.includes("Histórico de usos [10+]"), "título dentro do <summary> (visão recolhida)");
  assert.ok(summary.includes("uppercase tracking-wider"), "renderização em maiúsculas consistente com a Central");
});

check("T03 — o histórico mostra a contagem de usos", () => {
  assert.ok(central.includes("Histórico de usos [10+] ({usos.length})"), "contagem (N) no título");
});

check("T04 — histórico está recolhido por padrão", () => {
  const detalhe = histBlock.slice(0, histBlock.indexOf("<summary"));
  assert.ok(detalhe.includes("<details className=\"rounded-2xl border border-slate-200 bg-white\">"), "<details> do padrão da Central (mesmo do bloco 'totalmente destinadas')");
  assert.ok(!detalhe.includes("open"), "SEM atributo open ⇒ recolhido por padrão");
});

check("T05 — enquanto recolhido, os cards detalhados não são a visualização principal", () => {
  const summary = histBlock.slice(histBlock.indexOf("<summary"), histBlock.indexOf("</summary>"));
  assert.ok(!summary.includes("bg-emerald-50"), "nenhum card verde exposto na visão recolhida");
  assert.ok(!summary.includes("usos.map"), "o mapa de cards NÃO ocorre dentro do <summary>");
  assert.ok(summary.includes("Consulte todas as utilizações realizadas."), "indicação discreta no lugar dos cards");
  const corpo = histBlock.slice(histBlock.indexOf("</summary>"));
  assert.ok(corpo.includes("usos.map((u) =>"), "cards continuam renderizados — apenas dentro do corpo (expansão)");
  assert.ok(corpo.includes("border-t border-slate-100"), "corpo separado visualmente do cabeçalho recolhido");
  assert.ok(!histBlock.includes("createSpecialExcessUse") && !histBlock.includes("cancelSpecialExcessPlan"), "nenhuma escrita de store no bloco — etapa é só apresentação");
});

check("T06 — ao expandir, preserva destino, minutos, origem e estratégia manual/automática", () => {
  const corpo = histBlock.slice(histBlock.indexOf("</summary>"));
  assert.ok(corpo.includes("{formatDateShortBR(u.destinationDate)} →"), "data do destino preservada");
  assert.ok(corpo.includes("formatMinutes(specialExcessUseMinutes(u))"), "minutos preservados (mesma fonte canônica)");
  assert.ok(corpo.includes("u.allocations.map((a, i) =>"), "origem(es) preservada(s) (allocations do uso)");
  assert.ok(corpo.includes("formatDateShortBR(a.originDate)"), "data de origem por alocação");
  assert.ok(corpo.includes("modoDaEstrategia(u.allocationStrategy)"), "estratégia: seleção manual/automática preservada");
});

check("T07 — preserva status/consolidado e link 'Abrir em Registros'", () => {
  const corpo = histBlock.slice(histBlock.indexOf("</summary>"));
  assert.ok(corpo.includes("STATUS_USO[u.status] ?? u.status"), "status do uso preservado");
  assert.ok(corpo.includes("consolidationLockForDate(periodConsolidations, u.destinationDate)"), "badge Consolidado (4G) preservado");
  assert.ok(corpo.includes(">Consolidado</span>"), "rotulo do badge intacto");
  assert.ok(corpo.includes("Link href={linkDia(u.destinationDate)}"), "link para o dia preservado");
  assert.ok(corpo.includes("Abrir em Registros"), "texto do link intacto");
  assert.ok(corpo.includes("uso é projeção oficial; não altera a jornada real nem o saldo factual"), "texto de projeção oficial preservado");
});

check("T08 — 'DESTINOS DAS HORAS DESTA ORIGEM' continua intacto", () => {
  assert.ok(central.includes("Destinos das horas desta origem ({lot.destinations.length + reservas.length})"), "subtítulo do bloco por origem com contagem");
  assert.ok(central.includes("lot.destinations.map((d) => destinoLine(d))"), "rastreabilidade por destino intacta (mesma linha)");
  // A visão por origem precede o histórico global e continua como <details> expansível:
  const idxOrigem = central.indexOf("Destinos das horas desta origem");
  assert.ok(idxOrigem > 0 && idxOrigem < idxHist, "bloco por origem antes do histórico global (ordem visual da 4H.2)");
  assert.ok(central.slice(idxOrigem - 300, idxOrigem).includes("<details"), "expansão por origem ainda é <details>");
});

check("T09 — 'RESERVAS EM ABERTO' permanece independente e intacto", () => {
  assert.ok(central.includes('<section aria-label="Reservas em aberto" className="space-y-2">'), "seção Reservas ainda é <section> própria");
  assert.ok(central.includes(">Reservas em aberto</h3>"), "heading de Reservas intacto");
  const idxReservas = central.indexOf('<section aria-label="Reservas em aberto"');
  assert.ok(idxReservas > 0 && idxReservas < idxHist, "Reservas fica fora (antes) do bloco de histórico — não foi misturada");
  assert.ok(!central.slice(idxReservas, idxReservas + 800).includes("Histórico de usos"), "histórico NÃO inserido dentro da seção de Reservas");
  // Etapa não virou "histórico geral de eventos": o histórico cancelado segue separado:
  assert.ok(central.includes("Histórico cancelado"), "Histórico cancelado permanece como bloco próprio");
});

check("T10 — mobile 320/360/412: sem overflow horizontal ou largura fixa no novo bloco", () => {
  assert.ok(!histBlock.includes("w-[") && !histBlock.includes("min-w-["), "nenhuma largura fixa (w-[…]) no bloco");
  assert.ok(!histBlock.includes("w-screen") && !histBlock.includes("overflow-x"), "nenhum vetor de scroll horizontal");
  // ORÇAMENTO 320px: página ≈ 32px de padding ⇒ 288px úteis. O summary é texto
  // fluído (quebra em múltiplas linhas: título + (N) + dica); os cards internos
  // empilham em coluna no mobile (flex-col) e o link ocupa a própria linha
  // (shrink-0, texto curto) — nada exige largura maior que o viewport.
  assert.ok(histBlock.includes("flex flex-col gap-2 rounded-2xl"), "cards empilham em coluna no mobile (sem estourar)");
  assert.ok(histBlock.includes("sm:flex-row sm:items-center sm:justify-between"), "linha lateral só a partir de sm");
  assert.ok(histBlock.includes("min-w-0"), "coluna de texto com min-w-0 (quebra correta)");
  assert.ok(histBlock.includes("text-sm font-bold text-emerald-900"), "linhas de uso legíveis (text-sm, não atenuadas no mobile)");
});

console.log(`\n4H.2.1 — ${passed}/10 verificações concluídas.`);
if (passed !== 10) process.exit(1);
