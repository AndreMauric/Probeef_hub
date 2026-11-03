// 4M Fornecedores: resultado econômico e risco por fornecedor a partir do desempenho observado
// (planilha com média e CV de cada medida por fornecedor). Roda no navegador e no Node (testes).
// As contas econômicas seguem as do 4M Confinamento (public/confinamento/calc.js), com três
// diferenças documentadas em "Como funciona": a dieta de adaptação só vale nos dias de adaptação,
// o alimento dos animais mortos usa o custo alimentar do próprio fornecedor (no 4M é 455 fixo)
// e o custo total do Boi Próprio não soma esse alimento duas vezes.

export const MODELS = [
  { id: 'bp', name: 'Boi Próprio' },
  { id: 'b', name: 'Boitel' },
  { id: 'ap', name: 'Arrobas Produzidas' },
  { id: 'p', name: 'Parceria' },
];

// Medidas da planilha. `sampled`: sorteada na análise de risco (GDC e @ produzidas saem da conta).
export const MEASURES = [
  { key: 'pe', label: 'Peso de entrada', unit: 'kg', dec: 1, sampled: true },
  { key: 'gmd', label: 'GMD', unit: 'kg/dia', dec: 3, sampled: true },
  { key: 'gdc', label: 'GDC', unit: 'kg/dia', dec: 3, sampled: false },
  { key: 'rc', label: 'Rendimento de carcaça', unit: '%', dec: 2, sampled: true },
  { key: 'arrobas', label: '@ produzidas', unit: '@/cab.', dec: 3, sampled: false },
  { key: 'dias', label: 'Dias de confinamento', unit: 'dias', dec: 1, sampled: true },
  { key: 'cms', label: 'CMS', unit: 'kg MS/dia', dec: 2, sampled: true },
];

