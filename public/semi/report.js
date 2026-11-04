// Semi Confinamento: relatório para imprimir/salvar em PDF e planilha Excel formatada (exceljs).
// Recebe tudo pronto de app.js (dados, resultados e as mesmas linhas das tabelas da tela), para o papel e a
// planilha mostrarem exatamente o que a tela mostra.
import { h } from '/js/common.js';

// Cores fixas (o papel e o Excel não seguem o tema escuro).
const BRAND = '094140';
const PROD = ['2a78d6', 'eb6834', '6250d6'];
const OK = '1f6f4a';
const DANGER = 'b3261e';

const nf = (dec) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmt = (v, dec = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : nf(dec).format(v));
const pct = (v, dec = 2) => (v === null || !Number.isFinite(v) ? '—' : `${fmt(v * 100, dec)}%`);
const dataBR = (iso) => (iso ? new Date(`${iso}T12:00`).toLocaleDateString('pt-BR') : '');

// Valor de uma linha de tabela (campo do produto ou valor calculado) e como escrevê-lo.
const rowValue = (ctx, row, i) => (row.key ? ctx.data.prods[i][row.key] : row.get(ctx.R[i], ctx.data.prods[i], i));
// Casas decimais da linha inteira (as três colunas iguais): a da linha, ou o mínimo que mostra os valores digitados.
function rowDec(row, vals) {
  if (row.dec !== undefined) return row.dec;
  if (!row.key) return 2;
  const casas = (v) => (Number.isFinite(v) ? Math.min(3, (String(Math.round(v * 1000) / 1000).split('.')[1] || '').length) : 0);
  return Math.max(...[vals].flat().map(casas));
}
const rowText = (row, v, dec) => (row.options ? (row.options.find((o) => o[0] === v)?.[1] ?? String(v)) : typeof v === 'string' ? v : v === null || v === undefined ? '—' : row.pct ? pct(v) : fmt(v, dec ?? rowDec(row, v)));

// Mistura uma cor com o branco (t = 0..1), para as células da análise de risco.
function mix(hex, t) {
  const c = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16));
  return c.map((x) => Math.round(255 + (x - 255) * t).toString(16).padStart(2, '0')).join('');
}
const heatColor = (v, max) => mix(v < 0 ? DANGER : OK, 0.08 + (Math.abs(v) / max) * 0.5);

// Melhor produto num indicador (maior ou menor), só quando há mais de um valor.
function bestIndex(vals, better) {
  const ok = vals.map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v));
  if (ok.length < 2) return -1;
  return ok.reduce((a, b) => ((better === 'min' ? b[0] < a[0] : b[0] > a[0]) ? b : a))[1];
}

function identity(ctx) {
  const c = ctx.data.cadastro;
  return [
    ['Fazenda', c.fazenda],
    ['Proprietário', c.proprietario],
    ['Cidade / UF', [c.cidade, c.estado].filter(Boolean).join(' / ')],
    ['Data da visita', dataBR(c.dataVisita)],
    ['Visita nº', c.nVisita],
    ['Coordenador', [c.coordenador, c.telCoordenador, c.emailCoordenador].filter(Boolean).join(' · ')],
    ['ATC', [c.atc, c.telAtc, c.emailAtc].filter(Boolean).join(' · ')],
  ].filter(([, v]) => v);
}

// Frase de destaque: quem dá mais lucro por hectare e quanto a mais.
function destaque(ctx) {
  const vals = ctx.R.map((r) => r.lucroHa);
  const i = bestIndex(vals, 'max');
  if (i < 0) return null;
  const outros = vals.map((v, k) => [v, k]).filter(([, k]) => k !== i).sort((a, b) => b[0] - a[0]);
  const [v2, k2] = outros[0];
  const dif = vals[i] - v2;
  return `${ctx.prodName(i)} dá o maior lucro por hectare: R$ ${fmt(vals[i], 0)}/ha, R$ ${fmt(dif, 0)}/ha a mais que ${ctx.prodName(k2)}, com rentabilidade de ${pct(ctx.R[i].rentMes)} ao mês.`;
}

