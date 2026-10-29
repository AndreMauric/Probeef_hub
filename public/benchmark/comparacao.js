// Comparação entre clientes do benchmarking (só para o admin, por enquanto): o resultado de cada
// cliente por categoria — com o critério de exclusão aplicado, como no resultado dele — e a posição
// de cada um no grupo (média, mediana, quartis e ranking). Usado na aba Benchmarking → Comparação
// do admin e na seção "Comparação com o grupo" do relatório quando quem gera é o admin.
import { ECO_RESULT_ROWS, resultadoEngorda, resultadoRecria, separarExclusao, ZOO_RESULT_ROWS } from './fields.js';

// Sentido de cada indicador: 1 = maior é melhor, -1 = menor é melhor; sem sentido = só posição no grupo.
export const SENTIDO = {
  gpd: 1, gdc: 1, rc: 1, arrobasProduzidas: 1, valorArroba: 1, receita: 1, lucro: 1, rentabilidadeMensal: 1, foraPorteira: 1, dentroPorteira: 1,
  eficiencia: -1, conversao: -1, custoArrobaMagro: -1, custoBoiMagro: -1, custoOperacionalDia: -1, custoOperacionalTotal: -1, custoMSkg: -1,
  custoAlimentarTotal: -1, frete: -1, comissao: -1, sanitario: -1, rastreabilidade: -1, custoMortalidade: -1, custoTotal: -1,
  diariaAlimentar: -1, diariaTotal: -1, custoArrobaAlimentar: -1, custoTotalArroba: -1,
};

// Indicadores comparáveis (sem contagens de animais e lotes).
export const INDICADORES = {
  engorda: [...ZOO_RESULT_ROWS.map((r) => [...r, 'Zootécnico']), ...ECO_RESULT_ROWS.filter(([k]) => k !== 'dias').map((r) => [...r.slice(0, 3), 'Econômico'])].filter(([k]) => k !== 'animais' && k !== 'lotes'),
  recria: ZOO_RESULT_ROWS.filter(([k]) => k !== 'animais' && k !== 'lotes').map((r) => [...r, 'Zootécnico']),
};
// Os principais, para o relatório.
export const PRINCIPAIS = ['gpd', 'gdc', 'rc', 'arrobasProduzidas', 'consMS', 'eficiencia', 'conversao', 'custoTotalArroba', 'lucro', 'rentabilidadeMensal'];

// submissions: [{ clientId, client, status, engorda, recria, respostas }] (rota /api/admin/benchmark/export).
// Devolve, por cliente, o resultado de cada categoria: { engorda: { [cat]: {...zoo, ...eco} }, recria: {...} }.
export function resultadosDoGrupo(submissions, settings) {
  const cats = settings.listas.categorias;
  return submissions.map((s) => {
    const eng = separarExclusao(s.engorda || [], 'engorda', settings).incluidos;
    const rec = separarExclusao(s.recria || [], 'recria', settings).incluidos;
    const engorda = {};
    const recria = {};
    for (const c of cats) {
      const r = resultadoEngorda(eng, s.respostas || {}, c);
      if (r) engorda[c] = { ...r.zootecnico, ...r.economico };
      const rr = resultadoRecria(rec, c);
      if (rr) recria[c] = rr.zootecnico;
    }
    return { clientId: s.clientId, client: s.client, status: s.status, engorda, recria };
  });
}

const quantil = (sorted, p) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
};

export function estatisticas(valores) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  return { n: v.length, media: v.reduce((s, x) => s + x, 0) / v.length, mediana: quantil(v, 0.5), q1: quantil(v, 0.25), q3: quantil(v, 0.75), min: v[0], max: v.at(-1) };
}

// Posição de um valor no grupo: ranking (1 = melhor, se o indicador tem sentido) e quartil (1 = o
// quarto melhor). Sem sentido, o ranking vai do maior para o menor e não há "melhor".
export function posicao(valor, valores, sentido = 0) {
  const v = valores.filter((x) => Number.isFinite(x));
  if (!Number.isFinite(valor) || !v.length) return null;
  const ordem = sentido === -1 ? 1 : -1; // do melhor para o pior
  const rank = 1 + v.filter((x) => (ordem === -1 ? x > valor : x < valor)).length;
  // Quartil só com 4 clientes ou mais (com menos, "melhor 25%" não quer dizer nada).
  const quartil = v.length >= 4 ? Math.floor(((rank - 1) / v.length) * 4) + 1 : null;
  return { rank, n: v.length, quartil, sentido };
}

export const QUARTIL_LABEL = { 1: '1º quartil (melhores 25%)', 2: '2º quartil', 3: '3º quartil', 4: '4º quartil (piores 25%)' };
