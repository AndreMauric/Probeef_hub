// Motor de cálculo da 3P · Predição de Desempenho a Pasto (Nutron/Cargill).
// Tradução fiel do app Shiny original (app.R): mesma equação de GMD, mesmas tabelas de produto e
// as mesmas contas econômicas, inclusive os arredondamentos. Puro (sem DOM), roda no navegador e
// no Node, para poder ser conferido contra os números do relatório gerado pelo R.

// ---------- Tabelas de produto (PB % e dose % do PV; GMD adicional em kg/dia por época) ----------

export const PRODUTOS = {
  'PROBEEF RECRIA': { pb: 0, dose: 0.025, adic: { aguas: 0 } },
  'PROBEEF NITRO': { pb: 25.8, dose: 0.025, adic: { trans: 0 } },
  'PROBEEF PASTO BOM CROMO': { pb: 0, dose: 0.05, adic: { aguas: 0.1 } },
  'PROBEEF TOPMOST': { pb: 0, dose: 0.05, adic: { aguas: 0.16 } },
  'PROBEEF TOPMOST RESIST': { pb: 0, dose: 0.05, adic: { aguas: 0.18 } },
  'PROBEEF TOPMOST NITRO': { pb: 27, dose: 0.05, adic: { trans: 0.08 } },
  'PROBEEF ILP': { pb: 0, dose: 0.05, adic: { aguas: 0.16, trans: 0.08, seca: 0.04 } },
  'PROBEEF PROTEIPEC': { pb: 30, dose: 0.1, adic: { trans: 0.08, seca: 0.04 } },
  'PROBEEF PROTEIPEC SECA': { pb: 45, dose: 0.1, adic: { seca: 0.08 } },
  'PROBEEF TOPMOST PROTEIPEC': { pb: 30, dose: 0.1, adic: { trans: 0.16, seca: 0.08 } },
  'PROBEEF TOPMOST PROTEIPEC SECA': { pb: 45, dose: 0.1, adic: { seca: 0.16 } },
  'PROBEEF PROTEIPEC ÁGUAS': { pb: 20, dose: 0.15, adic: { aguas: 0.1 } },
  'PROBEEF NUTRIPEC SPRINT': { pb: 35, dose: 0.2, adic: { aguas: 0.12, trans: 0.06, seca: 0.03 } },
  'PROBEEF BOIÃO': { pb: 25, dose: 0.3, adic: { trans: 0.08, seca: 0.04 } },
  'PROBEEF BOIÃO SECA': { pb: 35, dose: 0.3, adic: { seca: 0.08 } },
  'PROBEEF TOPMOST BOIÃO': { pb: 25, dose: 0.3, adic: { trans: 0.16, seca: 0.08 } },
  'PROBEEF TOPMOST BOIÃO SECA': { pb: 35, dose: 0.3, adic: { seca: 0.16 } },
  'PROBEEF ILP BOIÃO': { pb: 10, dose: 0.3, adic: { aguas: 0.16, trans: 0.16, seca: 0.08 } },
  'PROBEEF NUTRIPEC': { pb: 20, dose: 0.5, adic: { trans: 0.08, seca: 0.04 } },
  'PROBEEF SEMI RAÇÃO': { pb: 17, dose: 1, adic: { aguas: 0.1, trans: 0.1, seca: 0.1 } },
};

// Produtos oferecidos em cada época (mesma ordem das listas do app original).
export const OPCOES = {
  aguas: ['PROBEEF RECRIA', 'PROBEEF PASTO BOM CROMO', 'PROBEEF TOPMOST', 'PROBEEF TOPMOST RESIST', 'PROBEEF ILP', 'PROBEEF PROTEIPEC ÁGUAS', 'PROBEEF NUTRIPEC SPRINT', 'PROBEEF ILP BOIÃO', 'PROBEEF SEMI RAÇÃO'],
  transicao: ['PROBEEF NITRO', 'PROBEEF TOPMOST NITRO', 'PROBEEF ILP', 'PROBEEF PROTEIPEC', 'PROBEEF TOPMOST PROTEIPEC', 'PROBEEF NUTRIPEC SPRINT', 'PROBEEF BOIÃO', 'PROBEEF TOPMOST BOIÃO', 'PROBEEF ILP BOIÃO', 'PROBEEF NUTRIPEC', 'PROBEEF SEMI RAÇÃO'],
  seca: ['PROBEEF ILP', 'PROBEEF PROTEIPEC', 'PROBEEF PROTEIPEC SECA', 'PROBEEF TOPMOST PROTEIPEC', 'PROBEEF TOPMOST PROTEIPEC SECA', 'PROBEEF NUTRIPEC SPRINT', 'PROBEEF BOIÃO', 'PROBEEF BOIÃO SECA', 'PROBEEF TOPMOST BOIÃO', 'PROBEEF TOPMOST BOIÃO SECA', 'PROBEEF ILP BOIÃO', 'PROBEEF NUTRIPEC', 'PROBEEF SEMI RAÇÃO'],
};

