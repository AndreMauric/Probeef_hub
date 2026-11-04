// Semi Confinamento: cálculo da ferramenta, tradução do app "Semi Confinamento Probeef" do Power Apps
// (telas Formulação, DI_zoo, DI_Eco, Lotação, Resultados e Análise de Risco). Compara três produtos
// (formulações) lado a lado. Os arredondamentos do app foram mantidos (peso de carcaça, @ produzidas,
// lotação, custo por dia) para os números baterem com os dele. Correções em relação ao app estão
// marcadas com "Corrigido" e explicadas na aba "Como funciona".

export const N_ING = 8;
export const N_PROD = 3;
const DIAS_MES = 30.4;
const UA_KG = 450;

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(v) ? v : 0);
const div = (a, b) => (b ? a / b : null);

// ---------- Tabelas do app (App.OnStart) ----------

export const ESPECIES = [
  { nome: 'MG-5/Mavuno', base: 14800, aguas: 0.7, seca: 0.3, eun: 40 },
  { nome: 'Marandú/Piatã', base: 12300, aguas: 0.68, seca: 0.32, eun: 33 },
  { nome: 'Decumbens', base: 9200, aguas: 0.65, seca: 0.35, eun: 25 },
  { nome: 'Humidícola', base: 7500, aguas: 0.6, seca: 0.4, eun: 23 },
  { nome: 'Mombaça/Paredão', base: 17200, aguas: 0.8, seca: 0.2, eun: 60 },
  { nome: 'Tanzânia/Zuri', base: 16000, aguas: 0.8, seca: 0.2, eun: 50 },
  { nome: 'Massai/Tamani', base: 15700, aguas: 0.8, seca: 0.2, eun: 50 },
  { nome: 'Andropogon', base: 11000, aguas: 0.85, seca: 0.15, eun: 30 },
  { nome: 'Tifton', base: 17600, aguas: 0.65, seca: 0.35, eun: 60 },
];
export const FERTILIDADE = [
  ['Muito Alta', 1.1],
  ['Alta', 1.0],
  ['Média', 0.82],
  ['Baixa', 0.66],
  ['Muito Baixa', 0.5],
];
export const MANEJO = [
  ['Contínuo', 0.47],
  ['Alternado', 0.52],
  ['Rotação s/ adubação', 0.55],
  ['Rotação c/ adubação', 0.6],
];
// Fator de lotação por nível de suplementação (águas, seca).
export const SUPLEMENTACAO = [
  ['Energético 0,8%', 1.4, 1.25],
  ['Ração 1%', 1.6, 1.4],
  ['Ração 1,5%', 2.0, 2.0],
  ['Ração 2,0%', 3.0, 2.5],
];
export const QUALIDADES = ['ALTA', 'MÉDIA', 'BAIXA'];
export const CONSUMOS = [1, 1.5, 2]; // consumo de MN do concentrado, % do PV
// GMD previsto (macho inteiro) pela qualidade do pasto e consumo do concentrado.
const DESEMPENHO = {
  ALTA: { 1: 1.29, 1.5: 1.33, 2: 1.47 },
  MÉDIA: { 1: 1.2, 1.5: 1.31, 2: 1.46 },
  BAIXA: { 1: 1.08, 1.5: 1.24, 2: 1.43 },
};
export const desempenhoSugerido = (qualidade, cmn) => DESEMPENHO[qualidade]?.[cmn] ?? null;

// ---------- Valores iniciais (os do app) ----------

