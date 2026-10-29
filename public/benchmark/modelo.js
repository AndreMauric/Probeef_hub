// Modelo em Excel para preencher fora do portal e importar depois (botão "Baixar modelo").
// Tem as mesmas abas e colunas da planilha de benchmarking, que são as do relatório que sai do
// software: Feed Manager (BD_Zootec_Feed, BD_Econom_Feed, BD_Zootec_Feed_ Recria_Conf), TGC
// (BD_TGC_Conf, BD_TGC_Conf_Recria) ou Cargill Feed Manager (BD_CFM_Conf, BD_CFM_Conf_Recria) — os
// dois últimos com um animal por linha. Títulos na linha 3 e dados a partir da
// linha 4, então o importador lê o modelo como lê a planilha. O questionário vai numa aba à parte.
import { colIndex, ECO_FIELDS, OPTIONS, QUESTIONARIO, QUESTIONS, questionText, ZOO_FIELDS } from './fields.js';

export const QUESTIONARIO_SHEET = 'Questionário';
const LINHAS = 1000; // linhas com lista suspensa e formato de data

// Títulos da planilha original (linha 3), na ordem das colunas.
const FEED_ZOO = ['Lote', 'Curral', 'Tipo de Entrada', 'Raça', 'Categoria', 'Saída', 'Qt Anm', 'Mortes (cab)', 'Mortes (%)', 'Ret Pasto (cab)', 'Ret Pasto (%)', 'PV Entrada Kg/cab', 'PV Saída (Kg/cab)', 'Peso Carc Kg/cab', 'GPD', 'Rend Carcaça Real(%)', "Ganho '@/cab", 'Dias Conf', 'Dias Trato', 'Total Diárias', 'Cons MO kg/cab/d', 'Cons MS kg/cab/d', 'Cons MS kg /%PV', 'Efic. Alim kgMS/@+', 'Conv Alim *kgMS/KgPV'];
const FEED_ECO = ['Identificação Lote', 'Curral', 'Entradas Valor ($/cab', 'Peso Kg/cab', 'Qt Anm', 'Frete $/cab', 'Comissão $/cab', 'Saídas Valor ($/cab)', 'Peso Vivo kg/cab', 'Peso Carc Kg/acb', 'Qt Anm', 'Resultados GPD', 'Rend Carc (%)', 'GCD kg/d', 'Dias Trato', 'Custo cab/d', 'Custo total Trato', 'Custo total de Manejo', 'Custo total Extra', 'Custo total do Lote ', 'Valor total de Venda ', 'Lucro Lote', 'Lucro $/cab', 'Ganho Carc @/cab', 'Custo Alim Ganho', 'Custo Ganho $/@', 'Valor Venda $/@', '%Ret fin'];
const TGC = ['LOTE_SAIDA', 'COD. ANIMAL', 'SISBOV', 'CONTRATO', 'REBANHO', 'CATEGORIA', 'FORNECEDOR', 'FRIGORÍFICO DESTINO', 'RAÇA', 'LOTE MANEJO', 'PESO ENTRADA(KG)', 'PESO ENTRADA(CARCAÇA)', 'PESO ENTRADA(ARROBA)', 'RENDIMENTO CARCAÇA (ENTRADA)', 'PESO SAÍDA(KG)', 'PESO SAÍDA(CARCAÇA)', 'PESO SAÍDA(ARROBA)', 'RENDIMENTO CARCAÇA (SAÍDA)', '@ PRODUZIDA (CAB)', 'DIAS CONF (CAB)', 'DIAS OCUPACAO (CAB)', 'DIÁRIAS ALIMENTAR (TOTAL)', 'DIFERENÇA DE DIÁRIAS (CAB)', 'GANHO DE PESO DIA(KG)', 'GANHO DE PESO DIA(CARCAÇA)', 'DATA DE ENTRADA', 'DATA DE SAÍDA', 'CONSUMO MN(CAB/DIA)', 'CONSUMO MS(CAB/DIA)', 'CONSUMO MN(CAB/PERÍODO)', 'CONSUMO MS(CAB/PERÍODO)', 'CONVERSÃO ALIMENTAR', 'EFICIÊNCIA ALIMENTAR', 'EFICIÊNCIA BIOLÓGICA', 'IMS(%PV)', 'CUSTO COMPRA BOI MAGRO(CAB)', 'CUSTO FRETE(CAB)', 'CUSTO BOI MAGRO(CAB)', 'CUSTO ARROBA COMPRA', 'CUSTO FIXO(CAB/DIA)', 'CUSTO FIXO(CAB/PERÍODO)', 'CUSTO ALIMENTAR(CAB/PERÍODO)', 'CUSTO ALIMENTAR(CAB/DIA)', 'CUSTO SANIDADE(CAB/PERÍODO)', 'CUSTO SANIDADE(CAB/DIA)', 'CUSTO OUTROS CUSTOS(CAB/PERÍODO)', 'CUSTO OUTROS CUSTOS(CAB/DIA)', 'CUSTO PRODUÇÃO(CAB/PERÍODO)', 'CUSTO PRODUÇÃO(CAB/DIA)', 'CUSTO ARROBA PRODUZIDA', 'CUSTO TOTAL(CAB/PERÍODO)', 'RECEITA(CAB)', 'VALOR DE VENDA(@)', 'LUCRO LÍQUIDO(CAB/PERÍODO)', 'PERCENTUAL CUSTO COMPRA NO CUSTO TOTAL', 'PERCENTUAL CUSTO FIXO NO CUSTO TOTAL', 'PERCENTUAL CUSTO ALIMENTAR NO CUSTO TOTAL', 'PERCENTUAL CUSTO SANIDADE NO CUSTO TOTAL', 'PERCENTUAL OUTROS CUSTOS NO CUSTO TOTAL', 'RENTABILIDADE (PERÍODO)', 'RENTABILIDADE (MÊS)', 'ÚLTIMO CURRAL ', 'Nº ORDEM DE COMPRA', 'CLASSIFICAÇÃO CARCAÇA', 'DENTIÇÃO'];
// Colunas do TGC que entram na conta dos lotes (as outras podem ficar em branco).
const TGC_USADAS = ['LOTE_SAIDA', 'CATEGORIA', 'RAÇA', 'PESO ENTRADA(KG)', 'PESO SAÍDA(KG)', 'PESO SAÍDA(CARCAÇA)', 'RENDIMENTO CARCAÇA (SAÍDA)', '@ PRODUZIDA (CAB)', 'DIAS CONF (CAB)', 'DIÁRIAS ALIMENTAR (TOTAL)', 'GANHO DE PESO DIA(KG)', 'DATA DE SAÍDA', 'CONSUMO MN(CAB/DIA)', 'CONSUMO MS(CAB/DIA)', 'CONVERSÃO ALIMENTAR', 'EFICIÊNCIA BIOLÓGICA', 'IMS(%PV)', 'CUSTO COMPRA BOI MAGRO(CAB)', 'CUSTO FRETE(CAB)', 'CUSTO FIXO(CAB/PERÍODO)', 'CUSTO ALIMENTAR(CAB/PERÍODO)', 'CUSTO TOTAL(CAB/PERÍODO)', 'RECEITA(CAB)', 'ÚLTIMO CURRAL '];
const TGC_DATAS = ['DATA DE ENTRADA', 'DATA DE SAÍDA'];
// Cargill Feed Manager: "Relatório de fechamento individual", títulos como saem do programa.
const CFM = ['Cidade', 'Estado', 'Proprietário', 'Cliente', 'COD. Manejo', 'Sisbov', 'Brinco eletrônico', 'Brinco extra', 'CATEGORIA', 'Tipo de Cadastro', 'Km rodado da origem', 'Peso médio do pedido de compra', 'Comprador', 'Protocolo sanitário', 'Sanidade tratamento aplicado', 'Enfermidades', 'RAÇA', 'CUSTO DE FRETE + COMISSÃO (R$/CAB)', 'CUSTO DE AQUISIÇÃO COM QUEBRA (R$/@)', 'CUSTO TOTAL DE AQUISIÇÃO (R$/CAB)', 'LOTE Saída confinamento', 'Parceiro/Rebanho', 'CV do peso de entrada do lote', 'FRIGORÍFICO DESTINO', 'PEDIDO DE COMPRA', 'ORDEM DE VENDA', 'Venda interna', 'Proprietário de origem', 'PESO BALANÇÃO (KG)', 'PESO PROCESSAMENTO (CARCAÇA) (kg)', 'Quebra de peso (kg)', 'Quebra de peso (%)', 'PESO PROCESSAMENTO (ARROBA)', 'RENDIMENTO CARCAÇA (ENTRADA) conf (%)', 'PESO PROCESSAMENTO (kg)', 'PESO SAÍDA conf (KG)', 'PESO SAÍDA (CARCAÇA) (kg)', 'PESO SAÍDA (ARROBA)', 'RENDIMENTO CARCAÇA (%) saida conf', '@ PRODUZIDA (CAB) conf', 'DIAS CONF (CAB)', 'DIAS PRÉ-CONF (CAB)', 'DIÁRIAS ALIMENTAR (TOTAL)', 'DIFERENÇA DE DIÁRIAS (CAB)', 'GANHO DIARIO DE CARCAÇA (KG)', 'GANHO DE PESO DIA (KG)', 'DATA DE ENTRADA conf', 'DATA DE PROCESSAMENTO', 'DATA DE SAÍDA conf', 'CONSUMO MS (KG/CAB/DIA)', 'Causa da morte conf', 'CONSUMO MN (KG/CAB/DIA)', 'CONSUMO MS TOTAL (KG/CAB/PERÍODO)', 'CONSUMO MN TOTAL (KG/CAB/PERÍODO)', 'CONVERSÃO ALIMENTAR (Kg de MS/kgPV)', 'EFICIÊNCIA ALIMENTAR (GPD/Cons MS dia)', 'EFICIÊNCIA BIOLÓGICA (kg de MS/@ Prod)', 'IMS (%PV)', '', 'CONSUMO Elg (mcal/CAB/DIA)', 'CUSTO DE ENTRADA ANIMAL (R$/CAB)', 'CUSTO FRETE (R$/CAB)', 'Comissão Compra (R$/CAB)', 'CUSTO TOTAL DO ANIMAL (R$/CAB)', 'CUSTO ARROBA COMPRA (R$/CAB)', 'CUSTO OPERACIONAL (R$/CAB/DIA)', 'OUTROS CUSTOS (R$/CAB/DIA)', 'CUSTO FIXO (R$/CAB/PERÍODO)', 'CUSTO ALIMENTAR (R$/CAB/PERÍODO)', 'CUSTO ALIMENTAR (R$/CAB/DIA)', 'CUSTO SANIDADE (R$/CAB/PERÍODO) conf', 'CUSTO SANIDADE (R$/CAB/DIA) conf', 'OUTROS CUSTOS (R$/CAB/PERÍODO) conf', 'OUTROS CUSTOS (R$/CAB/DIA) conf', 'CUSTO PRODUÇÃO (R$/CAB/PERÍODO) conf', 'CUSTO PRODUÇÃO (R$/CAB/DIA) conf', 'CUSTO ARROBA PRODUZIDA (R$/@ prod) conf', 'CUSTO TOTAL (R$/CAB/PERÍODO) conf', 'RECEITA (R$/CAB)', 'VALOR DE VENDA (R$/@)', 'LUCRO LÍQUIDO (R$/CAB/PERÍODO)', 'Margem líquida "Fora da porteira" (R$/cabeça)', 'Margem líquida "Dentro da porteira" (R$/cabeça)', 'Linha núcleo Adaptação', 'Linha núcleo Terminação', 'PERCENTUAL CUSTO COMPRA ANIM NO CUSTO TOTAL (%)', 'PERCENTUAL CUSTO FIXO NO CUSTO TOTAL (%)', 'PERCENTUAL CUSTO ALIMENTAR NO CUSTO TOTAL (%)', 'PERCENTUAL CUSTO SANIDADE NO CUSTO TOTAL (%)', 'PERCENTUAL OUTROS CUSTOS NO CUSTO TOTAL (%)', 'RENTABILIDADE (PERÍODO) (%)', 'RENTABILIDADE (MÊS) (%)', 'TIPO DE VENDA', 'TIPO DE MERCADO'];
const CFM_USADAS = ['LOTE Saída confinamento', 'CATEGORIA', 'Tipo de Cadastro', 'RAÇA', 'PESO PROCESSAMENTO (kg)', 'PESO SAÍDA conf (KG)', 'PESO SAÍDA (CARCAÇA) (kg)', 'RENDIMENTO CARCAÇA (%) saida conf', '@ PRODUZIDA (CAB) conf', 'DIAS CONF (CAB)', 'DIÁRIAS ALIMENTAR (TOTAL)', 'GANHO DE PESO DIA (KG)', 'DATA DE SAÍDA conf', 'CONSUMO MS (KG/CAB/DIA)', 'Causa da morte conf', 'CONSUMO MN (KG/CAB/DIA)', 'CONSUMO MS TOTAL (KG/CAB/PERÍODO)', 'IMS (%PV)', 'CUSTO DE ENTRADA ANIMAL (R$/CAB)', 'CUSTO FRETE (R$/CAB)', 'Comissão Compra (R$/CAB)', 'CUSTO FIXO (R$/CAB/PERÍODO)', 'CUSTO ALIMENTAR (R$/CAB/PERÍODO)', 'CUSTO SANIDADE (R$/CAB/PERÍODO) conf', 'OUTROS CUSTOS (R$/CAB/PERÍODO) conf', 'CUSTO TOTAL (R$/CAB/PERÍODO) conf', 'RECEITA (R$/CAB)'];
const CFM_DATAS = ['DATA DE ENTRADA conf', 'DATA DE PROCESSAMENTO', 'DATA DE SAÍDA conf'];

