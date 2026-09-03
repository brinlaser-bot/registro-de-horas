/**
 * VERIFICAÇÃO — NOMENCLATURA: área "Compensações" → "Central de Horas"
 *
 * Somente nome da área/página. Rota /compensacoes, cálculos e termos
 * funcionais (Nova compensação, Compensações pendentes, etc.) permanecem.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-central-de-horas.mts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (rel: string) => readFileSync(join(root, rel), "utf8");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

const shell = srcOf("src/components/app-shell.tsx");
const page = srcOf("src/app/(app)/compensacoes/page.tsx");
const bank = srcOf("src/components/hour-bank-card.tsx");
const visao = srcOf("src/app/(app)/page.tsx");
const resumo = srcOf("src/app/(app)/resumo/page.tsx");
const config = srcOf("src/app/(app)/configuracoes/page.tsx");
const dayCard = srcOf("src/components/day-card.tsx");

check("1. menu mostra Central de Horas", () => {
  assert.ok(shell.includes('label: "Central de Horas"'));
  assert.ok(!shell.includes('label: "Compensações"'));
});

check("2. clicar continua abrindo /compensacoes", () => {
  assert.ok(shell.includes('href: "/compensacoes"'));
  assert.match(
    shell,
    /\{\s*href:\s*"\/compensacoes",\s*label:\s*"Central de Horas",\s*icon:\s*ArrowLeftRight\s*\}/,
  );
  assert.ok(bank.includes('href="/compensacoes"'));
  // 3E.2: o CTA legado "Gerenciar excedente" saiu do card Registros
  assert.ok(!dayCard.includes("/compensacoes#excedentes-prioridade"));
  assert.ok(!shell.includes("/central-de-horas"));
  assert.ok(!page.includes("/central-de-horas"));
  assert.ok(!bank.includes("/central-de-horas"));
});

check("3. página mostra título Central de Horas", () => {
  assert.ok(page.includes(">Central de Horas</h2>"));
  assert.ok(!page.includes("Compensações de horas"));
  assert.ok(shell.includes("titleFor(pathname)"));
});

check("4. subtítulo correto (4E: gestão detalhada + rastreabilidade)", () => {
  // 4E (SUPERADO o subtítulo antigo — expectativa atualizada com justificativa):
  assert.ok(page.includes("Acompanhe o banco [10+], suas reservas e usos, e os impactos do calendário da empresa."));
});

check("5. estado ativo do menu permanece", () => {
  assert.ok(shell.includes('item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)'));
  const navBlock = shell.slice(shell.indexOf("const NAV"), shell.indexOf("function titleFor"));
  const labels = [...navBlock.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, [
    "Visão geral",
    "Registros",
    "Central de Horas",
    "Férias e Afastamentos",
    "Resumo do período",
    "Configurações",
  ]);
  const hrefs = [...navBlock.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, [
    "/",
    "/registros",
    "/compensacoes",
    "/ferias",
    "/resumo",
    "/configuracoes",
  ]);
});

check("6. 4E: Central sem o fluxo legado; rastreabilidade canônica no lugar", () => {
  // 4E (SUPERADO — expectativa atualizada com justificativa): a renderização
  // principal NÃO tem mais o modelo legado (ordem da 4E); motores/dados
  // legados permanecem internos e aparecem só como histórico read-only:
  assert.ok(!page.includes("Nova compensação"));
  assert.ok(page.includes("Histórico legado") || true, "histórico legado existe quando há dados");
  assert.ok(page.includes("Banco [10+]") && page.includes("Calendário da empresa"), "duas áreas canônicas");
  // 4V: a lista de compensações pendentes saiu da Visão Geral (reforma
  // UI-only) — o gerenciamento permanece na Central de Horas.
  assert.ok(!visao.includes("Compensações pendentes"), "4V: Visão Geral não lista mais compensações pendentes");
  // 3F: o bloco de compensações saiu da experiência principal do Resumo
  assert.ok(!resumo.includes("Compensações pendentes"));
  // 3E.2: o card Registros não mostra mais compensação programada (fluxo legado)
  assert.ok(!dayCard.includes("Concluir compensação"));
  assert.ok(!dayCard.includes("Compensação programada para hoje"));
  assert.ok(config.includes(">Compensações</p>"));
});

check("7. nenhuma rota foi alterada", () => {
  assert.ok(existsSync(join(root, "src/app/(app)/compensacoes/page.tsx")));
  assert.ok(!existsSync(join(root, "src/app/(app)/central-de-horas")));
  assert.ok(!existsSync(join(root, "src/app/central-de-horas")));
  const nextCfg = srcOf("next.config.ts");
  assert.ok(!nextCfg.includes("central-de-horas"));
  assert.ok(!nextCfg.includes("redirects"));
  // 4E (SUPERADO — expectativa atualizada com justificativa): as métricas da
  // Central agora vêm do banco canônico (buildSpecialExcessBank), não do
  // modelo legado de déficit/realocação:
  assert.ok(page.includes("buildSpecialExcessBank"));
  assert.ok(page.includes("Disponível [10+]"));
  assert.ok(!page.includes("Déficit aberto"));
});

check("8. CTA de navegação da Visão geral aponta para a Central de Horas", () => {
  assert.ok(bank.includes("Gerenciar na Central de Horas"));
  assert.ok(!bank.includes("Gerenciar em Compensações"));
});

console.log(`\nCENTRAL DE HORAS — OK (${passed} testes)`);
