// Modelo em Excel para preencher fora do portal e importar depois (botão "Baixar modelo").
// Gerado no navegador com exceljs; lido de volta pelo importador (SheetJS) pelos títulos das
// colunas, então a ordem das colunas pode mudar sem quebrar a importação.
import { ECO_FIELDS, fieldLabel, OPTIONS, QUESTIONARIO, QUESTIONS, questionText, ZOO_FIELDS } from './fields.js';

export const MODELO_SHEETS = { engorda: 'Lotes engorda', recria: 'Lotes recria', questionario: 'Questionário' };
const LINHAS = 1000; // linhas com lista suspensa e formato de data
const header = (f, recria) => `${fieldLabel(f.key)}${(recria ? f.reqRecria : f.req) ? ' *' : ''}`;
const norm = (s) => String(s ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function colLetter(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const FORMATO = { date: 'Data (dd/mm/aaaa)', int: 'Número inteiro', num: 'Número', text: 'Texto', list: 'Escolha da lista' };

let excelJsLoading = null;
function loadExcelJs() {
  excelJsLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/exceljs.min.js';
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => {
      excelJsLoading = null;
      reject(new Error('Não foi possível carregar o gerador de Excel.'));
    };
    document.head.append(s);
  });
  return excelJsLoading;
}