export const MODELOS = {
  feed: { label: 'Feed Manager', desc: 'Um lote por linha: abas BD_Zootec_Feed e BD_Econom_Feed (engorda) e BD_Zootec_Feed_ Recria_Conf.' },
  tgc: { label: 'TGC', desc: 'Um animal por linha, como sai do TGC: abas BD_TGC_Conf (engorda) e BD_TGC_Conf_Recria.' },
  cfm: { label: 'Cargill Feed Manager', desc: 'Um animal por linha, como sai o "Relatório de fechamento individual": abas BD_CFM_Conf (engorda) e BD_CFM_Conf_Recria.' },
};

function colLetter(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const FORMATO = { date: 'Data (dd/mm/aaaa)', int: 'Número inteiro', num: 'Número', text: 'Texto', list: 'Escolha da lista' };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const VERDE = fill('FF094140');
const CINZA = fill('FF6B8A88');
const CLARO = fill('FFE6EFEE');
const AMARELO = fill('FFFFFDE7');

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

export async function baixarModelo(tipo, settings, cliente) {
  const ExcelJS = await loadExcelJs();
  const wb = new ExcelJS.Workbook();
  const tgc = tipo === 'tgc';
  const cfm = tipo === 'cfm';

  // Instruções primeiro, para ser a aba que abre.
  const ins = wb.addWorksheet('Instruções');
  ins.getColumn(1).width = 110;
  const passos = cfm
    ? [
        '1. No Cargill Feed Manager, exporte o "Relatório de fechamento individual" e cole as linhas dos animais (sem as linhas de título e de cabeçalho) a partir da linha 4: engorda na aba "BD_CFM_Conf" e recria confinada na "BD_CFM_Conf_Recria". Também dá para importar o arquivo exportado direto, sem este modelo.',
        '2. Um animal por linha, inclusive os mortos. O portal junta os animais por "LOTE Saída confinamento": zootécnico pela média dos vendidos, custos e receita somados no lote, mortes contadas pela "Causa da morte conf".',
        '3. Títulos em verde escuro são as colunas usadas na conta; as em cinza podem ficar em branco.',
        '4. O relatório não traz o tipo de entrada: depois de importar, complete no portal com "Preencher em lote".',
      ]
    : tgc
    ? [
        '1. Exporte do TGC o relatório de saída por animal e cole a partir da linha 4: animais da engorda na aba "BD_TGC_Conf" e da recria confinada na "BD_TGC_Conf_Recria".',
        '2. Um animal por linha. O portal junta os animais por LOTE_SAIDA (contagem de animais e média de cada coluna), como a tabela dinâmica da planilha.',
        '3. Títulos em verde escuro são as colunas usadas na conta; as em cinza podem ficar em branco.',
        '4. O TGC não traz o tipo de entrada: depois de importar, complete no portal com "Preencher em lote".',
      ]
    : [
        '1. Cole o relatório do Feed Manager a partir da linha 4, um lote por linha: dados zootécnicos na aba "BD_Zootec_Feed" e econômicos na "BD_Econom_Feed" (o lote é ligado pela coluna A).',
        '2. Recria confinada: aba "BD_Zootec_Feed_ Recria_Conf", mesmas colunas da BD_Zootec_Feed.',
        '3. Títulos em verde escuro são obrigatórios; os em cinza são opcionais. Passe o mouse no título para ver o formato.',
        '4. Tipo de entrada, raça e categoria têm lista suspensa: use os nomes da lista. Datas em dd/mm/aaaa.',
      ];
  [
    [`Benchmarking Confinamento Probeef ${settings.ano} · modelo ${MODELOS[tipo].label}${cliente ? ` · ${cliente}` : ''}`, { bold: true, size: 14 }],
    [''],
    ['Como usar este modelo', { bold: true }],
    ...passos.map((t) => [t]),
    [`${passos.length + 1}. Na aba "${QUESTIONARIO_SHEET}", escreva a resposta na coluna "Resposta". Quando der para marcar mais de uma opção, separe por ponto e vírgula (;).`],
    [`${passos.length + 2}. No portal, clique em "Importar planilha" e escolha este arquivo. Os erros e alertas aparecem na tela para corrigir lá mesmo.`],
    [''],
    ['Não mude o nome das abas nem a posição das colunas: a importação usa a mesma estrutura da planilha de benchmarking.'],
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

  // Aba no formato da planilha: aviso na linha 1, títulos na linha 3, dados a partir da 4.
  // spec(i) → { usado, note, date, list } de cada coluna.
  const dataSheet = (name, titles, aviso, spec) => {
    const ws = wb.addWorksheet(name);
    ws.getCell('A1').value = aviso;
    ws.getCell('A1').font = { italic: true, color: { argb: 'FF555555' } };
    const head = ws.getRow(3);
    titles.forEach((t, i) => {
      const s = spec(i);
      const cell = head.getCell(i + 1);
      cell.value = t;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = s.usado ? VERDE : CINZA;
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (s.note) cell.note = s.note;
      ws.getColumn(i + 1).width = Math.max(s.date ? 12 : 10, Math.min(24, String(t).length + 2));
      const c = colLetter(i);
      if (s.date) ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy';
      if (s.list && refs[s.list]) {
        ws.dataValidations.add(`${c}4:${c}${LINHAS + 3}`, { type: 'list', allowBlank: true, formulae: [refs[s.list]], showErrorMessage: true, errorStyle: 'warning', errorTitle: t, error: 'Valor fora da lista. Use um dos nomes da lista para não dar erro na validação.' });
      }
    });
    head.height = 45;
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];
  };

  if (cfm) {
    const spec = (i) => {
      const t = CFM[i];
      return { usado: CFM_USADAS.includes(t), date: CFM_DATAS.includes(t), note: CFM_USADAS.includes(t) ? 'Usada na conta do lote' : 'Opcional' };
    };
    const aviso = 'Cole aqui o "Relatório de fechamento individual" do Cargill Feed Manager, a partir da linha 4 (um animal por linha).';
    dataSheet('BD_CFM_Conf', CFM, aviso, spec);
    dataSheet('BD_CFM_Conf_Recria', CFM, aviso, spec);
  } else if (tgc) {
    const spec = (i) => {
      const t = TGC[i];
      return { usado: TGC_USADAS.includes(t), date: TGC_DATAS.includes(t), note: TGC_USADAS.includes(t) ? 'Usada na conta do lote' : 'Opcional' };
    };
    const aviso = 'Cole aqui o relatório por animal do TGC, a partir da linha 4 (um animal por linha).';
    dataSheet('BD_TGC_Conf', TGC, aviso, spec);
    dataSheet('BD_TGC_Conf_Recria', TGC, aviso, spec);
  } else {
    const byCol = (fields) => new Map(fields.filter((f) => f.col).map((f) => [colIndex(f.col), f]));
    const zoo = byCol(ZOO_FIELDS);
    const eco = byCol([{ key: 'lote', label: 'Lote', type: 'text', col: 'A', req: true }, ...ECO_FIELDS]);
    const fieldSpec = (map, recria) => (i) => {
      const f = map.get(i);
      if (!f) return { usado: false, note: 'Não é usada pelo portal (calculada ou repetida)' };
      const req = recria ? f.reqRecria : f.req;
      return { usado: req, date: f.type === 'date', list: f.type === 'list' ? f.list : null, note: [FORMATO[f.type], f.unit ? `Unidade: ${f.unit}` : null, req ? 'Obrigatório' : 'Opcional'].filter(Boolean).join('\n') };
    };
    const aviso = 'Cole aqui o relatório do Feed Manager a partir da linha 4 (um lote por linha).';
    dataSheet('BD_Zootec_Feed', FEED_ZOO, aviso, fieldSpec(zoo, false));
    dataSheet('BD_Econom_Feed', FEED_ECO, `${aviso} O lote (coluna A) liga com a BD_Zootec_Feed.`, fieldSpec(eco, false));
    dataSheet('BD_Zootec_Feed_ Recria_Conf', FEED_ZOO, 'Recria confinada: cole o relatório do Feed Manager a partir da linha 4.', fieldSpec(zoo, true));
  }

  const qs = wb.addWorksheet(QUESTIONARIO_SHEET);
  qs.columns = [
    { header: 'Código', key: 'id', width: 8 },
    { header: 'Nº', key: 'n', width: 5 },
    { header: 'Pergunta', key: 'text', width: 60 },
    { header: 'Resposta', key: 'resp', width: 40 },
    { header: 'Como responder', key: 'how', width: 60 },
  ];
  const qh = qs.getRow(1);
  qh.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  qh.fill = VERDE;
  for (const sec of QUESTIONARIO) {
    const r = qs.addRow({ text: sec.title });
    r.font = { bold: true };
    r.fill = CLARO;
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
      resp.fill = AMARELO;
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
  a.download = `Modelo-Benchmarking-${settings.ano}-${cfm ? 'Cargill-Feed-Manager' : tgc ? 'TGC' : 'Feed-Manager'}.xlsx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Respostas da aba "Questionário" do modelo (pela coluna Código). null se a aba não existe.
export function lerQuestionario(XLSX, wb, answerFromCell) {
  const ws = wb.Sheets[QUESTIONARIO_SHEET];
  if (!ws) return null;
  const [head = [], ...rows] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const iId = head.findIndex((t) => norm(t) === 'código');
  const iResp = head.findIndex((t) => norm(t) === 'resposta');
  const respostas = {};
  if (iId < 0 || iResp < 0) return respostas;
  for (const r of rows) {
    const q = QUESTIONS.find((x) => x.id === String(r[iId] ?? '').trim());
    const a = q ? answerFromCell(q, r[iResp]) : null;
    if (a !== null && !(Array.isArray(a) && !a.length)) respostas[q.id] = a;
  }
  return respostas;
}