// ---------- Leitura da planilha ----------

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// Qual medida um título de coluna representa. CV = começa com "cv" ou fala em "coeficiente".
function headerKey(title) {
  const t = norm(title);
  if (!t) return null;
  const cv = /^cv\b|coeficiente/.test(t);
  let key = null;
  if (/fornecedor|produtor|origem/.test(t) && !cv) key = 'nome';
  else if (/cabecas|^n\b|animais/.test(t) && !cv) key = 'n';
  else if (/peso de entrada|peso entrada|^pe\b/.test(t.replace(/^cv /, ''))) key = 'pe';
  else if (/\bgmd\b|ganho medio diario/.test(t)) key = 'gmd';
  else if (/\bgdc\b|ganho de carcaca/.test(t)) key = 'gdc';
  else if (/rendimento|\brc\b/.test(t)) key = 'rc';
  else if (/arrobas|@ prod/.test(t)) key = 'arrobas';
  else if (/dias/.test(t)) key = 'dias';
  else if (/\bcms\b|consumo|materia seca/.test(t)) key = 'cms';
  if (!key) return null;
  if (key === 'nome' || key === 'n') return { key, cv: false };
  // CMS em % do peso vivo quando o título fala em PV (o "(%)" do CV não conta).
  const pctPV = key === 'cms' && !cv && /\bpv\b|peso vivo/.test(t);
  return { key, cv, pctPV };
}

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  // "1,061" (milhar) e "1.209" (decimal) como o Excel exporta; "1.234,5" e "54,88" no formato brasileiro.
  let t = s.replace(/\s/g, '');
  if (/^-?\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, '');
  else if (/,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// rows: matriz (primeira linha = títulos), como sheet_to_json(header: 1) devolve. unidade = nome da aba.
export function parseSheet(rows, unidade) {
  const head = rows[0] || [];
  const cols = head.map(headerKey);
  const found = new Set(cols.filter(Boolean).map((c) => c.key));
  const missing = ['nome', 'pe', 'gmd', 'rc', 'dias'].filter((k) => !found.has(k));
  if (missing.length) return { unidade, suppliers: [], error: `Aba "${unidade}": faltam as colunas ${missing.join(', ')}.` };
  const cmsPctPV = cols.some((c) => c?.key === 'cms' && !c.cv && c.pctPV);
  const suppliers = [];
  for (const row of rows.slice(1)) {
    const s = { unidade, nome: '', n: null, cmsPctPV };
    for (const m of MEASURES) s[m.key] = { m: null, cv: null };
    cols.forEach((c, i) => {
      if (!c) return;
      if (c.key === 'nome') s.nome = String(row[i] ?? '').trim();
      else if (c.key === 'n') s.n = toNumber(row[i]);
      else s[c.key][c.cv ? 'cv' : 'm'] = toNumber(row[i]);
    });
    if (!s.nome) continue;
    s.id = `${unidade}|${s.nome}`;
    s.alertas = alertasDe(s);
    suppliers.push(s);
  }
  return { unidade, suppliers, error: null, hasCms: found.has('cms'), cmsPctPV };
}

// Linhas com dados que não fazem sentido (ficam desmarcadas por padrão, a pessoa decide).
export function alertasDe(s) {
  const a = [];
  if (!(s.pe.m > 100)) a.push('peso de entrada abaixo de 100 kg');
  if (!(s.gmd.m > 0)) a.push('GMD zero ou vazio');
  if (s.gdc.m !== null && !(s.gdc.m > 0)) a.push('GDC zero');
  if (!(s.rc.m >= 40 && s.rc.m <= 70)) a.push('rendimento fora de 40–70%');
  if (!(s.dias.m >= 30 && s.dias.m <= 300)) a.push('dias fora de 30–300');
  if (s.n !== null && s.n < 10) a.push('menos de 10 cabeças');
  if (s.cms.m !== null) {
    const pv = (s.pe.m + s.pe.m + s.gmd.m * s.dias.m) / 2;
    const pct = s.cmsPctPV ? s.cms.m : (s.cms.m / pv) * 100;
    if (!(s.cms.m > 0)) a.push('CMS zero');
    else if (pv > 0 && !(pct >= 1.5 && pct <= 3.5)) a.push(`CMS de ${pct.toFixed(2).replace('.', ',')}% do PV (fora de 1,5–3,5%)`);
  }
  for (const m of MEASURES) if (m.sampled && s[m.key].m !== null && s[m.key].cv === null) a.push(`sem CV de ${m.label}`);
  return a;
}

// Desvio padrão (o "standard") = média × CV.
export const sdOf = (x) => (x.m === null || x.cv === null ? null : (x.m * x.cv) / 100);

// ---------- Econômico (por cabeça, na saída do lote) ----------

export function defaultEcon() {
  return {
    rci: 50, // rendimento de carcaça na entrada (%): a planilha usa 50% nas @ produzidas
    cmsPctPV: 2.3, // só quando a planilha não tem CMS: % do peso vivo médio
    precoCompra: 310, // R$/@ boi magro
    precoVenda: 320, // R$/@ boi gordo
    bonus: 0, // R$/@ na venda
    minDiasBonus: 0,
    custoOperacional: 2.5, // R$/cab./dia
    diasAdap: 21,
    dietaAdap: 900, // R$/t MS
    dietaTerm: 1000, // R$/t MS
    frete: 30, // R$/cab.
    quemFrete: 'Confinamento',
    processamento: 0,
    quemProc: 'Confinamento',
    sanitario: 20,
    comissao: 0, // compra do boi (só Boi Próprio)
    jurosAlim: false,
    financGado: false,
    taxa: 12, // % a.a.
    venda: 'vista', // 'vista' | '30'
    mortalidade: 0.5, // %
    pctAlimMortos: 50, // % do custo alimentar perdido com cada morto
    quemMort: 'Confinamento',
    diariaBoitel: 15, // R$/cab./dia
    valorArroba: 220, // R$/@ produzida
    bonusParceiro: 50, // % do bônus de venda que fica com o parceiro
  };
}

// z = { pe, gmd, rc, dias, cms } (cms em kg MS/dia; null usa o % do PV de E). model: bp|b|ap|p.
export function econ(z, E, model) {
  const dias = z.dias;
  const arEnt = (z.pe * E.rci) / 100 / 15;
  const ps = z.pe + z.gmd * dias;
  const arSai = (ps * z.rc) / 100 / 15;
  const arProd = arSai - arEnt;
  const cms = z.cms ?? (E.cmsPctPV / 100) * ((z.pe + ps) / 2);
  const dAdap = Math.min(dias, E.diasAdap);
  const custoAlim = (cms * dAdap * E.dietaAdap + cms * Math.max(0, dias - dAdap) * E.dietaTerm) / 1000;
  const fator = Math.pow(1 + E.taxa / 100, dias / 365) - 1;
  const jurAlim = E.jurosAlim ? custoAlim * fator : 0;
  const boiMagro = arEnt * E.precoCompra;
  const bp = model === 'bp';
  const jurGado = bp && E.financGado ? boiMagro * fator : 0;
  const oper = E.custoOperacional * dias;
  const vv = dias >= E.minDiasBonus ? E.bonus : 0;
  const mf = Math.min(E.mortalidade, 99) / 100;
  const perda = mf / (1 - mf); // mortos por animal vivo
  const mortTotal = perda * (boiMagro + custoAlim * (E.pctAlimMortos / 100));
  const de = (quem) => (bp ? 'Confinamento' : quem);
  const conf = (quem, v) => (de(quem) === 'Confinamento' ? v : 0);
  const parc = (quem, v) => (!bp && quem === 'Parceiro' ? v : 0);

  const custoProd = oper + custoAlim + jurAlim + jurGado + (bp ? E.comissao : 0) + conf(E.quemProc, E.processamento) + E.sanitario + conf(E.quemFrete, E.frete);
  const mortConf = conf(E.quemMort, mortTotal);
  const custoTotal = custoProd + mortConf + (bp ? boiMagro : 0);
  let receita;
  if (bp) receita = arSai * (E.precoVenda + vv);
  else if (model === 'b') receita = E.diariaBoitel * dias;
  else if (model === 'ap') receita = E.valorArroba * arProd;
  else receita = arProd * (E.precoVenda + vv) + arEnt * vv * (1 - E.bonusParceiro / 100);
  const lucro = receita - custoTotal;
  const meses = E.venda === 'vista' ? dias / 30 : (dias + 30) / 30;
  const confinamento = {
    custoAlim,
    jurAlim,
    jurGado,
    oper,
    custoProd,
    mortalidade: mortConf,
    boiMagro: bp ? boiMagro : 0,
    custoTotal,
    receita,
    lucro,
    rent: (lucro / custoTotal) * 100,
    rentMensal: (lucro / custoTotal) * 100 / meses,
    custoArroba: custoProd / arProd,
  };

  let parceiro = null;
  if (!bp) {
    const custoConf = receita; // o que o parceiro paga ao confinamento
    const custoTotalP = custoConf + parc(E.quemMort, mortTotal) + parc(E.quemFrete, E.frete) + parc(E.quemProc, E.processamento);
    const receitaP = arSai * (E.precoVenda + vv);
    const lucroP = receitaP - custoTotalP - boiMagro;
    parceiro = {
      custoConf,
      boiMagro,
      custoTotal: custoTotalP,
      receita: receitaP,
      lucro: lucroP,
      rent: (lucroP / (custoTotalP + boiMagro)) * 100,
      rentMensal: (lucroP / (custoTotalP + boiMagro)) * 100 / meses,
      custoArroba: custoTotalP / arProd,
    };
  }
  return { arEnt, ps, arSai, arProd, cms, confinamento, parceiro };
}

// Valores médios do fornecedor (CMS da planilha quando existe; em % do PV convertido para kg).
export function meanZ(s) {
  const z = { pe: s.pe.m, gmd: s.gmd.m, rc: s.rc.m, dias: s.dias.m, cms: null };
  if (s.cms.m !== null) z.cms = s.cmsPctPV ? (s.cms.m / 100) * ((z.pe + z.pe + z.gmd * z.dias) / 2) : s.cms.m;
  return z;
}

// Média ponderada pelas cabeças (sem N, peso 1).
export function weighted(list, get) {
  let sw = 0;
  let sv = 0;
  for (const s of list) {
    const v = get(s);
    if (v === null || !Number.isFinite(v)) continue;
    const w = s.n > 0 ? s.n : 1;
    sw += w;
    sv += w * v;
  }
  return sw ? sv / sw : null;
}

// ---------- Risco (Monte Carlo) ----------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normalSampler(rand) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

export function defaultRisk() {
  return {
    cvVenda: 5, // % de variação do preço de venda da @
    cvCompra: 5, // % do preço do boi magro
    corrPrecos: 0.7, // correlação entre compra e venda
    cvDieta: 8, // % do custo da dieta (adaptação e terminação juntas)
    cvOperacional: 5,
    limite: 0, // R$/cab.: probabilidade de o resultado ficar abaixo disso
    nSim: 5000,
    nivel: 'animal', // 'animal' (CV entre animais) | 'lote' (média do lote: CV ÷ √cabeças)
    perspectiva: 'confinamento',
  };
}

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const pearson = (x, y) => {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
};

// Simula um fornecedor. Medidas sorteadas: PE, GMD, RC, dias e CMS (cada uma normal com o próprio CV,
// cortada em ±4 DP e em valores possíveis); preços de compra e venda correlacionados; dieta e operacional.
// GDC e @ produzidas saem da conta, por isso o CV delas simulado é comparado com o da planilha.
export function simulate(s, E, model, R, seed = 20261103) {
  const rand = rng(seed);
  const normal = normalSampler(rand);
  const n = Math.max(100, Math.min(50000, Math.round(R.nSim)));
  const escala = R.nivel === 'lote' && s.n > 1 ? 1 / Math.sqrt(s.n) : 1;
  const base = meanZ(s);
  const sd = (x) => (x.cv === null ? 0 : (x.m * x.cv * escala) / 100);
  const draw = (mean, dp, min) => {
    const v = mean + dp * Math.max(-4, Math.min(4, normal()));
    return Math.max(min, v);
  };
  const r = Math.max(-0.99, Math.min(0.99, R.corrPrecos));
  const persp = model === 'bp' ? 'confinamento' : R.perspectiva;

  const lucro = new Float64Array(n);
  const arProd = new Float64Array(n);
  const gdc = new Float64Array(n);
  const inputs = { pe: new Float64Array(n), gmd: new Float64Array(n), rc: new Float64Array(n), dias: new Float64Array(n), cms: new Float64Array(n), venda: new Float64Array(n), compra: new Float64Array(n), dieta: new Float64Array(n) };
  for (let k = 0; k < n; k++) {
    const dias = Math.max(1, Math.round(draw(base.dias, sd(s.dias), 1)));
    const z = {
      pe: draw(base.pe, sd(s.pe), base.pe * 0.3),
      gmd: draw(base.gmd, sd(s.gmd), 0),
      rc: Math.min(75, draw(base.rc, sd(s.rc), 35)),
      dias,
      cms: base.cms === null ? null : draw(base.cms, s.cms.cv === null ? 0 : (base.cms * s.cms.cv * escala) / 100, 0.1),
    };
    const z1 = normal();
    const z2 = normal();
    const fVenda = 1 + (R.cvVenda / 100) * z1;
    const fCompra = 1 + (R.cvCompra / 100) * (r * z1 + Math.sqrt(1 - r * r) * z2);
    const fDieta = Math.max(0.2, 1 + (R.cvDieta / 100) * normal());
    const fOper = Math.max(0, 1 + (R.cvOperacional / 100) * normal());
    const Ek = { ...E, precoVenda: E.precoVenda * fVenda, precoCompra: E.precoCompra * fCompra, dietaAdap: E.dietaAdap * fDieta, dietaTerm: E.dietaTerm * fDieta, custoOperacional: E.custoOperacional * fOper };
    const out = econ(z, Ek, model);
    lucro[k] = (persp === 'parceiro' ? out.parceiro : out.confinamento).lucro;
    arProd[k] = out.arProd;
    gdc[k] = (out.arSai * 15 - (z.pe * E.rci) / 100) / dias;
    inputs.pe[k] = z.pe;
    inputs.gmd[k] = z.gmd;
    inputs.rc[k] = z.rc;
    inputs.dias[k] = dias;
    inputs.cms[k] = out.cms;
    inputs.venda[k] = Ek.precoVenda;
    inputs.compra[k] = Ek.precoCompra;
    inputs.dieta[k] = fDieta;
  }
  const sorted = Float64Array.from(lucro).sort();
  let soma = 0;
  let abaixo = 0;
  for (let k = 0; k < n; k++) {
    soma += lucro[k];
    if (lucro[k] < R.limite) abaixo += 1;
  }
  const media = soma / n;
  let sq = 0;
  for (let k = 0; k < n; k++) sq += (lucro[k] - media) ** 2;
  const dp = Math.sqrt(sq / (n - 1));
  const cvDe = (arr) => {
    let m = 0;
    for (const v of arr) m += v;
    m /= arr.length;
    let q = 0;
    for (const v of arr) q += (v - m) ** 2;
    return (Math.sqrt(q / (arr.length - 1)) / m) * 100;
  };
  // Sensibilidade: correlação de cada entrada sorteada com o resultado (quanto ela explica do risco).
  const sens = [
    ['pe', 'Peso de entrada'],
    ['gmd', 'GMD'],
    ['rc', 'Rendimento de carcaça'],
    ['dias', 'Dias de confinamento'],
    ['cms', 'CMS'],
    ['venda', 'Preço de venda'],
    ['compra', 'Preço de compra'],
    ['dieta', 'Custo da dieta'],
  ].map(([key, label]) => ({ key, label, r: pearson(inputs[key], lucro) }));
  return {
    n,
    media,
    dp,
    p5: quantile(sorted, 0.05),
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    probAbaixo: (abaixo / n) * 100,
    cvArrobasSim: cvDe(arProd),
    cvGdcSim: cvDe(gdc),
    sens,
    lucro,
  };
}