export function defaultData() {
  const ing = [
    ['Milho', 1250],
    ['Sorgo', 0],
    ['Farelo de Soja', 0],
    ['DDGs', 1600],
    ['Torta de Algodão', 0],
    ['Probeef Semi', 0],
    ['Probeef Máxima Control', 5200],
    ['Uréia', 4500],
  ].map(([nome, preco]) => ({ nome, preco }));
  const incl = [
    [70, 0, 0, 22, 0, 0, 6, 2],
    [76, 0, 0, 18, 0, 0, 4.5, 1.5],
    [81, 0, 0, 15, 0, 0, 3, 1],
  ];
  // O app vinha com 2,0% / 1,5% / 2,0% de consumo, mas o GMD padrão (1,20 / 1,31 / 1,46) é o da tabela para
  // 1,0% / 1,5% / 2,0% (pasto MÉDIO): usamos esses, que batem com os nomes dos produtos.
  const zoo = [
    { cmn: 1, gmd: 1.2, lotUA: 3.06, rc: 55 },
    { cmn: 1.5, gmd: 1.31, lotUA: 3.83, rc: 55.5 },
    { cmn: 2, gmd: 1.46, lotUA: 5.74, rc: 56 },
  ];
  const nomes = ['Probeef Semi 1%', 'Probeef Semi 1,5%', 'TIP'];
  const prods = nomes.map((nome, i) => ({
    nome,
    incl: incl[i],
    custoProd: 0, // custo de produção da ração, R$/t
    n: 500,
    pi: 380,
    rci: 50,
    lotUA: zoo[i].lotUA,
    cmn: zoo[i].cmn,
    qualidade: 'MÉDIA',
    gmd: zoo[i].gmd,
    dias: 110,
    rc: zoo[i].rc,
    custoIni: 290, // R$/@
    frete: 50,
    comissao: 0,
    aluguel: 45, // R$/cab/mês
    sanitario: 10,
    rastreab: 0,
    operacional: 1, // R$/cab/dia
    venda: 280, // R$/@
    indea: 0,
    funrural: 0,
    comissaoVenda: 0,
    sacaMilho: 70,
    sacaSoja: 140,
    lot: { especie: ESPECIES[1].nome, fertilidade: 'Média', manejo: MANEJO[0][0], suplementacao: SUPLEMENTACAO[[1, 2, 3][i]][0], n: 0 },
  }));
  return {
    version: 1,
    cadastro: { proprietario: '', fazenda: '', dataVisita: new Date().toISOString().slice(0, 10), cidade: '', estado: '', nVisita: '', coordenador: '', telCoordenador: '', emailCoordenador: '', atc: '', telAtc: '', emailAtc: '' },
    ing,
    prods,
    risco: { passoCompra: 10, passoVenda: 5, passoMilho: 5, milho: 0 },
  };
}

// ---------- Formulação ----------

export function formula(p, ing) {
  const custoFormula = ing.reduce((s, x, j) => s + num(x.preco) * (num(p.incl[j]) / 100), 0); // R$/t
  const inclTotal = p.incl.reduce((s, v) => s + num(v), 0); // %
  const custoKg = (custoFormula + num(p.custoProd)) / 1000; // R$/kg
  return { custoFormula, inclTotal, custoKg };
}

// ---------- Lotação (tabela auxiliar) ----------

// UA/ha nas águas/transição e na seca: produção de forragem da espécie (+ resposta ao nitrogênio)
// × fertilidade × proporção da produção na época × eficiência de pastejo do manejo, ÷ 180 dias
// ÷ consumo da UA (450 kg × 2,3% nas águas, 2,0% na seca) × fator da suplementação.
export function lotacao(l) {
  const e = ESPECIES.find((x) => x.nome === l.especie);
  const fert = FERTILIDADE.find((x) => x[0] === l.fertilidade)?.[1];
  const man = MANEJO.find((x) => x[0] === l.manejo)?.[1];
  const sup = SUPLEMENTACAO.find((x) => x[0] === l.suplementacao);
  if (!e || !fert || !man || !sup) return { aguas: null, seca: null };
  const producao = (e.base + (num(l.n) > 0 ? num(l.n) * e.eun : 0)) * fert * man;
  return {
    aguas: round2(((producao * e.aguas) / 180 / (UA_KG * 0.023)) * sup[1]),
    seca: round2(((producao * e.seca) / 180 / (UA_KG * 0.02)) * sup[2]),
  };
}

// ---------- Resultado de um produto ----------