// Ingredientes que entram em pelo menos um produto (os vazios ficam de fora do papel).
const usedIngredients = (ctx) => ctx.data.ing.map((x, j) => ({ ...x, j })).filter((x) => ctx.data.prods.some((p) => Number(p.incl[x.j]) > 0));

// Só as premissas digitadas (sem as linhas calculadas e sem título de seção vazio).
const inputsOnly = (rows) => rows.filter((r) => r.sec || r.key).filter((r, i, a) => !(r.sec && (!a[i + 1] || a[i + 1].sec)));

// ---------- Relatório impresso ----------

export function buildPrint(ctx) {
  const P = ctx.data.prods;
  const name = (i) => h('span', { class: 'rp-prod' }, h('span', { class: `rp-dot p${i + 1}` }), ctx.prodName(i));
  const table = (rows, opts = {}) =>
    h(
      'table',
      { class: `rp-table${opts.class ? ` ${opts.class}` : ''}` },
      h('thead', {}, h('tr', {}, h('th', {}, opts.first || 'Indicador'), [0, 1, 2].map((i) => h('th', { class: 'num' }, name(i))))),
      h(
        'tbody',
        {},
        rows.map((row) => {
          if (row.sec) return h('tr', { class: 'sec' }, h('td', { colspan: 4 }, row.sec));
          const vals = [0, 1, 2].map((i) => rowValue(ctx, row, i));
          return h(
            'tr',
            { class: row.strong ? 'strong' : '' },
            h('td', {}, row.label, row.unit ? h('span', { class: 'unit' }, ` (${row.unit.split(' · ')[0]})`) : null),
            vals.map((v) => h('td', { class: `num${row.signed && v < 0 ? ' neg' : ''}` }, rowText(row, v, rowDec(row, vals)))),
          );
        }),
      ),
    );

  // Resumo por produto
  const bestHa = bestIndex(ctx.R.map((r) => r.lucroHa), 'max');
  const kpis = h(
    'div',
    { class: 'rp-kpis' },
    ctx.R.map((r, i) =>
      h(
        'div',
        { class: `rp-kpi p${i + 1}` },
        h('div', { class: 'rp-kpi-head' }, name(i), i === bestHa ? h('span', { class: 'rp-best' }, '★ maior lucro/ha') : null),
        h('div', { class: 'rp-kpi-cap' }, 'Lucro por hectare'),
        h('div', { class: `rp-kpi-big${r.lucroHa < 0 ? ' neg' : ''}` }, `R$ ${fmt(r.lucroHa, 0)}`, h('small', {}, '/ha')),
        h(
          'dl',
          {},
          [
            ['Lucro por cabeça', `R$ ${fmt(r.lucro, 2)}`],
            ['Rentabilidade', `${pct(r.rentMes)} a.m.`],
            ['Arrobas produzidas', `${fmt(r.arrobaHa, 2)} @/ha`],
            ['Custo da @ produzida', `R$ ${fmt(r.custoArroba, 2)}`],
            ['Ponto de equilíbrio', `R$ ${fmt(r.equilibrio, 2)}/@`],
          ].flatMap(([a, b]) => [h('dt', {}, a), h('dd', {}, b)]),
        ),
      ),
    ),
  );

  // Comparação em barras
  const bars = h(
    'div',
    { class: 'rp-cmps' },
    ctx.COMPARA.map((m) => {
      const vals = ctx.R.map((r) => m.get(r));
      const max = Math.max(...vals.filter(Number.isFinite).map(Math.abs), 1e-9);
      const best = bestIndex(vals, m.better);
      return h(
        'div',
        { class: 'rp-cmp' },
        h('div', { class: 'rp-cmp-label' }, h('strong', {}, m.label), ` ${m.unit.split(' · ')[0]}`, m.better === 'min' ? h('span', { class: 'unit' }, ' · menor é melhor') : null),
        vals.map((v, i) =>
          h(
            'div',
            { class: 'rp-cmp-row' },
            h('span', { class: 'rp-cmp-name' }, ctx.prodName(i)),
            h('span', { class: 'rp-cmp-track' }, h('span', { class: `rp-cmp-bar p${i + 1}${v < 0 ? ' neg' : ''}`, style: `width:${Number.isFinite(v) ? (Math.abs(v) / max) * 100 : 0}%` })),
            h('span', { class: `rp-cmp-val${v < 0 ? ' neg' : ''}` }, i === best ? '★ ' : '', m.pct ? pct(v) : fmt(v, m.dec)),
          ),
        ),
      );
    }),
  );

  // Formulação (só os ingredientes usados)
  const ings = usedIngredients(ctx);
  const formula = h(
    'table',
    { class: 'rp-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Ingrediente'), h('th', { class: 'num' }, 'Preço (R$/t MN)'), [0, 1, 2].map((i) => h('th', { class: 'num' }, name(i))))),
    h(
      'tbody',
      {},
      ings.map((x) => h('tr', {}, h('td', {}, x.nome), h('td', { class: 'num' }, fmt(x.preco, 0)), P.map((p) => h('td', { class: 'num' }, Number(p.incl[x.j]) ? `${fmt(p.incl[x.j], 1)}%` : '—')))),
      h('tr', { class: 'strong' }, h('td', { colspan: 2 }, 'Total da fórmula'), ctx.R.map((r) => h('td', { class: `num${Math.abs(r.inclTotal - 100) > 0.05 ? ' neg' : ''}` }, `${fmt(r.inclTotal, 1)}%`))),
      h('tr', {}, h('td', { colspan: 2 }, 'Custo da fórmula (R$/t)'), ctx.R.map((r) => h('td', { class: 'num' }, fmt(r.custoFormula, 2)))),
      h('tr', {}, h('td', { colspan: 2 }, 'Custo de produção (R$/t)'), P.map((p) => h('td', { class: 'num' }, fmt(p.custoProd || 0, 2)))),
      h('tr', { class: 'strong' }, h('td', { colspan: 2 }, 'Custo final (R$/kg MN)'), ctx.R.map((r) => h('td', { class: 'num' }, fmt(r.custoKg, 3)))),
    ),
  );

  // Análise de risco
  const heat = (g, corner) => {
    const max = Math.max(1, ...g.valores.flat().map(Math.abs));
    return h(
      'table',
      { class: 'rp-heat' },
      h('thead', {}, h('tr', {}, h('th', { class: 'corner' }, corner), g.colunas.map((v) => h('th', {}, fmt(v, Number.isInteger(v) ? 0 : 2))))),
      h(
        'tbody',
        {},
        g.linhas.map((l, a) =>
          h('tr', {}, h('th', {}, fmt(l, Number.isInteger(Math.round(l * 100) / 100) ? 0 : 2)), g.valores[a].map((v, b) => h('td', { class: a === 2 && b === 2 ? 'mid' : '', style: `background:#${heatColor(v, max)}` }, fmt(v, 0)))),
        ),
      ),
    );
  };
  const riskBlock = (titulo, sub, key, corner) =>
    h('section', { class: 'rp-block' }, h('h3', {}, titulo), h('p', { class: 'rp-sub' }, sub), h('div', { class: 'rp-heats' }, ctx.grades[key].map((g, i) => h('div', {}, h('h4', {}, name(i)), heat(g, corner)))));

  const ident = identity(ctx);
  const frase = destaque(ctx);
  const gerado = `Gerado em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} por ${ctx.userName}`;
  const header = (title) =>
    h('header', { class: 'rp-header' }, h('img', { src: '/img/probeef-horizontal.png', alt: 'Probeef', width: 116, height: 26 }), h('div', {}, h('h1', {}, title), h('p', {}, [ctx.data.cadastro.fazenda && `Fazenda ${ctx.data.cadastro.fazenda}`, dataBR(ctx.data.cadastro.dataVisita)].filter(Boolean).join(' · ') || ctx.simName || 'Simulação')));

  return [
    h(
      'section',
      { class: 'rp-page' },
      header('Semi Confinamento · relatório da simulação'),
      ident.length ? h('dl', { class: 'rp-ident' }, ident.map(([a, b]) => h('div', {}, h('dt', {}, a), h('dd', {}, b)))) : null,
      frase ? h('p', { class: 'rp-destaque' }, frase) : null,
      h('h2', {}, 'Resumo por produto'),
      kpis,
      h('h2', {}, 'Comparação'),
      bars,
      h('p', { class: 'rp-note' }, 'Estimativas a partir dos valores informados na simulação (desempenho, preços e custos). Os resultados reais dependem do manejo, do clima e do mercado.'),
    ),
    h(
      'section',
      { class: 'rp-page' },
      header('Premissas'),
      h('h2', {}, 'Formulação'),
      formula,
      h('h2', {}, 'Zootécnico'),
      table(inputsOnly(ctx.rows.zoo), { first: 'Premissa' }),
      h('h2', {}, 'Financeiro'),
      table(inputsOnly(ctx.rows.fin), { first: 'Premissa' }),
      h('p', { class: 'rp-note' }, 'Os valores calculados a partir destas premissas (arrobas, lotação em animais/ha, custos por dia e por cabeça) estão nos resultados detalhados.'),
    ),
    h(
      'section',
      { class: 'rp-page' },
      header('Resultados detalhados'),
      h('h2', {}, 'Resultado econômico'),
      table(ctx.rows.result),
      h('h2', {}, 'Custos'),
      table(ctx.rows.custo),
      h('h2', {}, 'Resultado zootécnico'),
      table(ctx.rows.resZoo),
    ),
    h(
      'section',
      { class: 'rp-page' },
      header('Análise de risco'),
      h('p', { class: 'rp-sub' }, 'Lucro em R$/ha para cada combinação de preços, dois passos abaixo e dois acima dos preços da simulação. A célula com borda é a dos resultados. Verde: lucro; vermelho: prejuízo; quanto mais forte, maior o valor.'),
      riskBlock('Valor de compra × valor de venda', `Linhas: compra do boi magro (R$/@, passo de R$ ${fmt(ctx.data.risco.passoCompra, 2)}). Colunas: venda do boi gordo (R$/@, passo de R$ ${fmt(ctx.data.risco.passoVenda, 2)}).`, 'compraVenda', 'Compra ↓ Venda →'),
      riskBlock('Preço do milho × valor de venda', `Linhas: milho (R$/saca de 60 kg, passo de R$ ${fmt(ctx.data.risco.passoMilho, 2)}). Colunas: venda do boi gordo (R$/@).`, 'milhoVenda', 'Milho ↓ Venda →'),
    ),
    h('footer', { class: 'rp-footer' }, `${gerado} · Probeef Analytics · Cargill`),
  ];
}