export async function baixarModelo(settings, cliente) {
  const ExcelJS = await loadExcelJs();
  const wb = new ExcelJS.Workbook();
  const verde = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF094140' } };
  const claro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EFEE' } };

  // Instruções primeiro, para ser a aba que abre.
  const ins = wb.addWorksheet('Instruções');
  ins.getColumn(1).width = 110;
  [
    [`Benchmarking Confinamento Probeef ${settings.ano}${cliente ? ` · ${cliente}` : ''}`, { bold: true, size: 14 }],
    [''],
    ['Como usar este modelo', { bold: true }],
    ['1. Preencha um lote por linha nas abas "Lotes engorda" e, se a fazenda faz recria confinada, "Lotes recria".'],
    ['2. Colunas com * são obrigatórias. Passe o mouse no título da coluna para ver a unidade e o formato.'],
    ['3. Tipo de entrada, raça, categoria e origem têm lista suspensa: use os nomes da lista.'],
    ['4. Datas no formato dd/mm/aaaa. Números sem unidade (ex.: 1.250,5 ou 1250,5).'],
    ['5. Na aba "Questionário", escreva a resposta na coluna "Resposta". Quando der para marcar mais de uma opção, separe por ponto e vírgula (;).'],
    ['6. No portal, clique em "Importar planilha" e escolha este arquivo. Os erros e alertas aparecem na tela para corrigir lá mesmo.'],
    [''],
    ['Não mude o nome das abas nem os títulos das colunas: a importação usa esses nomes.'],
    ['Quem usa o TGC pode importar direto o relatório por animal exportado do TGC, sem este modelo.'],
  ].forEach(([text, font]) => {
    const row = ins.addRow([text]);
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    if (font) row.getCell(1).font = font;
  });

  // Listas das listas suspensas (aba oculta): uma coluna por lista.
  const listas = wb.addWorksheet('Listas', { state: 'hidden' });
  const refs = {};
  let li = 0;
  const addLista = (id, values) => {
    const c = colLetter(li++);
    listas.getCell(`${c}1`).value = id;
    values.forEach((v, i) => (listas.getCell(`${c}${i + 2}`).value = v));
    refs[id] = `Listas!$${c}$2:$${c}$${values.length + 1}`;
  };
  for (const [id, values] of Object.entries(settings.listas)) addLista(id, values);

  const loteSheet = (name, fields, recria) => {
    const ws = wb.addWorksheet(name);
    ws.columns = fields.map((f) => ({ header: header(f, recria), key: f.key, width: Math.max(12, Math.round((f.w || 80) / 6.5)) }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = verde;
    head.alignment = { vertical: 'middle', wrapText: true };
    head.height = 32;
    fields.forEach((f, i) => {
      const c = colLetter(i);
      ws.getCell(`${c}1`).note = [FORMATO[f.type], f.unit ? `Unidade: ${f.unit}` : null, (recria ? f.reqRecria : f.req) ? 'Obrigatório' : 'Opcional'].filter(Boolean).join('\n');
      const range = `${c}2:${c}${LINHAS + 1}`;
      if (f.type === 'date') ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy';
      if (f.type === 'list' && refs[f.list]) {
        ws.dataValidations.add(range, { type: 'list', allowBlank: true, formulae: [refs[f.list]], showErrorMessage: true, errorStyle: 'warning', errorTitle: f.label, error: 'Valor fora da lista. Use um dos nomes da lista para não dar erro na validação.' });
      }
    });
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  };
  loteSheet(MODELO_SHEETS.engorda, [...ZOO_FIELDS, ...ECO_FIELDS], false);
  loteSheet(MODELO_SHEETS.recria, ZOO_FIELDS, true);

  const qs = wb.addWorksheet(MODELO_SHEETS.questionario);
  qs.columns = [
    { header: 'Código', key: 'id', width: 8 },
    { header: 'Nº', key: 'n', width: 5 },
    { header: 'Pergunta', key: 'text', width: 60 },
    { header: 'Resposta', key: 'resp', width: 40 },
    { header: 'Como responder', key: 'how', width: 60 },
  ];
  const qh = qs.getRow(1);
  qh.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  qh.fill = verde;
  for (const sec of QUESTIONARIO) {
    const r = qs.addRow({ text: sec.title });
    r.font = { bold: true };
    r.fill = claro;
    for (const q of sec.questions) {
      const opts = q.options || (q.type === 'sn' ? OPTIONS.SN : q.type === 'uf' ? OPTIONS.UFS : null);
      const how = [
        q.type === 'multi' ? `Uma ou mais (separe por ;)${q.max ? `, no máximo ${q.max}` : ''}: ${q.options.join('; ')}` : null,
        q.type === 'choice' ? 'Escolha uma da lista' : null,
        q.type === 'sn' ? 'Sim ou Não' : q.type === 'uf' ? 'Sigla do estado (ex.: MG)' : null,
        ['int', 'num', 'pct'].includes(q.type) ? `Número${q.unit ? ` em ${q.unit}` : ''}` : null,
        q.other && opts ? 'Pode escrever outra resposta' : null,
        q.showIf ? `Só se a pergunta ${QUESTIONS.find((x) => x.id === q.showIf[0])?.n} for "${q.showIf[1]}"` : null,
        q.hint ? questionText({ text: q.hint }, settings) : null,
      ].filter(Boolean);
      const row = qs.addRow({ id: q.id, n: q.n, text: `${questionText(q, settings)}${q.req ? ' *' : ''}`, how: how.join(' · ') });
      row.alignment = { wrapText: true, vertical: 'top' };
      const resp = row.getCell('resp');
      resp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } };
      if (opts && q.type !== 'multi') {
        addLista(q.id, opts);
        resp.dataValidation = { type: 'list', allowBlank: true, formulae: [refs[q.id]], showErrorMessage: !q.other, errorStyle: 'warning', error: 'Use uma das opções da lista.' };
      }
    }
  }
  qs.views = [{ state: 'frozen', ySplit: 1 }];

  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Modelo-Benchmarking-Confinamento-${settings.ano}.xlsx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Lê as abas do modelo (pelos títulos das colunas). Devolve null se o arquivo não é o modelo.
export function lerModelo(XLSX, wb, { excelDate, answerFromCell }) {
  const engWs = wb.Sheets[MODELO_SHEETS.engorda];
  const recWs = wb.Sheets[MODELO_SHEETS.recria];
  const qWs = wb.Sheets[MODELO_SHEETS.questionario];
  if (!engWs && !recWs) return null;
  const lotes = (ws, fields) => {
    if (!ws) return [];
    const [head = [], ...rows] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const byLabel = new Map(fields.map((f) => [norm(fieldLabel(f.key)), f]));
    const cols = head.map((t) => byLabel.get(norm(t)) || null);
    return rows
      .map((r) => {
        const raw = {};
        cols.forEach((f, i) => {
          const v = r[i];
          if (!f || v === null || v === undefined || v === '') return;
          raw[f.key] = f.type === 'date' ? excelDate(v, XLSX) : v;
        });
        return raw;
      })
      .filter((r) => r.lote !== undefined && String(r.lote).trim() !== '');
  };
  const respostas = {};
  if (qWs) {
    const [head = [], ...rows] = XLSX.utils.sheet_to_json(qWs, { header: 1, raw: true, defval: null });
    const iId = head.findIndex((t) => norm(t) === 'código');
    const iResp = head.findIndex((t) => norm(t) === 'resposta');
    for (const r of rows) {
      const q = QUESTIONS.find((x) => x.id === String(r[iId] ?? '').trim());
      const a = q ? answerFromCell(q, r[iResp]) : null;
      if (a !== null && !(Array.isArray(a) && !a.length)) respostas[q.id] = a;
    }
  }
  return { engorda: lotes(engWs, [...ZOO_FIELDS, ...ECO_FIELDS]), recria: lotes(recWs, ZOO_FIELDS), respostas };
}
