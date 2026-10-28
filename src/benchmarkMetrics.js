// Métricas do processo de coleta do Benchmarking (aba "Métricas do processo" do admin), pensadas
// para o projeto DMAIC: quanto tempo cada cliente levou em cada etapa, quantas rodadas de correção,
// quanto tempo cada pessoa trabalhou (e em qual parte) e onde os dados chegam com erro.
//
// Fontes:
//   sub.messages         – envio, devolução, aprovação e reabertura, com data (o histórico do envio)
//   sub.metrics.sessions – sessões de trabalho por pessoa, montadas a cada salvamento (src/benchmark.js)
//   sub.metrics.primeiro – retrato da validação quando os primeiros lotes entraram
//   access-log tool_time – tempo com a página aberta e visível, por aba (Lotes, Questionário…)
// Datas antigas (antes de out/2026) não têm sessões nem retrato: essas colunas ficam vazias.
import { toolTimeEvents } from './accessLog.js';
import { settings } from './benchmark.js';
import { fieldLabel } from '../public/benchmark/fields.js';
import { db } from './store.js';

const DAY = 24 * 60 * 60 * 1000;
const MIN_SESSION_MS = 60 * 1000; // uma sessão com um só salvamento vale 1 minuto
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
const days = (a, b) => (a && b ? Math.round(((Date.parse(b) - Date.parse(a)) / DAY) * 10) / 10 : null);
const minutes = (ms) => Math.round(ms / 60000);
const mean = (list) => {
  const v = list.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
};
const median = (list) => {
  const v = list.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
};

// Aba do benchmarking → área do processo (o tempo de cada batimento vai para a aba aberta).
const AREA = { engorda: 'lotes', recria: 'lotes', questionario: 'questionario', resultado: 'resultado' };
const areaOf = (page) => AREA[page] || 'outros';
const sessionMs = (s) => Math.max(MIN_SESSION_MS, Date.parse(s.end) - Date.parse(s.start));

// Rodadas do fluxo: cada envio até a decisão seguinte; cada devolução até o reenvio.
function rounds(messages) {
  const msgs = [...messages].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const validacao = [];
  const correcao = [];
  let pendingSince = null;
  msgs.forEach((m, i) => {
    if (m.action === 'enviado') {
      const decision = msgs.slice(i + 1).find((x) => ['devolver', 'aprovar', 'reabrir'].includes(x.action));
      if (decision) validacao.push(days(m.at, decision.at));
      else pendingSince = m.at;
    }
    if (m.action === 'devolver') {
      const resend = msgs.slice(i + 1).find((x) => x.action === 'enviado');
      if (resend) correcao.push(days(m.at, resend.at));
    }
  });
  return { msgs, validacao, correcao, pendingSince };
}