export const PASTOS = { Decumbens: -0.0957, 'Brizantha/Panicum': 0, Cynodon: 0.0103 };
export const SEXOS = { Macho: 0.151, Fêmea: 0 };
export const GPD_RANGE = 0.153; // faixa de variação esperada mostrada abaixo do GPD

export const EPOCAS = { AGUAS1: 'Águas 1°s', TRANS: 'Transição', SECA: 'Seca', AGUAS2: 'Águas 2°s' };

// ---------- Valores padrão (os mesmos do app original) ----------

const isoDay = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000));

export function cenarioPadrao(hoje = isoDay(new Date()), variante = 1) {
  return {
    pesoEntrada: 200,
    animais: 1000,
    dataEntrada: hoje,
    dataSaida: addDays(hoje, 365),
    transicao: { usar: true, de: 3, ate: 5 },
    seca: { usar: true, de: 6, ate: 10 },
    area: 150,
    sexo: 'Macho',
    standard: { aguas: 1, transicao: 1, seca: 1 },
    pasto: 'Brizantha/Panicum',
    pb: { aguas: 9, transicao: 6, seca: 3 },
    produto:
      variante === 1
        ? { aguas: 'PROBEEF TOPMOST RESIST', transicao: 'PROBEEF TOPMOST NITRO', seca: 'PROBEEF TOPMOST PROTEIPEC SECA' }
        : { aguas: 'PROBEEF PASTO BOM CROMO', transicao: 'PROBEEF NITRO', seca: 'PROBEEF PROTEIPEC SECA' },
    custo: { aguas: 1.7, transicao: 1.7, seca: 1.2 },
    econ: {
      compra: 1250,
      freteCompra: 0,
      comissao: 10,
      aluguelDia: 0.9,
      salario: 1500,
      animaisPorFuncionario: 3000,
      salgaDia: 0.05,
      sanitario: 10,
      rastreabilidade: 10,
      outros: 0,
      freteVenda: 0,
      valorVenda: 160,
    },
  };
}

// ---------- Calendário das épocas (monta_tabela_mensal do app original) ----------

// Seca tem prioridade sobre a Transição; depois do último mês de transição/seca vêm as "Águas 2°s".
export function epocasDoAno(c) {
  const epoca = Array(13).fill(EPOCAS.AGUAS1);
  const faixa = (r) => [Math.min(r.de, r.ate), Math.max(r.de, r.ate)];
  let ultimo = 0;
  if (c.transicao.usar) {
    const [a, b] = faixa(c.transicao);
    for (let m = 1; m <= 12; m++) if (m >= a && m <= b) epoca[m] = EPOCAS.TRANS;
    ultimo = Math.max(ultimo, b);
  }
  if (c.seca.usar) {
    const [a, b] = faixa(c.seca);
    for (let m = 1; m <= 12; m++) if (m >= a && m <= b) epoca[m] = EPOCAS.SECA;
    ultimo = Math.max(ultimo, b);
  }
  if (ultimo > 0) for (let m = ultimo + 1; m <= 12; m++) epoca[m] = EPOCAS.AGUAS2;
  return epoca;
}

export function sobreposicao(c) {
  if (!c.transicao.usar || !c.seca.usar) return false;
  const [t1, t2] = [Math.min(c.transicao.de, c.transicao.ate), Math.max(c.transicao.de, c.transicao.ate)];
  const [s1, s2] = [Math.min(c.seca.de, c.seca.ate), Math.max(c.seca.de, c.seca.ate)];
  return t1 <= s2 && s1 <= t2;
}

const chave = (epoca) => (epoca === EPOCAS.SECA ? 'seca' : epoca === EPOCAS.TRANS ? 'transicao' : 'aguas');
const chaveAdic = (epoca) => (epoca === EPOCAS.SECA ? 'seca' : epoca === EPOCAS.TRANS ? 'trans' : 'aguas');

