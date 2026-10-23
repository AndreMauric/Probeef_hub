// Motor de cálculo do 4M for Risk Management
// Porte fiel das fórmulas originais (R/Shiny) para JavaScript.
// Convenção: arrays são indexados em 0, onde índice i representa o dia de cocho (i+1).

const FATOR = 473 / 611;

function CMS(dia, pe, value) {
  return (
    value * 8.2485 * Math.exp(-0.00033 * dia) * (1 - Math.exp(-0.0609 * (dia + 4.6267))) +
    0.00964 * pe -
    0.00005 * pe * dia
  );
}

function GMD(PMe, ELg, stan, sexo) {
  const base = sexo === "Fêmea" ? 21.67 : 22.108;
  return base * Math.pow(PMe, -0.8287) * Math.pow(ELg, 1.105) * stan;
}

const MANT_TABLE = {
  "Bos taurus": 1 * 0.85 * 0.1,
  "Bos indicus": 0.9 * 0.85 * 0.1,
  "Cruzamento Industrial": 0.95 * 0.85 * 0.1,
  "Holandês": 1.2 * 0.85 * 0.1,
  "Cruzamento Leiteiro": 1.1 * 0.85 * 0.1,
};
function mant(raca) {
  return MANT_TABLE[raca];
}

function fatMant(func, ELma, ELmt, adap, dc) {
  return dc <= adap ? func / ELma : func / ELmt;
}

function fatorELg(ELa, ELt, adap, dc) {
  return dc <= adap ? ELa : ELt;
}

function PC(pv, gmd, gmdq, dc, dcq, value2, rciPct) {
  let pc =
    (-57.46336213 +
      0.64844138 * pv +
      3.36644 * gmd -
      2.5701984 * gmdq +
      0.11967186 * dc -
      0.0002824 * dcq) *
    value2;
  const minFrac = rciPct / 100;
  if (pc / pv < minFrac) pc = minFrac * pv;
  return pc;
}