export function processMetrics() {
  const s = settings();
  const ano = s.ano;
  const since = Date.parse(`${ano}-01-01T00:00:00-03:00`);
  const users = new Map(db().users.map((u) => [u.id, u]));
  const clients = db().clients.filter((c) => c.benchmark);
  const clientName = new Map(db().clients.map((c) => [c.id, c.name]));
  const subs = new Map(db().bmkSubmissions.filter((x) => x.ano === ano).map((x) => [x.clientId, x]));
  const tool = toolTimeEvents('benchmark').filter((e) => Date.parse(e.at) >= since);

  // ---------- Por cliente ----------
  const porCliente = clients.map((c) => {
    const sub = subs.get(c.id);
    const toolSec = tool.filter((e) => e.clientId === c.id).reduce((acc, e) => acc + (e.seconds || 0), 0);
    if (!sub) return { clientId: c.id, client: c.name, status: 'nao_iniciado', toolMin: minutes(toolSec * 1000) || null };
    const { msgs, validacao, correcao, pendingSince } = rounds(sub.messages);
    const envios = msgs.filter((m) => m.action === 'enviado');
    const devolucoes = msgs.filter((m) => m.action === 'devolver').length;
    const aprovacao = sub.status === 'aprovado' ? msgs.findLast((m) => m.action === 'aprovar') : null;
    const sessions = sub.metrics?.sessions || [];
    const doCliente = sessions.filter((x) => x.role !== 'admin');
    const primeiro = sub.metrics?.primeiro || null;
    const ultimoEnvio = envios.at(-1)?.snapshot || null;
    return {
      clientId: c.id,
      client: c.name,
      status: sub.status,
      lotes: sub.engorda.length + sub.recria.length,
      inicio: sub.createdAt,
      primeiroEnvio: envios[0]?.at || null,
      aprovadoEm: aprovacao?.at || null,
      diasAtePrimeiroEnvio: days(sub.createdAt, envios[0]?.at),
      cicloDias: days(sub.createdAt, aprovacao?.at),
      envios: envios.length,
      devolucoes,
      aprovadoPrimeira: sub.status === 'aprovado' ? devolucoes === 0 : null,
      validacaoDias: mean(validacao),
      correcaoDias: mean(correcao),
      aguardandoValidacaoDias: pendingSince ? days(pendingSince, new Date().toISOString()) : null,
      pessoas: new Set(doCliente.map((x) => x.userId)).size,
      sessoes: doCliente.length,
      preenchimentoMin: doCliente.length ? minutes(doCliente.reduce((acc, x) => acc + sessionMs(x), 0)) : null,
      equipeMin: minutes(sessions.filter((x) => x.role === 'admin').reduce((acc, x) => acc + sessionMs(x), 0)) || null,
      toolMin: minutes(toolSec * 1000) || null,
      primeiro: primeiro && { at: primeiro.at, lotes: primeiro.lotes, erros: primeiro.erros, alertas: primeiro.alertas, lotesComErro: primeiro.lotesComErro, errosPorLote: primeiro.lotes ? Math.round((primeiro.erros / primeiro.lotes) * 100) / 100 : null },
      alertasNoEnvio: ultimoEnvio ? ultimoEnvio.alertas : null,
    };
  });

  // ---------- Por pessoa ----------
  const people = new Map();
  const person = (userId, clientId) => {
    if (!people.has(userId)) {
      const u = users.get(userId);
      people.set(userId, {
        userId,
        name: u?.name || 'Usuário removido',
        email: u?.email || '',
        role: u?.role === 'admin' ? 'admin' : u?.bmkValidator ? 'validador' : 'cliente',
        clients: new Set(),
        days: new Set(),
        first: null,
        last: null,
        sessoes: 0,
        salvamentos: 0,
        editandoMs: 0,
        alteracoes: { lotes: 0, questionario: 0 },
        toolSec: 0,
        area: { lotes: 0, questionario: 0, resultado: 0, outros: 0 },
      });
    }
    const p = people.get(userId);
    if (clientId) p.clients.add(clientName.get(clientId) || clientId);
    return p;
  };
  const touch = (p, iso) => {
    p.days.add(dayKey.format(new Date(iso)));
    if (!p.first || iso < p.first) p.first = iso;
    if (!p.last || iso > p.last) p.last = iso;
  };
  for (const sub of subs.values()) {
    for (const x of sub.metrics?.sessions || []) {
      const p = person(x.userId, sub.clientId);
      touch(p, x.start);
      touch(p, x.end);
      p.sessoes += 1;
      p.salvamentos += x.saves;
      p.editandoMs += sessionMs(x);
      p.alteracoes.lotes += x.parts.engorda + x.parts.recria;
      p.alteracoes.questionario += x.parts.respostas;
    }
  }
  for (const e of tool) {
    const p = person(e.userId, e.clientId);
    touch(p, e.at);
    p.toolSec += e.seconds || 0;
    for (const ps of e.pageStats || []) p.area[areaOf(ps.page)] += ps.seconds || 0;
  }
  const porPessoa = [...people.values()]
    .map((p) => ({
      userId: p.userId,
      name: p.name,
      email: p.email,
      role: p.role,
      clients: [...p.clients].sort().join(', '),
      first: p.first,
      last: p.last,
      diasAtivos: p.days.size,
      sessoes: p.sessoes,
      salvamentos: p.salvamentos,
      editandoMin: minutes(p.editandoMs),
      toolMin: minutes(p.toolSec * 1000),
      areaMin: Object.fromEntries(Object.entries(p.area).map(([k, v]) => [k, minutes(v * 1000)])),
      alteracoes: p.alteracoes,
    }))
    .sort((a, b) => (b.last || '').localeCompare(a.last || ''));

  // ---------- Onde os dados chegam com erro (Pareto) ----------
  const campos = new Map();
  for (const sub of subs.values()) {
    for (const [field, n] of Object.entries(sub.metrics?.primeiro?.porCampo || {})) {
      const c = campos.get(field) || { field, label: fieldLabel(field), erro: 0, alerta: 0, envioAlerta: 0, clientes: 0 };
      c.erro += n.erro;
      c.alerta += n.alerta;
      c.clientes += 1;
      campos.set(field, c);
    }
    const envio = sub.messages.findLast((m) => m.action === 'enviado')?.snapshot;
    for (const [field, n] of Object.entries(envio?.porCampo || {})) {
      const c = campos.get(field) || { field, label: fieldLabel(field), erro: 0, alerta: 0, envioAlerta: 0, clientes: 0 };
      c.envioAlerta += n.alerta;
      campos.set(field, c);
    }
  }
  const pareto = [...campos.values()].sort((a, b) => b.erro - a.erro || b.alerta - a.alerta);

  // ---------- Histórico completo (para o Excel / Minitab) ----------
  const eventos = [];
  for (const sub of subs.values()) {
    for (const m of sub.messages) {
      eventos.push({ client: clientName.get(sub.clientId), at: m.at, action: m.action, by: users.get(m.by)?.name || '', role: m.role, alertas: m.snapshot?.alertas ?? null, lotes: m.snapshot?.lotes ?? null });
    }
  }
  eventos.sort((a, b) => a.at.localeCompare(b.at));
  const sessoes = [];
  for (const sub of subs.values()) {
    for (const x of sub.metrics?.sessions || []) {
      sessoes.push({ client: clientName.get(sub.clientId), user: users.get(x.userId)?.name || '', role: x.role, start: x.start, end: x.end, minutos: minutes(sessionMs(x)), saves: x.saves, lotes: x.parts.engorda + x.parts.recria, questionario: x.parts.respostas });
    }
  }
  sessoes.sort((a, b) => a.start.localeCompare(b.start));

  // ---------- Resumo ----------
  const iniciados = porCliente.filter((c) => c.status !== 'nao_iniciado');
  const enviados = iniciados.filter((c) => c.envios > 0);
  const aprovados = iniciados.filter((c) => c.status === 'aprovado');
  const comPrimeiro = iniciados.filter((c) => c.primeiro);
  const totalLotesPrimeiro = comPrimeiro.reduce((acc, c) => acc + c.primeiro.lotes, 0);
  const resumo = {
    participantes: clients.length,
    iniciados: iniciados.length,
    enviados: enviados.length,
    aprovados: aprovados.length,
    emValidacao: iniciados.filter((c) => c.status === 'enviado').length,
    emCorrecao: iniciados.filter((c) => c.status === 'correcao').length,
    pctAprovadoPrimeira: aprovados.length ? Math.round((aprovados.filter((c) => c.aprovadoPrimeira).length / aprovados.length) * 100) : null,
    cicloDiasMedia: mean(aprovados.map((c) => c.cicloDias)),
    cicloDiasMediana: median(aprovados.map((c) => c.cicloDias)),
    diasAtePrimeiroEnvio: mean(enviados.map((c) => c.diasAtePrimeiroEnvio)),
    validacaoDias: mean(enviados.map((c) => c.validacaoDias)),
    devolucoesPorCliente: enviados.length ? Math.round((enviados.reduce((acc, c) => acc + c.devolucoes, 0) / enviados.length) * 10) / 10 : null,
    preenchimentoMin: mean(iniciados.map((c) => c.preenchimentoMin)),
    errosPorLotePrimeiro: totalLotesPrimeiro ? Math.round((comPrimeiro.reduce((acc, c) => acc + c.primeiro.erros, 0) / totalLotesPrimeiro) * 100) / 100 : null,
  };

  return { ano, geradoEm: new Date().toISOString(), resumo, porCliente, porPessoa, pareto, eventos, sessoes };
}