// ---------- Excel ----------

let excelLoading = null;
function loadExcelLib() {
  excelLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/exceljs.min.js';
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => {
      excelLoading = null;
      reject(new Error('Não foi possível carregar o gerador de Excel.'));
    };
    document.head.append(s);
  });
  return excelLoading;
}

const argb = (hex) => `FF${hex.toUpperCase()}`;
const fill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const thin = { style: 'thin', color: { argb: 'FFD9E1E6' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const numFmt = (row, vals) => {
  if (row.pct) return '0.00%';
  const d = rowDec(row, vals);
  return d === 0 ? '#,##0' : `#,##0.${'0'.repeat(d)}`;
};

export async function buildExcel(ctx) {
  const ExcelJS = await loadExcelLib();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Probeef Analytics · Semi Confinamento';
  wb.created = new Date();
  const P = ctx.data.prods;
  const names = P.map((p, i) => ctx.prodName(i));

  const newSheet = (title, widths) => {
    const ws = wb.addWorksheet(title, { views: [{ showGridLines: false }], pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
    ws.columns = widths.map((width) => ({ width }));
    ws.headerFooter.oddFooter = '&LSemi Confinamento · Probeef Analytics&RPágina &P de &N';
    return ws;
  };
  // Título da aba: faixa verde com o nome da simulação.
  const title = (ws, text, cols) => {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, cols);
    r.height = 26;
    r.getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    r.getCell(1).fill = fill(BRAND);
    r.getCell(1).alignment = { vertical: 'middle', indent: 1 };
    const c = ctx.data.cadastro;
    const sub = ws.addRow([[c.fazenda && `Fazenda ${c.fazenda}`, c.proprietario, [c.cidade, c.estado].filter(Boolean).join('/'), dataBR(c.dataVisita) && `visita em ${dataBR(c.dataVisita)}`].filter(Boolean).join(' · ') || ctx.simName || 'Simulação']);
    ws.mergeCells(sub.number, 1, sub.number, cols);
    sub.getCell(1).font = { italic: true, color: { argb: 'FF546D6C' } };
    ws.addRow([]);
  };
  const section = (ws, text, cols) => {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, cols);
    r.getCell(1).font = { bold: true, size: 12, color: { argb: argb(BRAND) } };
    r.getCell(1).border = { bottom: { style: 'medium', color: { argb: argb(BRAND) } } };
    r.height = 20;
  };
  // Cabeçalho com os três produtos, cada um com a sua cor.
  const prodHeader = (ws, first, extra = []) => {
    const r = ws.addRow([first, ...extra, ...names]);
    r.eachCell((cell, n) => {
      const k = n - 1 - extra.length - 1;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = fill(k >= 0 ? PROD[k] : BRAND);
      cell.alignment = { horizontal: n === 1 ? 'left' : 'right', vertical: 'middle', wrapText: true };
      cell.border = box;
    });
    r.height = 20;
    return r;
  };
  const dataRows = (ws, rows, { inputs = true } = {}) => {
    for (const row of rows) {
      if (row.sec) {
        const r = ws.addRow([row.sec]);
        ws.mergeCells(r.number, 1, r.number, 4);
        r.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF546D6C' } };
        r.getCell(1).fill = fill('EEF2F5');
        continue;
      }
      const vals = [0, 1, 2].map((i) => rowValue(ctx, row, i));
      const shown = vals.map((v) => (row.options ? rowText(row, v) : v));
      const r = ws.addRow([`${row.label}${row.unit ? ` (${row.unit.split(' · ')[0]})` : ''}`, ...shown]);
      const best = row.better ? bestIndex(vals, row.better) : -1;
      r.eachCell((cell, n) => {
        cell.border = box;
        if (n === 1) {
          cell.font = { bold: Boolean(row.strong), color: { argb: row.key ? 'FF0C2A29' : 'FF3D5352' } };
          return;
        }
        const v = vals[n - 2];
        cell.alignment = { horizontal: 'right' };
        if (typeof shown[n - 2] === 'number') cell.numFmt = numFmt(row, vals);
        cell.font = { bold: Boolean(row.strong) || n - 2 === best, color: { argb: row.signed && v < 0 ? argb(DANGER) : 'FF0C2A29' } };
        if (row.key && inputs) cell.fill = fill('FFF8E5'); // premissa digitada
      });
    }
  };

  // 1. Resumo
  const resumo = newSheet('Resumo', [44, 22, 22, 22]);
  title(resumo, 'Semi Confinamento · resumo da simulação', 4);
  const ident = identity(ctx);
  if (ident.length) {
    section(resumo, 'Visita', 4);
    for (const [a, b] of ident) {
      const r = resumo.addRow([a, b]);
      resumo.mergeCells(r.number, 2, r.number, 4);
      r.getCell(1).font = { color: { argb: 'FF546D6C' } };
    }
    resumo.addRow([]);
  }
  const frase = destaque(ctx);
  if (frase) {
    const r = resumo.addRow([frase]);
    resumo.mergeCells(r.number, 1, r.number, 4);
    r.height = 32;
    r.getCell(1).alignment = { wrapText: true, vertical: 'middle', indent: 1 };
    r.getCell(1).fill = fill('E2F1E8');
    r.getCell(1).font = { bold: true, color: { argb: argb(OK) } };
    resumo.addRow([]);
  }
  section(resumo, 'Indicadores (o melhor de cada linha está em negrito)', 4);
  prodHeader(resumo, 'Indicador');
  dataRows(resumo, ctx.COMPARA.map((m) => ({ ...m, unit: m.unit.split(' · ')[0], strong: false })), { inputs: false });
  resumo.addRow([]);
  const nota = resumo.addRow(['Células em amarelo nas outras abas: premissas digitadas na simulação. As demais são calculadas.']);
  resumo.mergeCells(nota.number, 1, nota.number, 4);
  nota.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF546D6C' } };

  // 2. Premissas
  const prem = newSheet('Premissas', [44, 18, 18, 18, 18]);
  title(prem, 'Premissas da simulação', 5);
  section(prem, 'Formulação (inclusão em % da matéria natural)', 5);
  prodHeader(prem, 'Ingrediente', ['Preço (R$/t MN)']);
  for (const x of usedIngredients(ctx)) {
    const r = prem.addRow([x.nome, x.preco, ...P.map((p) => (Number(p.incl[x.j]) ? p.incl[x.j] / 100 : null))]);
    r.eachCell({ includeEmpty: true }, (cell, n) => {
      cell.border = box;
      if (n === 2) cell.numFmt = '#,##0';
      if (n > 2) cell.numFmt = '0.0%';
      if (n > 1) cell.fill = fill('FFF8E5');
    });
  }
  const footRow = (label, vals, fmt, strong) => {
    const r = prem.addRow([label, null, ...vals]);
    r.eachCell({ includeEmpty: true }, (cell, n) => {
      cell.border = box;
      if (n > 2) cell.numFmt = fmt;
      cell.font = { bold: strong };
    });
  };
  footRow('Total da fórmula', ctx.R.map((r) => r.inclTotal / 100), '0.0%', true);
  footRow('Custo da fórmula (R$/t)', ctx.R.map((r) => r.custoFormula), '#,##0.00');
  footRow('Custo de produção (R$/t)', P.map((p) => p.custoProd || 0), '#,##0.00');
  footRow('Custo final (R$/kg MN)', ctx.R.map((r) => r.custoKg), '#,##0.000', true);
  prem.addRow([]);
  // As tabelas de premissas têm 4 colunas (indicador + 3 produtos).
  section(prem, 'Zootécnico', 4);
  prodHeader(prem, 'Premissa');
  dataRows(prem, ctx.rows.zoo);
  prem.addRow([]);
  section(prem, 'Financeiro', 4);
  prodHeader(prem, 'Premissa');
  dataRows(prem, ctx.rows.fin);

  // 3. Resultados
  const res = newSheet('Resultados', [52, 20, 20, 20]);
  title(res, 'Resultados', 4);
  for (const [nome, rows] of [
    ['Resultado econômico', ctx.rows.result],
    ['Custos', ctx.rows.custo],
    ['Resultado zootécnico', ctx.rows.resZoo],
  ]) {
    section(res, nome, 4);
    prodHeader(res, 'Indicador');
    dataRows(res, rows);
    res.addRow([]);
  }

  // 4. Risco
  const risk = newSheet('Análise de risco', [20, 13, 13, 13, 13, 13]);
  risk.pageSetup.orientation = 'portrait';
  title(risk, 'Análise de risco · lucro em R$/ha', 6);
  const legend = risk.addRow(['Verde: lucro · vermelho: prejuízo · quanto mais forte, maior o valor. Célula com borda: preços da simulação.']);
  risk.mergeCells(legend.number, 1, legend.number, 6);
  legend.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF546D6C' } };
  risk.addRow([]);
  for (const [titulo, key, linha] of [
    ['Valor de compra (R$/@) × valor de venda (R$/@)', 'compraVenda', 'Compra \\ Venda'],
    ['Preço do milho (R$/saca 60 kg) × valor de venda (R$/@)', 'milhoVenda', 'Milho \\ Venda'],
  ]) {
    section(risk, titulo, 6);
    ctx.grades[key].forEach((g, i) => {
      const nr = risk.addRow([names[i]]);
      risk.mergeCells(nr.number, 1, nr.number, 6);
      nr.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      nr.getCell(1).fill = fill(PROD[i]);
      const hr = risk.addRow([linha, ...g.colunas]);
      hr.eachCell((cell, n) => {
        cell.font = { bold: true, color: { argb: 'FF3D5352' } };
        cell.fill = fill('EEF2F5');
        cell.border = box;
        cell.alignment = { horizontal: n === 1 ? 'left' : 'right' };
        if (n > 1) cell.numFmt = '#,##0.00';
      });
      const max = Math.max(1, ...g.valores.flat().map(Math.abs));
      g.linhas.forEach((l, a) => {
        const r = risk.addRow([l, ...g.valores[a]]);
        r.eachCell((cell, n) => {
          cell.border = box;
          if (n === 1) {
            cell.numFmt = '#,##0.00';
            cell.font = { bold: true, color: { argb: 'FF3D5352' } };
            cell.fill = fill('EEF2F5');
            return;
          }
          const v = g.valores[a][n - 2];
          cell.numFmt = '#,##0';
          cell.fill = fill(heatColor(v, max));
          cell.alignment = { horizontal: 'right' };
          if (a === 2 && n - 2 === 2) {
            const med = { style: 'medium', color: { argb: 'FF0C2A29' } };
            cell.border = { top: med, left: med, bottom: med, right: med };
            cell.font = { bold: true };
          }
        });
      });
      risk.addRow([]);
    });
  }

  // 5. Cadastro completo (inclusive o que ficou vazio)
  const cad = newSheet('Cadastro', [28, 50]);
  title(cad, 'Cadastro da visita', 2);
  const c = ctx.data.cadastro;
  for (const [a, b] of [
    ['Proprietário', c.proprietario],
    ['Fazenda', c.fazenda],
    ['Data da visita', dataBR(c.dataVisita)],
    ['Cidade', c.cidade],
    ['Estado', c.estado],
    ['Visita nº', c.nVisita],
    ['Coordenador', c.coordenador],
    ['Telefone do coordenador', c.telCoordenador],
    ['E-mail do coordenador', c.emailCoordenador],
    ['ATC', c.atc],
    ['Telefone do ATC', c.telAtc],
    ['E-mail do ATC', c.emailAtc],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    ['Gerado por', ctx.userName],
  ]) {
    const r = cad.addRow([a, b || '—']);
    r.getCell(1).font = { color: { argb: 'FF546D6C' } };
    r.eachCell((cell) => (cell.border = box));
  }

  for (const ws of [resumo, prem, res]) ws.views = [{ showGridLines: false, state: 'normal' }];
  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const nome = (c.fazenda || 'simulacao').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').toLowerCase();
  const a = h('a', { href: URL.createObjectURL(blob), download: `semi-confinamento-${nome}-${new Date().toISOString().slice(0, 10)}.xlsx` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
