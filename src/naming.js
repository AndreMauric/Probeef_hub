// Sugere cliente, categoria e nome amigável a partir do nome do relatório no Power BI.
// Ex.: "Report BAMA - Forecast" -> { client: "BAMA", category: "Forecast", displayName: "Forecast" }
//      "Report - BAMA"          -> { client: "BAMA", category: "Painel geral", displayName: "Painel geral" }

const CATEGORIES = [
  ['predicao rendimento de carcaca', 'Predição de Carcaça'],
  ['controle de salga', 'Controle de Salga'],
  ['gestao nutricional', 'Gestão Nutricional'],
  ['gestion nutricional', 'Gestão Nutricional'],
  ['saude animal', 'Saúde Animal'],
  ['forecast', 'Forecast'],
  ['sanidade', 'Sanidade'],
  ['micotoxinas', 'Micotoxinas'],
  ['reproducao', 'Reprodução'],
  ['consumos', 'Consumos'],
  ['fechamentos', 'Fechamentos'],
  ['recria', 'Recria'],
  ['gerencia', 'Gerência'],
  ['agriwebb', 'Agriwebb'],
  ['sigmabeef', 'SigmaBeef'],
  ['estoque', 'Estoque'],
];

export const GENERAL_CATEGORY = 'Painel geral';

// Relatórios internos do Power BI que não devem ir para clientes.
const SKIP = [/usage metrics/i];

export const fold = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// Chave para agrupar variações do mesmo cliente ("CAPTAR" e "Captar", "Fazenda X" e "Faz. X").
export function clientKey(name) {
  return fold(name)
    .replace(/^(fazenda|faz\.?)\s+/, '')
    .replace(/\bconfinamento\b/g, 'conf')
    .replace(/\bconf\.?/g, 'conf')
    .replace(/\bnovo cfm\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function matchCategory(part) {
  const text = part.trim();
  const folded = fold(text);
  for (const [key, label] of CATEGORIES) {
    if (folded.startsWith(key)) return { label, rest: text.slice(key.length).trim(), prefix: '' };
    // Categoria no fim: "JHS Forecast" -> cliente "JHS".
    if (folded.endsWith(` ${key}`)) return { label, rest: '', prefix: text.slice(0, text.length - key.length).trim() };
  }
  return null;
}

function tidy(text) {
  return String(text || '')
    .replace(/_/g, ' ')
    .replace(/\(\d+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function suggestFromName(originalName) {
  if (SKIP.some((re) => re.test(originalName))) {
    return { skip: true, client: '', category: GENERAL_CATEGORY, displayName: tidy(originalName) };
  }

  // Remove o prefixo "Report" e padroniza os separadores " - ".
  let rest = tidy(originalName).replace(/^report\b\s*[-_]?\s*/i, '');
  rest = rest.replace(/\s*-\s*/g, ' - ');
  const parts = rest.split(' - ').map((p) => p.trim()).filter(Boolean);

  let category = null;
  let detail = '';
  const clientParts = [];
  for (const part of parts) {
    if (category) {
      // Categoria antes do cliente ("Micotoxinas - Coperdia"); senão é complemento ("Saúde Animal - Novo").
      if (!clientParts.length) clientParts.push(part);
      else detail = [detail, part].filter(Boolean).join(' ');
      continue;
    }
    const match = matchCategory(part);
    if (!match) {
      clientParts.push(part);
      continue;
    }
    category = match.label;
    detail = match.rest;
    if (match.prefix) clientParts.push(match.prefix);
    // "Reprodução Vera cruz" sozinho: o resto é o cliente.
    if (!clientParts.length && detail) {
      clientParts.push(detail);
      detail = '';
    }
  }

  const client = tidy(clientParts.join(' - ').replace(/\bnovo cfm\b/i, ''));
  const label = category || GENERAL_CATEGORY;
  const displayName = detail ? `${label} ${detail}` : label;
  return { skip: !client, client, category: label, displayName };
}

// Escolhe o nome mais apresentável entre as variações de um mesmo cliente.
export function preferredName(names) {
  const unique = [...new Set(names.filter(Boolean))];
  const score = (n) => (n === n.toUpperCase() && n.length > 4 ? 0 : 1) * 1000 + n.length;
  return unique.sort((a, b) => score(b) - score(a))[0] || '';
}