// ---------- Simulação ----------

const r = (v, d) => {
  if (!Number.isFinite(v)) return v;
  const f = 10 ** d;
  return Math.round(v * f + (v >= 0 ? 1e-9 : -1e-9)) / f;
};

export function validar(c) {
  const erros = [];
  const dias = Math.round((Date.parse(c.dataSaida) - Date.parse(c.dataEntrada)) / 86400000);
  if (!(c.pesoEntrada > 0)) erros.push('Informe o peso de entrada.');
  if (!(dias >= 2)) erros.push('A data de saída precisa ser pelo menos 2 dias depois da entrada.');
  if (dias > 1100) erros.push('Use um período de até 3 anos.');
  if (!(c.area > 0)) erros.push('Informe a área em hectares.');
  if (!(c.animais > 0)) erros.push('Informe o número de animais.');
  if (!(c.econ.animaisPorFuncionario > 0)) erros.push('Informe quantos animais cada funcionário cuida.');
  for (const k of ['aguas', 'transicao', 'seca']) if (!PRODUTOS[c.produto[k]]) erros.push('Escolha os produtos de cada época.');
  return [...new Set(erros)];
}

// Projeção diária (dados3/dados4 do app original) + resumo por época e indicadores finais.
export function simular(c) {
  const tempo = Math.round((Date.parse(c.dataSaida) - Date.parse(c.dataEntrada)) / 86400000);
  const calendario = epocasDoAno(c);
  const e = c.econ;
  const sexo = SEXOS[c.sexo] ?? 0;
  const pasto = PASTOS[c.pasto] ?? 0;
  const salarioDia = e.salario / 30.4 / e.animaisPorFuncionario;
  const custoFixoCab = e.freteCompra + e.comissao + e.sanitario + e.rastreabilidade + e.outros + e.freteVenda; // custo_total3
  const arrobasEntrada = (c.pesoEntrada * 0.5) / 15;

  const dias = [];
  let peso = c.pesoEntrada; // PMi[i]: peso no início do dia i
  let custoSuplAcum = 0;
  let apa = 0;
  let consAcum = 0;
  for (let i = 1; i <= tempo; i++) {
    const data = addDays(c.dataEntrada, i);
    const mes = Number(data.slice(5, 7));
    const ano = data.slice(0, 4);
    const epoca = calendario[mes];
    const k = chave(epoca);
    const produto = c.produto[k];
    const p = PRODUTOS[produto] || { pb: 0, dose: 0, adic: {} };
    const pbPasto = c.pb[k];
    const custoKg = c.custo[k];
    const standard = c.standard[k];
    const seca = epoca === EPOCAS.SECA;

    const pesoDia = peso;
    const gpd = i === 1 ? 0 : pesoDia - dias[i - 2].peso;
    const gmd = (-0.2195 + 0.000647 * pesoDia + 0.0517 * pbPasto + 0.279 * p.dose + 0.0022 * p.pb + sexo + (seca ? -0.133 : 0) + pasto + p.dose * (seca ? 1 : 0) * 0.128) * standard;
    const adic = p.adic[chaveAdic(epoca)] || 0;
    peso = pesoDia + gmd + adic;

    const consumo = (pesoDia * p.dose) / 100;
    const custoSupl = consumo * custoKg;
    custoSuplAcum += custoSupl;
    consAcum += consumo;
    apa += (gpd * 0.5) / 15;
    const arrobas = (pesoDia * 0.5) / 15;
    const custoTotal = e.compra + custoFixoCab + e.aluguelDia * i + e.salgaDia * i + salarioDia * i + custoSuplAcum;
    const margem = arrobas * e.valorVenda - custoTotal;
    dias.push({
      i,
      data,
      ano,
      epoca,
      ref: `${epoca} / ${ano}`,
      produto,
      peso: pesoDia,
      gpd,
      consumo,
      custoSupl,
      custoSuplAcum,
      consAcum,
      apa,
      custoTotal,
      custoTotal2: e.aluguelDia + e.salgaDia + custoSupl + salarioDia,
      custoArrobaAcum: custoTotal - e.compra, // custo_arrob do dados4
      custoArrobaProd: (custoTotal - e.compra) / (arrobas - arrobasEntrada), // custo_arrob do dados3
      margem,
      margemHa: (margem * c.animais) / c.area,
      rent: ((margem / custoTotal) * 100 / tempo) * 30.42,
    });
  }

  // Resumo por "Época / Ano" (ddply do app original), ordenado pelo último dia de cada grupo.
  const grupos = new Map();
  for (const d of dias) {
    if (!grupos.has(d.ref)) grupos.set(d.ref, []);
    grupos.get(d.ref).push(d);
  }
  const max = (list, f) => Math.max(...list.map(f));
  const min = (list, f) => Math.min(...list.map(f));
  const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
  const epocas = [...grupos.entries()]
    .map(([ref, g]) => {
      const pMax = max(g, (d) => d.peso);
      const pMin = min(g, (d) => d.peso);
      return {
        ref,
        epoca: g[0].epoca,
        produto: g[0].produto,
        data: g.at(-1).data,
        diasAcum: max(g, (d) => d.i),
        dias: max(g, (d) => d.i) - min(g, (d) => d.i) + 1,
        peso: r(pMax, 2),
        gmd: r(sum(g, (d) => d.gpd) / g.length, 3),
        arrobasProd: r((pMax * 0.5 - pMin * 0.5) / 15, 2),
        arrobasProdAcum: r(max(g, (d) => d.apa), 1),
        consSuplDia: r(sum(g, (d) => d.consumo) / g.length, 3),
        consSuplTotal: r(sum(g, (d) => d.consumo), 2),
        custoSuplDia: r(sum(g, (d) => d.custoSupl) / g.length, 3),
        custoSuplAcum: r(max(g, (d) => d.custoSuplAcum), 2),
        custoArrobaProd: r((sum(g, (d) => d.custoTotal2) + custoFixoCab) / ((pMax - pMin) / 30), 1),
        custoArrobaProdAcum: r(max(g, (d) => d.custoArrobaAcum) / max(g, (d) => d.apa), 1),
        margemHa: r(max(g, (d) => d.margemHa), 2),
        rentabilidade: r(max(g, (d) => d.rent), 2),
      };
    })
    .sort((a, b) => a.diasAcum - b.diasAcum);

  const ultimo = dias.at(-1);
  const gpd = r((ultimo.peso - c.pesoEntrada) / tempo, 3);
  return {
    tempo,
    dias,
    epocas,
    kpis: {
      pesoInicial: c.pesoEntrada,
      gpd,
      gpdMin: r(gpd - GPD_RANGE, 3),
      gpdMax: r(gpd + GPD_RANGE, 3),
      pesoFinal: r(ultimo.peso, 1),
      ganhoTotal: r(ultimo.peso - c.pesoEntrada, 1),
      custoArrobaProd: r(ultimo.custoArrobaProd, 1),
      margemCab: r(ultimo.margem, 1),
      custoTotalArroba: r(ultimo.custoTotal / (ultimo.peso / 30), 1),
      arrobasHa: r(((r(ultimo.peso, 2) - c.pesoEntrada) * c.animais) / 30 / c.area, 1),
      margemHa: r(ultimo.margemHa, 1),
      rentabilidade: r(ultimo.rent, 3),
    },
    produtos: [...new Map(epocas.map((x) => [x.epoca, x.produto])).entries()].map(([epoca, produto]) => ({ epoca, produto })),
  };
}

// Linhas da tabela comparativa por época (dados_combinados do app original).
export const VARIAVEIS = [
  ['dias', 'Dias'],
  ['peso', 'Peso (kg)'],
  ['gmd', 'GMD (kg)'],
  ['arrobasProd', '@ Prod.'],
  ['arrobasProdAcum', '@ Prod. Acum.'],
  ['consSuplDia', 'Cons. Supl. (kg/d)'],
  ['consSuplTotal', 'Cons. Supl. Total (kg)'],
  ['custoSuplDia', 'Custo Supl. (R$/cab./d)'],
  ['custoSuplAcum', 'Custo Supl. Acum. (R$/cab.)'],
  ['custoArrobaProd', 'Custo @ Prod. (R$)'],
  ['custoArrobaProdAcum', 'Custo @ Prod. Acum. (R$)'],
];

export function comparar(s1, s2) {
  const refs = [...new Set([...s1.epocas.map((e) => e.ref), ...s2.epocas.map((e) => e.ref)])];
  return refs.map((ref) => ({ ref, c1: s1.epocas.find((e) => e.ref === ref) || null, c2: s2.epocas.find((e) => e.ref === ref) || null }));
}
