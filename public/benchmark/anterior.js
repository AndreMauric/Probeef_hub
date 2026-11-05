// Leitura do questionário de uma planilha de benchmarking (do ano passado ou deste ano): usada pela página do
// Benchmarking (importar a planilha e "Trazer questionário do ano passado") e pela importação de participantes em
// lote do admin. Recebe o SheetJS já carregado (/vendor/xlsx.full.min.js) e o conteúdo do arquivo.
import { cleanAnswer, QUESTIONARIO, QUESTIONS } from './fields.js';
import { lerQuestionario, QUESTIONARIO_SHEET } from './modelo.js';

// Linha da aba Q1 (1 a 100) → pergunta do questionário (as sem número ficam pela posição).
export const Q1_ROWS = [
  ...Array.from({ length: 39 }, (_, i) => `q${i + 1}`),
  'q40a', 'q40b', 'q40c', 'q41', 'q42', 'q43', 'q44',
  ...Array.from({ length: 12 }, (_, i) => `q${45 + i}`),
  'q57', 'q58', 'q59', 'q60', 'q61', 'q62', 'q62b', 'q63', 'q63b', 'q63c', 'q64', 'q65', 'q66', 'q66b', 'q67', 'q68',
  'q69a', 'q69b', 'q69c', 'q69d', 'q69e', 'q70',
  ...Array.from({ length: 16 }, (_, i) => `q${71 + i}`),
  'q87', 'q88', 'q89', 'q90',
];

export function answerFromCell(q, v) {
  if (v === null || v === undefined || v === '') return null;
  if (q.type === 'multi') return String(v).split(';').map((x) => x.trim()).filter(Boolean);
  const { value } = cleanAnswer(q, v);
  return value ?? String(v).trim();
}

// Resposta escrita de outro jeito vira a alternativa do questionário: sem diferença de maiúscula, acento, espaço,
// ";" no fim ou dos erros de digitação da planilha e do Forms ("Getão", "Ágil de compra", "lotos", "mensamente").
// "NÃO" → Não.
const chave = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s*;\s*$/, '')
    .replace(/^getao /, 'gestao ')
    .replace(/^agil de compra/, 'agio de compra')
    .replace(/formacao de lotos/, 'formacao de lotes')
    .replace(/pago mensamente/, 'pago mensalmente')
    .replace(/\s+/g, ' ')
    .trim();
function alternativa(q, texto) {
  const opcoes = q.type === 'sn' ? ['Sim', 'Não'] : q.options || [];
  return opcoes.find((o) => chave(o) === chave(texto)) ?? texto;
}

// Na planilha, pergunta sem resposta aparece como 0 (vem de fórmula). Em pergunta de texto ou de escolha, 0 é
// "em branco"; nos custos e preços opcionais (45, 46, 52–54) também, como na importação da planilha.
const NUMERICAS = new Set(['int', 'num', 'pct']);
export function respostaAnterior(q, v) {
  if (!q) return null;
  if ((v === 0 || v === '0') && (!NUMERICAS.has(q.type) || ['q45', 'q46', 'q52', 'q53', 'q54'].includes(q.id))) return null;
  // Número escrito com texto junto ("5 ou mais" tratos por dia): fica o número.
  if (NUMERICAS.has(q.type) && typeof v === 'string' && /^\s*\d+([.,]\d+)?\s+\D/.test(v)) v = v.trim().split(/\s+/)[0];
  const a = answerFromCell(q, v);
  if (a === null || (Array.isArray(a) && !a.length)) return null;
  if (q.type === 'multi' && Array.isArray(a)) return [...new Set(a.map((x) => alternativa(q, x)))];
  if (['choice', 'sn'].includes(q.type) && typeof a === 'string') return alternativa(q, a);
  return a;
}

// Seção em que tudo veio 0 não foi respondida (a planilha mostra 0 no lugar do vazio): sai inteira. As fontes de
// energia (69a–e) somando 0 também. Um 0 numa seção respondida continua valendo (ex.: nenhuma leitura noturna).
function semSecoesZeradas(respostas) {
  for (const s of QUESTIONARIO) {
    const ids = s.questions.map((q) => q.id).filter((id) => id in respostas);
    if (ids.length && ids.every((id) => respostas[id] === 0)) ids.forEach((id) => delete respostas[id]);
  }
  const energia = ['q69a', 'q69b', 'q69c', 'q69d', 'q69e'].filter((id) => id in respostas);
  if (energia.length && energia.every((id) => !respostas[id])) energia.forEach((id) => delete respostas[id]);
  return respostas;
}

// Título de seção da aba Formulário ("SAÚDE ANIMAL", "SAÚDE ANIMAL (validar/corrigir)"): maiúsculas, sem número.
const secaoFormulario = (texto) => {
  const t = String(texto ?? '').replace(/\(.*?\)/g, '').trim();
  return Boolean(t) && !/\d/.test(t) && t === t.toUpperCase();
};

// Lê o questionário: modelo do portal (aba Questionário), aba Q1 ou aba Formulário (mesmas 100 perguntas da Q1, na
// mesma ordem, entre títulos de seção). Quando a planilha tem as duas, fica a que tiver mais respostas: na de 2025
// só a Formulário está preenchida; nas de 2026, a Q1 (a Formulário é a tela de digitação e fica vazia).
export function lerQuestionarioAnterior(XLSX, conteudo) {
  const wb = XLSX.read(conteudo, { type: 'array', sheets: [QUESTIONARIO_SHEET, 'Q1', 'Formulário'] });
  const doModelo = lerQuestionario(XLSX, wb, respostaAnterior);
  if (doModelo && Object.keys(doModelo).length) return { respostas: doModelo, aba: QUESTIONARIO_SHEET };
  const porOrdem = (linhas, aba) => {
    const respostas = {};
    Q1_ROWS.forEach((id, i) => {
      const a = respostaAnterior(QUESTIONS.find((x) => x.id === id), linhas[i]?.B);
      if (a !== null) respostas[id] = a;
    });
    semSecoesZeradas(respostas);
    return { respostas, aba, linhas: linhas.length };
  };
  const lidas = [];
  if (wb.Sheets.Q1) lidas.push(porOrdem(XLSX.utils.sheet_to_json(wb.Sheets.Q1, { header: 'A', raw: true, defval: null }), 'Q1'));
  if (wb.Sheets['Formulário']) {
    const linhas = XLSX.utils
      .sheet_to_json(wb.Sheets['Formulário'], { header: 'A', raw: true, defval: null })
      .filter((r) => String(r.A ?? '').trim() && String(r.A).trim().toLowerCase() !== 'seção' && !secaoFormulario(r.A));
    lidas.push(porOrdem(linhas, 'Formulário'));
  }
  if (!lidas.length) return { respostas: {}, aba: null };
  return lidas.reduce((a, b) => (Object.keys(b.respostas).length > Object.keys(a.respostas).length ? b : a));
}