// Aproximação da CDF normal padrão (Abramowitz & Stegun 7.1.26)
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function pnorm(x, mean, sd) {
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

// Gerador de normais via Box-Muller
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function normalSampler(rng) {
  let spare = null;
  return function () {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u1 = 0,
      u2 = 0;
    while (u1 === 0) u1 = rng();
    u2 = rng();
    const mag = Math.sqrt(-2 * Math.log(u1));
    spare = mag * Math.sin(2 * Math.PI * u2);
    return mag * Math.cos(2 * Math.PI * u2);
  };
}

const N_DAYS = 180;

function calibrate(I) {
  const PI = I.c2;
  const rci = I.a7;
  const adap = I.d1;
  const ELa = I.d3,
    ELt = I.d6,
    ELma = I.d2,
    ELmt = I.d5;
  const stanGMD = I.c6,
    stanRC = I.c7;
  const sexo = I.c1,
    raca = I.a1;

  // Calibração analítica do fator "xx" (equivalente ao optim() do R:
  // CMS é linear em "value", então a solução de mínimos quadrados é exata)
  let sumA = 0,
    sumB = 0;
  for (let d = 1; d <= I.c3; d++) {
    const A = 8.2485 * Math.exp(-0.00033 * d) * (1 - Math.exp(-0.0609 * (d + 4.6267)));
    const B = 0.00964 * PI - 0.00005 * PI * d;
    sumA += A;
    sumB += B;
  }
  const meanA = sumA / I.c3,
    meanB = sumB / I.c3;
  const xx = (I.c5 - meanB) / meanA;

  const PMi = new Array(N_DAYS + 1);
  const PMe = new Array(N_DAYS + 1);
  PMi[0] = PI;
  PMe[0] = PI * FATOR;
  const cms = [],
    cmsm = [],
    cmsg = [],
    ELg = [],
    gmd = [],
    pc = [];
  for (let i = 0; i < N_DAYS; i++) {
    const day = i + 1;
    cms[i] = CMS(day, PI, xx);
    cmsm[i] = Math.pow(PMi[i], 0.75) * fatMant(mant(raca), ELma, ELmt, adap, day);
    cmsg[i] = cms[i] - cmsm[i];
    ELg[i] = cmsg[i] * fatorELg(ELa, ELt, adap, day);
    gmd[i] = GMD(PMe[i], ELg[i], stanGMD, sexo);
    PMi[i + 1] = PMi[i] + gmd[i];
    PMe[i + 1] = PMi[i + 1] * FATOR;
    pc[i] = PC(PMi[i], gmd[i], gmd[i] * gmd[i], day, day * day, stanRC, rci);
  }
  const PM = PMi.slice(0, N_DAYS);
  const PMeArr = PMe.slice(0, N_DAYS);
  const RC = pc.map((v, i) => (v / PM[i]) * 100);

  const cmsa = [];
  {
    let running = 0;
    for (let i = 0; i < N_DAYS; i++) {
      running += cms[i];
      cmsa[i] = running;
    }
  }
  const gmda = [];
  {
    let running = 0;
    for (let i = 0; i < N_DAYS; i++) {
      running += gmd[i];
      gmda[i] = running;
    }
  }
  const eb = [0];
  for (let i = 1; i < N_DAYS; i++) {
    const x = (pc[i] - pc[0]) / 15;
    eb[i] = cmsa[i] / x;
  }
  const ca = cmsa.map((v, i) => v / gmda[i]);
  const cmsam = cmsa.map((v, i) => v / (i + 1));
  const gmdam = gmda.map((v, i) => v / (i + 1));

  return {
    N: N_DAYS,
    PI,
    rci,
    adap,
    xx,
    cms,
    cmsm,
    cmsg,
    ELg,
    gmd,
    pc,
    PM,
    PMe: PMeArr,
    RC,
    cmsa,
    gmda,
    eb,
    ca,
    cmsam,
    gmdam,
  };
}

function calibrationSummary(I, C) {
  const idx = I.c3 - 1;
  const cmsSlice = C.cms.slice(0, I.c3);
  const meanCMS = cmsSlice.reduce((a, b) => a + b, 0) / I.c3;
  const RCfinal = Math.round(C.RC[idx] * 100) / 100;
  const PMfinal = C.PM[idx];
  const GMDavg = (PMfinal - I.c2) / I.c3;
  const carcassGainAvg = (PMfinal * RCfinal) / 100 - (I.c2 * I.a7) / 100;
  return {
    cms: meanCMS,
    cmsPctPV: (meanCMS / ((I.c2 + PMfinal) / 2)) * 100,
    gmd: GMDavg,
    rc: RCfinal,
    carcassGain: carcassGainAvg / I.c3,
    finalWeight: PMfinal,
  };
}

// ---- Modelos de negócio ----

const ROLES = ["bp", "b", "ap", "p"];

function dailySeries(I, C, role, perspective) {
  const PI = I.c2,
    rci = I.a7,
    adap = I.d1;
  const Co = I.f3,
    Cda = I.d4,
    Cdt = I.d7,
    txaa = I.f7;
  const ja = I.f8,
    fg = I.f9,
    ven = I.f10;
  const pco = I.f1,
    pv = I.b0,
    bon = I.b1,
    minDC = I.b2;
  const cs = I.f5,
    co_com = I.f6;
  const n = I.a3,
    mort = I.m1;
  const valD = I.bp1,
    valAr = I.bp2,
    bonParc = I.bp3 / 100;

  const custoAlimMortConst = (455 * (I.m2 / 100) * n * (mort / 100)) / (n - (n * mort) / 100);
  const custoMortBaseConst = ((n * (mort / 100) * ((PI * rci) / 100)) / 15 * pco) / (n - (n * mort) / 100);

  let cf, cp;
  if (role === "bp") {
    cf = I.f2;
    cp = I.f4;
  } else if (perspective === "confinamento") {
    cf = I.f21 === "Confinamento" ? I.f2 : 0;
    cp = I.f41 === "Confinamento" ? I.f4 : 0;
  } else {
    cf = I.f21 === "Parceiro" ? I.f2 : 0;
    cp = I.f41 === "Parceiro" ? I.f4 : 0;
  }

  let custoMort;
  if (role === "bp") {
    custoMort = custoMortBaseConst + custoAlimMortConst;
  } else if (perspective === "confinamento") {
    custoMort = I.m11 === "Confinamento" ? custoMortBaseConst + custoAlimMortConst : 0;
  } else {
    custoMort = I.m11 === "Parceiro" ? custoMortBaseConst + custoAlimMortConst : 0;
  }

  const out = {
    diarias: [],
    custo_alim: [],
    jur_alim: [],
    jur_gado: [],
    cust_prod: [],
    custo_total: [],
    rec: [],
    lucro: [],
    rent: [],
    rent_m: [],
    vv: [],
    cf,
    cp,
    custoMort,
    custoAlimMortConst,
    custoMortBaseConst,
  };

  for (let i = 0; i < C.N; i++) {
    const day = i + 1;
    const diarias = day * Co;
    const custoAlim = ((day <= adap ? Cda : Cdt) / 1000) * C.cmsa[i];
    const jurAlim = ja === "Sim" ? custoAlim * Math.pow(1 + txaa / 100, day / 365) - custoAlim : 0;
    const jurGado =
      role === "bp"
        ? fg === "Sim"
          ? pco * ((PI * rci) / 100 / 15) * Math.pow(1 + txaa / 100, day / 365) -
            pco * ((PI * rci) / 100 / 15)
          : 0
        : 0;
    const vv = day < minDC ? 0 : bon;

    let custProd, custoTotal, rec;
    if (role === "bp") {
      custProd = diarias + custoAlim + jurAlim + jurGado + co_com + cp + cs + cf;
      custoTotal = custProd + custoMort + ((PI * rci) / 100 / 15) * pco + custoAlimMortConst;
      rec = (C.pc[i] / 15) * (pv + vv);
    } else if (role === "b") {
      custProd = diarias + custoAlim + jurAlim + cp + cs + cf;
      custoTotal = custProd + custoMort;
      rec = valD * day;
    } else if (role === "ap") {
      custProd = diarias + custoAlim + jurAlim + cp + cs + cf;
      custoTotal = custProd + custoMort;
      const ganhoAr = (C.pc[i] - (PI * rci) / 100) / 15;
      rec = valAr * ganhoAr;
    } else {
      // parceria
      custProd = diarias + custoAlim + jurAlim + cp + cs + cf;
      custoTotal = custProd + custoMort;
      const ganhoAr = (C.pc[i] - (PI * rci) / 100) / 15;
      const bonp = ((PI * rci) / 100 / 15) * vv * (1 - bonParc);
      rec = ganhoAr * (pv + vv) + bonp;
    }

    const lucro = rec - custoTotal;
    const rent = (lucro / custoTotal) * 100;
    const rentM = ven === "à Vista" ? rent / (day / 30) : rent / ((day + 30) / 30);

    out.diarias.push(diarias);
    out.custo_alim.push(custoAlim);
    out.jur_alim.push(jurAlim);
    out.jur_gado.push(jurGado);
    out.cust_prod.push(custProd);
    out.custo_total.push(custoTotal);
    out.rec.push(rec);
    out.lucro.push(lucro);
    out.rent.push(rent);
    out.rent_m.push(rentM);
    out.vv.push(vv);
  }
  return out;
}

function pickDay(I, series) {
  // considera apenas dias > 21 (equivalente ao filtro fbp$DC>21 do original)
  const start = 21; // índice 21 => dia 22
  if (I.L1 === "Dias de Cocho") {
    return Math.max(1, Math.min(C_N_DAYS_FALLBACK(I), I.L2));
  }
  const key = I.L1 === "Lucro (R$/cab.)" ? "lucro" : I.L1 === "Rentabilidade Total (%)" ? "rent" : "rent_m";
  let bestIdx = start;
  let bestVal = -Infinity;
  for (let i = start; i < series[key].length; i++) {
    if (series[key][i] > bestVal) {
      bestVal = series[key][i];
      bestIdx = i;
    }
  }
  return bestIdx + 1; // dia (1-indexado)
}
function C_N_DAYS_FALLBACK() {
  return N_DAYS;
}

function zootechnicalRow(I, C, selectedDay) {
  const idx = selectedDay - 1;
  const PM = C.PM[idx],
    RC = C.RC[idx],
    CMSacum = C.cmsa[idx],
    EB = C.eb[idx];
  const pesoEntradaKg = I.c2;
  const pesoEntradaArroba = (I.c2 * I.a7) / 100 / 15;
  const pesoSaidaKg = PM;
  const pesoSaidaArroba = (PM * RC) / 100 / 15;
  const arrobasProduzidas = pesoSaidaArroba - pesoEntradaArroba;
  // GMD e GDC são médias do período inteiro (entrada até o dia selecionado),
  // não a taxa instantânea de um único dia — mesma convenção da aba Calibração.
  const GMDv = (PM - pesoEntradaKg) / selectedDay;
  const gdc = ((PM * RC) / 100 - (I.c2 * I.a7) / 100) / selectedDay;
  const rg = (gdc / GMDv) * 100;
  // Consumo médio diário (mesma convenção da aba Calibração: total consumido
  // dividido pelos dias, não o total acumulado em kg).
  const cmsMedio = CMSacum / selectedDay;
  // Conversão alimentar e eficiência biológica são métricas acumuladas
  // (consumo total / ganho total), não consumo total / taxa de um único dia.
  const conversao = C.ca[idx];
  const ebRecalc = EB;
  return {
    dias: selectedDay,
    pesoEntradaKg,
    pesoEntradaArroba,
    pesoSaidaKg,
    pesoSaidaArroba,
    cms: cmsMedio,
    cmsAcumulado: CMSacum,
    gmd: GMDv,
    rc: RC,
    gdc,
    rg,
    arrobasProduzidas,
    conversao,
    eb: ebRecalc,
    precoVenda: I.b0,
  };
}

function economicRowConfinamento(I, C, role, series, selectedDay) {
  const idx = selectedDay - 1;
  return {
    dias: selectedDay,
    custoBoiMagro: role === "bp" ? I.f1 * ((I.c2 * I.a7) / 100 / 15) : 0,
    jurosGado: role === "bp" ? series.jur_gado[idx] : 0,
    custoFrete: series.cf,
    custoProcessamento: series.cp,
    custoSanitario: I.f5,
    custoOperacional: I.f3 * selectedDay,
    custoAlimentar: series.custo_alim[idx],
    jurosAlimentar: series.jur_alim[idx],
    custoProducao: series.cust_prod[idx],
    custoArroba: series.cust_prod[idx] / ((C.pc[idx] - (I.c2 * I.a7) / 100) / 15),
    custoMortalidade: series.custoMort,
    custoTotal: series.custo_total[idx],
    receita: series.rec[idx],
    margem: series.lucro[idx],
    rentTotal: series.rent[idx],
    rentMensal: series.rent_m[idx],
  };
}

function economicRowParceiro(I, C, role, selectedDay, confSeries) {
  if (role === "bp") return null;
  const idx = selectedDay - 1;
  const PI = I.c2,
    rci = I.a7,
    pv = I.b0;
  const cbm = I.f1 * ((PI * rci) / 100 / 15);

  // custo/frete/processamento na perspectiva do parceiro (invertido)
  const cf = I.f21 === "Parceiro" ? I.f2 : 0;
  const cp = I.f41 === "Parceiro" ? I.f4 : 0;
  const custoMort = I.m11 === "Parceiro" ? confSeries.custoMortBaseConst + confSeries.custoAlimMortConst : 0;

  let custoConf;
  if (role === "b") custoConf = I.bp1 * selectedDay;
  else if (role === "ap") custoConf = I.bp2 * ((C.pc[idx] - (PI * rci) / 100) / 15);
  else custoConf = confSeries.rec[idx]; // parceria: receita do confinamento = custo do parceiro

  const custoTotalParc = custoConf + custoMort + cf + cp;
  const custoArroba = custoTotalParc / ((C.pc[idx] - (PI * rci) / 100) / 15);
  const vv = confSeries.vv[idx];
  const recParc = ((C.PM[idx] * C.RC[idx]) / 100) * (pv + vv) / 15;
  const lucroParc = recParc - custoTotalParc - cbm;
  const rentParc = (lucroParc / (custoTotalParc + cbm)) * 100;
  const rentParcM = I.f10 === "à Vista" ? rentParc / (selectedDay / 30) : rentParc / ((selectedDay + 30) / 30);

  return {
    dias: selectedDay,
    custoBoiMagro: cbm,
    custoConfinamento: custoConf,
    custoFrete: cf,
    custoProcessamento: cp,
    custoMortalidade: custoMort,
    custoTotal: custoTotalParc,
    custoArroba,
    receita: recParc,
    margem: lucroParc,
    rentTotal: rentParc,
    rentMensal: rentParcM,
  };
}

function computeModels(I) {
  const C = calibrate(I);
  const seriesConf = {}; // perspectiva "confinamento" (tabelas 1 e 2)
  const seriesParc = {}; // perspectiva "parceiro" (tabela 3), usada só para custoMort/cf/cp
  const selectedDay = {};
  const zoot = {};
  const econConf = {};
  const econParc = {};

  for (const role of ROLES) {
    seriesConf[role] = dailySeries(I, C, role, "confinamento");
    selectedDay[role] = pickDay(I, seriesConf[role]);
    zoot[role] = zootechnicalRow(I, C, selectedDay[role]);
    econConf[role] = economicRowConfinamento(I, C, role, seriesConf[role], selectedDay[role]);
    econParc[role] = economicRowParceiro(I, C, role, selectedDay[role], seriesConf[role]);
  }

  return { C, seriesConf, selectedDay, zoot, econConf, econParc };
}

// Para um único modelo de negócio, compara os quatro critérios de projeção
// possíveis lado a lado (em vez de comparar os quatro modelos sob um único
// critério, como computeModels faz).
const CRITERIA = [
  { key: "lucro", L1: "Lucro (R$/cab.)" },
  { key: "rentTotal", L1: "Rentabilidade Total (%)" },
  { key: "rentMensal", L1: "Rentabilidade Mensal (%)" },
  { key: "diasFixo", L1: "Dias de Cocho" },
];

function computeModelByCriteria(I, role) {
  const C = calibrate(I);
  const series = dailySeries(I, C, role, "confinamento");
  const byCriterion = {};
  for (const crit of CRITERIA) {
    const Ic = Object.assign({}, I, { L1: crit.L1 });
    const day = pickDay(Ic, series);
    byCriterion[crit.key] = {
      day,
      zoot: zootechnicalRow(I, C, day),
      econConf: economicRowConfinamento(I, C, role, series, day),
      econParc: economicRowParceiro(I, C, role, day, series),
    };
  }
  return { C, series, byCriterion };
}

// ---- Análise de risco (Monte Carlo) ----

function choleskyLower2x2(a, b, c) {
  // matriz [[a,b],[b,c]]
  const l11 = Math.sqrt(a);
  const l21 = b / l11;
  const l22 = Math.sqrt(Math.max(c - l21 * l21, 0));
  return [l11, l21, l22];
}

function riskAnalysis(I, model, opts) {
  const seed = opts && opts.seed ? opts.seed : 20240101;
  const rng = makeRng(seed);
  const normal = normalSampler(rng);
  const nSim = 15000;

  const C = model.C;
  const day = model.selectedDay.bp;
  const idx = day - 1;
  const series = model.seriesConf.bp;

  const PI = I.c2,
    rci = I.a7,
    adap = I.d1;
  const Cda = I.d4,
    Cdt = I.d7;

  // custo_total "local" do gráfico de risco (sem o termo duplicado de custoAlimMort)
  const custoTotalRisk =
    series.cust_prod[idx] + series.custoMort + ((PI * rci) / 100 / 15) * I.f1;
  const lucro1 = series.rec[idx] - custoTotalRisk;

  const m1v = Math.pow(I.arbp3 / 2, 2);
  const m2v = Math.pow(I.arbp4 / 2, 2);
  const var1 = ((m1v + m2v) / 2) * 0.95;
  const [l11, l21, l22] = choleskyLower2x2(m1v, var1, m2v);

  let totalCMSadap = 0;
  for (let i = 0; i < adap; i++) totalCMSadap += C.cms[i];
  let totalCMSterm = 0;
  for (let i = adap; i < idx + 1; i++) totalCMSterm += C.cms[i];

  const demaisCustos =
    series.jur_gado[idx] +
    series.jur_alim[idx] +
    I.f4 +
    I.f2 +
    I.f5 +
    I.f6 +
    series.custoMort +
    series.diarias[idx];

  const lucroSim = new Array(nSim);
  const custoAdapArr = new Array(nSim);
  const custoTermArr = new Array(nSim);
  const acArr = new Array(nSim);
  const avArr = new Array(nSim);

  for (let k = 0; k < nSim; k++) {
    const z1 = normal();
    const z2 = normal();
    const custoAdapSample = Cda + l11 * z1;
    const custoTermSample = Cdt + (l21 * z1 + l22 * z2);
    custoAdapArr[k] = custoAdapSample;
    custoTermArr[k] = custoTermSample;

    const av = I.b0 + (I.arbp1 / 2) * normal();
    const ac = I.f1 + (I.arbp2 / 2) * normal();
    avArr[k] = av;
    acArr[k] = ac;

    const compra = ((PI * rci) / 100 / 15) * ac;
    const venda = (C.pc[idx] / 15) * (av + series.vv[idx]);
    const custoDieta = (totalCMSadap * custoAdapSample) / 1000 + (totalCMSterm * custoTermSample) / 1000;

    lucroSim[k] = venda - compra - custoDieta - demaisCustos;
  }

  const meanSim = lucroSim.reduce((a, b) => a + b, 0) / nSim;
  const desvio = meanSim - lucro1;
  for (let k = 0; k < nSim; k++) lucroSim[k] -= desvio;

  const meanFinal = meanSim - desvio; // == lucro1
  const variance = lucroSim.reduce((a, b) => a + (b - meanFinal) * (b - meanFinal), 0) / (nSim - 1);
  const sd = Math.sqrt(variance);
  const probLucro = pnorm(I.arbp5, meanFinal, sd) * 100;

  let x;
  if (I.An === "@ Boi Magro") x = acArr;
  else if (I.An === "@ Boi Gordo") x = avArr;
  else x = custoTermArr;

  const meanX = x.reduce((a, b) => a + b, 0) / nSim;
  let num = 0,
    den = 0;
  for (let k = 0; k < nSim; k++) {
    num += (x[k] - meanX) * (lucroSim[k] - meanFinal);
    den += (x[k] - meanX) * (x[k] - meanX);
  }
  const slope = num / den;
  const intercept = meanFinal - slope * meanX;

  return {
    day,
    lucroSim,
    x,
    xLabel: I.An === "@ Boi Magro" ? "Valor de Compra da @ (R$)" : I.An === "@ Boi Gordo" ? "Valor de Venda da @ (R$)" : "Custo de Dieta de Terminação (R$/ton.)",
    mean: meanFinal,
    sd,
    probLucro,
    slope,
    intercept,
  };
}

const Calc = {
  CMS,
  GMD,
  mant,
  fatMant,
  fatorELg,
  PC,
  pnorm,
  calibrate,
  calibrationSummary,
  computeModels,
  computeModelByCriteria,
  CRITERIA,
  riskAnalysis,
  ROLES,
  N_DAYS,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = Calc;
} else {
  window.Calc = Calc;
}