export function calc(p, ing) {
  const f = formula(p, ing);
  const dias = num(p.dias);
  const rci = num(p.rci) / 100;
  const rc = num(p.rc) / 100;

  // Zootécnico
  const pesoAbate = num(p.pi) + num(p.gmd) * dias;
  const pesoMedio = (num(p.pi) + pesoAbate) / 2;
  const arrobaIni = (num(p.pi) * rci) / 15;
  const pesoCarc = round2((pesoAbate * rc) / 15); // @
  const arrobaProd = round2(pesoCarc - arrobaIni);
  const lotHa = pesoMedio ? round2((num(p.lotUA) * UA_KG) / pesoMedio) : 0; // animais/ha
  const arrobaHa = round2(arrobaProd * lotHa);
  const cmnKg = round2(pesoMedio) * (num(p.cmn) / 100); // kg MN/cab/dia
  const sugerido = desempenhoSugerido(p.qualidade, p.cmn);

  // Custos de entrada e do dia
  const custoIniCab = round2(num(p.custoIni) * arrobaIni + num(p.frete) + num(p.comissao));
  // Corrigido: o app usava os dias do produto 2 no rateio do sanitário e da rastreabilidade do produto 3.
  const custoCabDia = dias ? round2(num(p.aluguel) / DIAS_MES + num(p.sanitario) / dias + num(p.rastreab) / dias + num(p.operacional)) : 0;
  // Corrigido: no app, o custo do concentrado do produto 1 vinha da tela de histórico (outra simulação).
  const custoAlimDia = round2(f.custoKg * cmnKg);
  const custoTotalDia = custoAlimDia + custoCabDia;
  const custoAlim = custoAlimDia * dias;
  const custoAlimOp = custoAlim + custoCabDia * dias;
  const taxas = num(p.indea) + num(p.funrural) + num(p.comissaoVenda);
  const custoTotal = custoAlimOp + custoIniCab + taxas;

  // Resultado
  const receita = round2(num(p.venda) * pesoCarc);
  const lucro = receita - custoTotal;
  const lucroHa = lucro * lotHa;
  const rentPeriodo = div(lucro, custoTotal);
  const rentMes = rentPeriodo === null || !dias ? null : rentPeriodo / (dias / DIAS_MES);
  return {
    ...f,
    pesoAbate,
    pesoMedio,
    arrobaIni,
    pesoCarc,
    arrobaProd,
    lotHa,
    arrobaHa,
    cmnKg,
    sugerido,
    custoIniCab,
    custoCabDia,
    custoAlimDia,
    custoTotalDia,
    custoAlim,
    custoAlimOp,
    custoArrobaAlim: div(custoAlim, arrobaProd),
    custoArroba: div(custoAlimOp, arrobaProd),
    taxas,
    custoTotal,
    custoTotalHa: custoTotal * lotHa,
    receita,
    lucro,
    lucroHa,
    rentPeriodo,
    rentMes,
    rentAno: rentMes === null ? null : rentMes * 12,
    equilibrio: div(custoTotal, pesoCarc), // preço de venda que zera o lucro, R$/@
    // Corrigido: o produto 3 usava o rendimento de entrada do produto 1.
    boiMagroMax: arrobaIni ? lucro / arrobaIni + num(p.custoIni) : null, // preço de compra que zera o lucro, R$/@
    sacasMilhoHa: div(lucroHa, num(p.sacaMilho)),
    sacasSojaHa: div(lucroHa, num(p.sacaSoja)),
  };
}

// Avisos de preenchimento (não impedem o cálculo).
export function avisos(p, ing) {
  const r = calc(p, ing);
  const out = [];
  if (Math.abs(r.inclTotal - 100) > 0.05) out.push(`A fórmula soma ${r.inclTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% (deveria somar 100%).`);
  if (!num(p.dias)) out.push('Número de dias zerado.');
  if (r.arrobaProd <= 0) out.push('Arrobas produzidas zeradas ou negativas: confira peso, GMD, dias e rendimentos.');
  if (!num(p.venda)) out.push('Sem preço de venda.');
  return out;
}

// ---------- Análise de risco (grades 5 × 5, lucro em R$/ha) ----------

const passos = (centro, passo) => [-2, -1, 0, 1, 2].map((k) => centro + k * num(passo));

// Valor de compra (R$/@) × valor de venda (R$/@).
// Corrigido: o app somava a comissão de venda duas vezes e deixava de fora a comissão de compra, então a
// célula do meio não batia com o lucro por hectare dos Resultados. Aqui ela bate.
export function gradeCompraVenda(p, ing, R) {
  const linhas = passos(num(p.custoIni), R.passoCompra);
  const colunas = passos(num(p.venda), R.passoVenda);
  const valores = linhas.map((compra) => colunas.map((venda) => calc({ ...p, custoIni: compra, venda }, ing).lucroHa));
  return { linhas, colunas, valores };
}

// Preço do milho (R$/saca de 60 kg) × valor de venda (R$/@). O milho é o ingrediente R.milho.
// Corrigido: o app deixava o custo de produção da ração de fora nessa grade.
export function gradeMilhoVenda(p, ing, R) {
  const j = R.milho;
  const saca = (num(ing[j]?.preco) / 1000) * 60;
  const linhas = passos(saca, R.passoMilho);
  const colunas = passos(num(p.venda), R.passoVenda);
  const valores = linhas.map((s) => {
    const ing2 = ing.map((x, k) => (k === j ? { ...x, preco: (s / 60) * 1000 } : x));
    return colunas.map((venda) => calc({ ...p, venda }, ing2).lucroHa);
  });
  return { linhas, colunas, valores, semMilho: !num(p.incl[j]) };
}
