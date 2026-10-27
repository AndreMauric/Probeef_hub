(function () {
  "use strict";

  // ---------------- acesso ----------------
  // A autenticação é a sessão do portal BI Probeef (cookie, confere no server.js
  // quem pode abrir /confinamento). Aqui só lemos quem está logado e, se não for
  // administrador, conferimos se o acesso a esta ferramenta já foi aprovado —
  // ver src/routes/confinamento.js no projeto do portal.
  const API_BASE = "/api/confinamento";

  const loginScreen = document.getElementById("loginScreen");
  const appRoot = document.getElementById("appRoot");
  const accessStatusText = document.getElementById("accessStatusText");
  const accessRequestBtn = document.getElementById("accessRequestBtn");
  const loggedInAs = document.getElementById("loggedInAs");

  let currentUser = null;
  let isAdmin = false;

  // ---------------- uso (telemetria de abertura e tempo, para a aba Uso do admin) ----------------
  let usageViewId = null;
  let usageTimer = null;

  function postUsage(path, body, { beacon = false } = {}) {
    const payload = JSON.stringify(body);
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(path, new Blob([payload], { type: "application/json" }));
      return;
    }
    fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
  }

  function stopUsage({ beacon = false } = {}) {
    if (!usageViewId) return;
    clearInterval(usageTimer);
    postUsage("/api/usage/end", { viewId: usageViewId }, { beacon });
    usageViewId = null;
  }

  async function startUsageTracking() {
    try {
      const res = await fetch(`${API_BASE}/open`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const body = await res.json().catch(() => ({}));
      if (!body.viewId) return;
      usageViewId = body.viewId;
      usageTimer = setInterval(() => {
        if (document.visibilityState === "visible") postUsage("/api/usage/beat", { viewId: usageViewId });
      }, 60 * 1000);
    } catch (e) {
      /* telemetria é best-effort, não deve travar o app */
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!usageViewId) return;
    if (document.visibilityState === "hidden") postUsage("/api/usage/beat", { viewId: usageViewId }, { beacon: true });
    else postUsage("/api/usage/beat", { viewId: usageViewId, resume: true });
  });
  window.addEventListener("pagehide", () => stopUsage({ beacon: true }));

  function showApp(user) {
    loginScreen.hidden = true;
    appRoot.hidden = false;
    currentUser = user;
    isAdmin = user.role === "admin";
    if (loggedInAs) loggedInAs.textContent = user.name;
    startUsageTracking();
  }

  function showGate(message, canRequest) {
    loginScreen.hidden = false;
    appRoot.hidden = true;
    if (accessStatusText) accessStatusText.textContent = message;
    if (accessRequestBtn) accessRequestBtn.hidden = !canRequest;
  }

  async function boot() {
    let me;
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (!res.ok) {
        location.href = "/";
        return;
      }
      me = (await res.json()).user;
    } catch (e) {
      location.href = "/";
      return;
    }

    if (me.role === "admin") {
      showApp(me);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/status`, { credentials: "same-origin" });
      const status = (await res.json()).status;
      if (status === "approved") {
        showApp(me);
      } else if (status === "pending") {
        showGate("Seu pedido de acesso ao 4M Confinamento está aguardando aprovação do administrador do portal.", false);
      } else if (status === "denied") {
        showGate("Seu pedido de acesso ao 4M Confinamento não foi aprovado. Fale com o administrador do portal.", true);
      } else {
        showGate("Esta ferramenta precisa de liberação do administrador do portal.", true);
      }
    } catch (e) {
      showGate("Não foi possível verificar seu acesso agora. Recarregue a página.", false);
    }
  }

  if (accessRequestBtn) {
    accessRequestBtn.addEventListener("click", async () => {
      accessRequestBtn.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/request`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Falha ao enviar o pedido.");
        showGate("Pedido enviado. Você poderá usar a ferramenta assim que o administrador aprovar.", false);
      } catch (e) {
        accessStatusText.textContent = e.message;
        accessRequestBtn.disabled = false;
      }
    });
  }

  boot();

  // ---------------- tema claro/escuro ----------------
  const THEME_KEY = "4m_theme_pref";
  const themeRoot = document.documentElement;
  const themeToggle = document.getElementById("themeToggle");
  const iconSun = themeToggle ? themeToggle.querySelector(".icon-sun") : null;
  const iconMoon = themeToggle ? themeToggle.querySelector(".icon-moon") : null;

  function themeIsDark() {
    const explicit = themeRoot.getAttribute("data-theme");
    if (explicit === "dark") return true;
    if (explicit === "light") return false;
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function updateThemeIcon() {
    const dark = themeIsDark();
    if (iconSun) iconSun.hidden = dark;
    if (iconMoon) iconMoon.hidden = !dark;
  }
  function applyTheme(pref) {
    // pref: "light" | "dark" | null (segue o sistema)
    if (pref) themeRoot.setAttribute("data-theme", pref);
    else themeRoot.removeAttribute("data-theme");
    try {
      if (pref) localStorage.setItem(THEME_KEY, pref);
      else localStorage.removeItem(THEME_KEY);
    } catch (e) {
      /* segue sem lembrar a preferência nesta aba */
    }
    updateThemeIcon();
  }

  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem(THEME_KEY);
  } catch (e) {
    /* localStorage indisponível — segue o tema do sistema */
  }
  if (storedTheme === "dark" || storedTheme === "light") applyTheme(storedTheme);
  else updateThemeIcon();

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      applyTheme(themeIsDark() ? "light" : "dark");
    });
  }
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (!themeRoot.getAttribute("data-theme")) updateThemeIcon();
    });
  }

  // ---------------- estado dos controles segmentados ----------------
  // negModel/chartMetric/compareMetric são configurações de visualização
  // compartilhadas pelos dois cenários (por decisão do usuário: A e B sempre
  // comparam o mesmo modelo de negócio). Os demais campos abaixo são valores
  // de entrada e viram parte do "snapshot" de cada cenário — ver
  // SCENARIO_SEG_KEYS mais adiante.
  const state = {
    raca: "Bos indicus",
    sexo: "Inteiro",
    f21: "Confinamento",
    f41: "Confinamento",
    f8: "Não",
    f9: "Não",
    f10: "30 Dias",
    m11: "Confinamento",
    negModel: "bp",
    chartMetric: "lucro",
    compareMetric: "peso",
    calibChart: "peso",
    An: "Dieta",
    // Critérios de projeção mostrados nas tabelas da aba Comparação (um ou mais).
    compareCriteria: ["lucro", "rentTotal", "rentMensal", "diasFixo"],
  };

  // Uma mesma chave (ex.: "negModel") pode aparecer em mais de um seg-control
  // na página (aba Modelos de Negócio e aba Comparação) — clicar em qualquer
  // uma das cópias precisa sincronizar todas.
  document.querySelectorAll(".seg[data-seg]").forEach((seg) => {
    const key = seg.dataset.seg;
    seg.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (key === "scenario") {
          seg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          switchScenario(btn.dataset.value);
          return;
        }
        state[key] = btn.dataset.value;
        document.querySelectorAll(`.seg[data-seg="${key}"]`).forEach((segEl) => {
          segEl.querySelectorAll("button").forEach((b) => {
            b.classList.toggle("active", b.dataset.value === btn.dataset.value);
          });
        });
        scheduleRecompute();
      });
    });
  });

  // Seleção múltipla (data-multi): cada botão liga/desliga um valor da lista em state;
  // sempre fica pelo menos um ligado.
  function syncMultiSeg(key) {
    document.querySelectorAll(`.seg[data-multi="${key}"] button`).forEach((b) => {
      const on = state[key].includes(b.dataset.value);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }
  document.querySelectorAll(".seg[data-multi]").forEach((seg) => {
    const key = seg.dataset.multi;
    const order = [...seg.querySelectorAll("button")].map((b) => b.dataset.value);
    seg.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.value;
        const on = state[key].includes(v);
        if (on && state[key].length === 1) return;
        const next = on ? state[key].filter((x) => x !== v) : [...state[key], v];
        state[key] = order.filter((x) => next.includes(x));
        syncMultiSeg(key);
        scheduleRecompute();
      });
    });
  });

  function numVal(id) {
    return parseFloat(document.getElementById(id).value);
  }

  // Monta o objeto de entradas do motor de cálculo a partir de duas fontes
  // possíveis: os campos ao vivo do DOM + state (readInputs), ou um snapshot
  // salvo de um cenário (inputsFromSnapshot) — mesma forma, fonte diferente.
  function buildInputs(getNum, seg) {
    return {
      a1: seg.raca,
      c1: seg.sexo,
      c2: getNum("c2"),
      c3: getNum("c3"),
      d1: getNum("d1"),
      d2: getNum("d2"),
      d3: getNum("d3"),
      d5: getNum("d5"),
      d6: getNum("d6"),
      a7: getNum("a7"),
      c5: getNum("c5"),
      c6: getNum("c6"),
      c7: getNum("c7"),
      f1: getNum("f1"),
      f2: getNum("f2"),
      f21: seg.f21,
      f3: getNum("f3"),
      a3: getNum("a3"),
      d4: getNum("d4"),
      d7: getNum("d7"),
      b0: getNum("b0"),
      f4: getNum("f4"),
      f41: seg.f41,
      f5: getNum("f5"),
      f6: getNum("f6"),
      f7: getNum("f7"),
      bp1: getNum("bp1"),
      bp2: getNum("bp2"),
      bp3: getNum("bp3"),
      f8: seg.f8,
      f9: seg.f9,
      f10: seg.f10,
      m1: getNum("m1"),
      m11: seg.m11,
      m2: getNum("m2"),
      b1: getNum("b1"),
      b2: getNum("b2"),
      // Fixo: a aba Modelos de Negócio agora compara os 4 critérios de uma
      // vez, então L1 só precisa de um valor válido para o cálculo interno
      // (não influencia mais o que é exibido).
      L1: "Lucro (R$/cab.)",
      L2: getNum("L2"),
      arbp1: getNum("arbp1"),
      arbp2: getNum("arbp2"),
      arbp3: getNum("arbp3"),
      arbp4: getNum("arbp4"),
      arbp5: getNum("arbp5"),
      An: seg.An,
    };
  }

  function readInputs() {
    return buildInputs(numVal, state);
  }

  function inputsFromSnapshot(snap) {
    return buildInputs((id) => parseFloat(snap.numeric[id]), snap.seg);
  }

  // ---------------- cenários A/B ----------------
  const SCENARIO_SEG_KEYS = ["raca", "sexo", "f21", "f41", "f8", "f9", "f10", "m11", "An"];
  let activeScenario = "A";
  const scenarioSnapshots = { A: null, B: null };
  const scenarioNames = { A: "Cenário A", B: "Cenário B" };
  const scenarioNameInput = document.getElementById("scenarioNameInput");

  // Os botões da barra lateral mostram só "A"/"B" (compacto, funciona igual
  // recolhido ou expandido) — o nome customizado aparece como dica (title) e,
  // por completo, na etiqueta da aba Calibração.
  function updateScenarioButtonLabels() {
    const btnA = document.querySelector('.scenario-seg button[data-value="A"]');
    const btnB = document.querySelector('.scenario-seg button[data-value="B"]');
    if (btnA) btnA.title = scenarioNames.A;
    if (btnB) btnB.title = scenarioNames.B;
    const tag = document.getElementById("scenarioPanelTag");
    if (tag) {
      tag.textContent = activeScenario;
      tag.classList.toggle("is-b", activeScenario === "B");
    }
  }

  if (scenarioNameInput) {
    scenarioNameInput.addEventListener("input", () => {
      scenarioNames[activeScenario] = scenarioNameInput.value.trim() || (activeScenario === "A" ? "Cenário A" : "Cenário B");
      updateScenarioButtonLabels();
      scheduleRecompute();
    });
  }

  function snapshotCurrentInputs() {
    const numeric = {};
    document.querySelectorAll('input[type="number"]').forEach((inp) => {
      numeric[inp.id] = inp.value;
    });
    const seg = {};
    for (const k of SCENARIO_SEG_KEYS) seg[k] = state[k];
    return { numeric, seg };
  }

  function applySnapshot(snap) {
    document.querySelectorAll('input[type="number"]').forEach((inp) => {
      if (snap.numeric[inp.id] !== undefined) inp.value = snap.numeric[inp.id];
    });
    for (const k of SCENARIO_SEG_KEYS) {
      if (snap.seg[k] === undefined) continue;
      state[k] = snap.seg[k];
      const segEl = document.querySelector(`.seg[data-seg="${k}"]`);
      if (segEl) {
        segEl.querySelectorAll("button").forEach((b) => {
          b.classList.toggle("active", b.dataset.value === snap.seg[k]);
        });
      }
    }
  }

  function switchScenario(target) {
    if (target === activeScenario) return;
    const current = snapshotCurrentInputs();
    scenarioSnapshots[activeScenario] = current;
    activeScenario = target;
    if (!scenarioSnapshots[target]) {
      scenarioSnapshots[target] = current; // cenário novo começa como cópia do outro
    }
    applySnapshot(scenarioSnapshots[target]);
    if (scenarioNameInput) scenarioNameInput.value = scenarioNames[target];
    updateScenarioButtonLabels();
    scheduleRecompute();
  }

  updateScenarioButtonLabels();

  function inputsValid(I) {
    return Object.values(I).every((v) => typeof v === "string" || (typeof v === "number" && isFinite(v)));
  }

  // ---------------- navegação ----------------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("view-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "simulacoes") refreshSimulationsTab();
    });
  });

  document.querySelectorAll(".subtabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bar = btn.closest(".subtabs");
      bar.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      bar.parentElement.querySelectorAll(".subview").forEach((v) => v.classList.remove("active"));
      document.getElementById("sub-" + btn.dataset.sub).classList.add("active");
    });
  });

  // ---------------- sidebar recolhível ----------------
  const SIDEBAR_KEY = "4m_sidebar_collapsed";
  const sidebarEl = document.getElementById("sidebar");
  const sidebarToggleBtn = document.getElementById("sidebarToggle");
  function setSidebarCollapsed(collapsed) {
    sidebarEl.classList.toggle("collapsed", collapsed);
    sidebarToggleBtn.setAttribute("aria-expanded", String(!collapsed));
    sidebarToggleBtn.title = collapsed ? "Expandir menu" : "Recolher menu";
    sidebarToggleBtn.setAttribute("aria-label", sidebarToggleBtn.title);
  }
  if (sidebarToggleBtn) {
    let storedCollapsed = false;
    try {
      storedCollapsed = localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch (e) {
      /* localStorage indisponível — mantém expandido */
    }
    setSidebarCollapsed(storedCollapsed);
    sidebarToggleBtn.addEventListener("click", () => {
      const collapsed = !sidebarEl.classList.contains("collapsed");
      setSidebarCollapsed(collapsed);
      try {
        localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
      } catch (e) {
        /* ignora */
      }
    });
  }

  // ---------------- formatação ----------------
  function fmt(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    return v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function hexToRgba(hex, alpha) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16),
      g = parseInt(hex.slice(2, 4), 16),
      b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ---------------- tiles de calibração ----------------
  function renderCalibStats(I, summary) {
    const items = [
      { label: "Consumo de Matéria Seca", value: fmt(summary.cms, 2), unit: "kg/dia" },
      { label: "CMS % Peso Vivo", value: fmt(summary.cmsPctPV, 2), unit: "%" },
      { label: "Ganho Médio Diário", value: fmt(summary.gmd, 3), unit: "kg" },
      { label: "Rendimento de Carcaça", value: fmt(summary.rc, 2), unit: "%" },
      { label: "Ganho de Carcaça", value: fmt(summary.carcassGain, 3), unit: "kg/dia" },
      { label: "Peso Final", value: fmt(summary.finalWeight, 2), unit: "kg" },
    ];
    const el = document.getElementById("calib-stats");
    el.innerHTML = items
      .map(
        (it, i) => `
      <div class="stat-tile" style="--tile-accent: var(${i % 2 === 0 ? "--accent" : "--accent-2"});">
        <div class="label">${it.label}</div>
        <div class="value">${it.value}<span class="unit">${it.unit}</span></div>
      </div>`
      )
      .join("");
  }

  // ---------------- tabelas ----------------
  const ROLE_LABELS = { bp: "Boi Próprio", b: "Boitel", ap: "Arrobas Produzidas", p: "Parceria" };
  const ROLE_ORDER = ["bp", "b", "ap", "p"];

  const CRITERIA_ORDER = ["lucro", "rentTotal", "rentMensal", "diasFixo"];
  function criteriaLabels(I) {
    return {
      lucro: "Lucro (R$/cab.)",
      rentTotal: "Rentabilidade Total (%)",
      rentMensal: "Rentabilidade Mensal (%)",
      diasFixo: `Dias de Cocho Fixo (${I.L2})`,
    };
  }

  // columnOrder: array de chaves; columnLabels: mapa chave -> rótulo da coluna;
  // dataByKey: mapa chave -> objeto de linha (o mesmo shape usado por spec.get)
  function buildTable(tableEl, caption, rows, dataByKey, columnOrder, columnLabels) {
    let html = `<caption>${caption}</caption><thead><tr><th>Variável</th><th>Unidade</th>`;
    for (const k of columnOrder) html += `<th>${columnLabels[k]}</th>`;
    html += `</tr></thead><tbody>`;
    for (const spec of rows) {
      html += `<tr class="${spec.highlight ? "highlight" : ""}">`;
      html += `<td>${spec.label}</td><td>${spec.unit}</td>`;
      for (const k of columnOrder) {
        const rowData = dataByKey[k];
        const v = rowData ? spec.get(rowData) : null;
        if (v === null || v === undefined || !isFinite(v)) {
          html += `<td class="dash">—</td>`;
          continue;
        }
        const cls = spec.signed ? (v >= 0 ? "pos" : "neg") : "";
        html += `<td class="${cls}">${fmt(v, spec.dec)}</td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody>`;
    tableEl.innerHTML = html;
  }

  const ZOOT_ROWS = [
    { label: "Dias de Cocho", unit: "dias", get: (r) => r.dias, dec: 0 },
    { label: "Peso de Entrada", unit: "kg", get: (r) => r.pesoEntradaKg, dec: 2 },
    { label: "Peso de Entrada", unit: "@", get: (r) => r.pesoEntradaArroba, dec: 2 },
    { label: "Peso de Saída", unit: "kg", get: (r) => r.pesoSaidaKg, dec: 2 },
    { label: "Peso de Saída", unit: "@", get: (r) => r.pesoSaidaArroba, dec: 2 },
    { label: "Consumo Médio de Matéria Seca", unit: "kg/dia", get: (r) => r.cms, dec: 2 },
    { label: "Consumo de Matéria Seca (acum.)", unit: "kg", get: (r) => r.cmsAcumulado, dec: 2 },
    { label: "Ganho Médio Diário", unit: "kg/dia", get: (r) => r.gmd, dec: 3 },
    { label: "Rendimento de Carcaça", unit: "%", get: (r) => r.rc, dec: 2 },
    { label: "Ganho Médio de Carcaça", unit: "kg/dia", get: (r) => r.gdc, dec: 3 },
    { label: "Rendimento do Ganho", unit: "%", get: (r) => r.rg, dec: 2 },
    { label: "Arrobas Produzidas", unit: "@", get: (r) => r.arrobasProduzidas, dec: 2, highlight: true },
    { label: "Conversão Alimentar", unit: "kg/kg", get: (r) => r.conversao, dec: 2 },
    { label: "Eficiência Biológica", unit: "kgMS/@", get: (r) => r.eb, dec: 2 },
    { label: "Preço de Venda", unit: "R$/@", get: (r) => r.precoVenda, dec: 2 },
  ];

  const ECON_CONF_ROWS = [
    { label: "Dias de Cocho", unit: "dias", get: (r) => r.dias, dec: 0 },
    { label: "Custo Boi Magro", unit: "R$/cab.", get: (r) => r.custoBoiMagro, dec: 2 },
    { label: "Juros Gado", unit: "R$/cab.", get: (r) => r.jurosGado, dec: 2 },
    { label: "Custo Frete", unit: "R$/cab.", get: (r) => r.custoFrete, dec: 2 },
    { label: "Custo Processamento", unit: "R$/cab.", get: (r) => r.custoProcessamento, dec: 2 },
    { label: "Custo Sanitário", unit: "R$/cab.", get: (r) => r.custoSanitario, dec: 2 },
    { label: "Custo Operacional", unit: "R$/cab.", get: (r) => r.custoOperacional, dec: 2 },
    { label: "Custo Alimentar", unit: "R$/cab.", get: (r) => r.custoAlimentar, dec: 2 },
    { label: "Juros Alimentar", unit: "R$/cab.", get: (r) => r.jurosAlimentar, dec: 2 },
    { label: "Custo de Produção", unit: "R$/cab.", get: (r) => r.custoProducao, dec: 2 },
    { label: "Custo da Arroba", unit: "R$/@", get: (r) => r.custoArroba, dec: 2 },
    { label: "Custo Mortalidade", unit: "R$/cab.", get: (r) => r.custoMortalidade, dec: 2 },
    { label: "Custo Total", unit: "R$/cab.", get: (r) => r.custoTotal, dec: 2 },
    { label: "Receita", unit: "R$/cab.", get: (r) => r.receita, dec: 2 },
    { label: "Margem do Confinamento", unit: "R$/cab.", get: (r) => r.margem, dec: 2, signed: true, highlight: true },
    { label: "Rentabilidade Total", unit: "%", get: (r) => r.rentTotal, dec: 2, signed: true },
    { label: "Rentabilidade Mensal", unit: "% a.m.", get: (r) => r.rentMensal, dec: 2, signed: true },
  ];

  const ECON_PARC_ROWS = [
    { label: "Dias de Cocho", unit: "dias", get: (r) => r.dias, dec: 0 },
    { label: "Custo Boi Magro (entrada)", unit: "R$", get: (r) => r.custoBoiMagro, dec: 2 },
    { label: "Custo com Confinamento", unit: "R$", get: (r) => r.custoConfinamento, dec: 2 },
    { label: "Custo do Frete", unit: "R$", get: (r) => r.custoFrete, dec: 2 },
    { label: "Custo de Processamento", unit: "R$", get: (r) => r.custoProcessamento, dec: 2 },
    { label: "Custo de Mortalidade", unit: "R$", get: (r) => r.custoMortalidade, dec: 2 },
    { label: "Custo Total do Parceiro", unit: "R$", get: (r) => r.custoTotal, dec: 2 },
    { label: "Custo da Arroba Produzida", unit: "R$/@", get: (r) => r.custoArroba, dec: 2 },
    { label: "Receita", unit: "R$", get: (r) => r.receita, dec: 2 },
    { label: "Margem do Parceiro", unit: "R$", get: (r) => r.margem, dec: 2, signed: true, highlight: true },
    { label: "Rentabilidade Total", unit: "%", get: (r) => r.rentTotal, dec: 2, signed: true },
    { label: "Rentabilidade Mensal", unit: "% a.m.", get: (r) => r.rentMensal, dec: 2, signed: true },
  ];

  // ---------------- CSV ----------------
  function tableToCSV(tableEl) {
    const rows = [...tableEl.querySelectorAll("tr")];
    return rows.map((tr) => [...tr.querySelectorAll("th,td")].map((td) => td.textContent.trim()).join(";")).join("\n");
  }

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tableEl = document.getElementById(btn.dataset.copy);
      const csv = tableToCSV(tableEl);
      try {
        await navigator.clipboard.writeText(csv);
        showToast("CSV copiado — cole em uma planilha");
      } catch (e) {
        showToast("Não foi possível copiar automaticamente");
      }
    });
  });

  let toastTimer = null;
  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------------- gráficos ----------------
  // Chart.js vem de um CDN externo: se a rede bloquear o download (ex.: rede
  // corporativa sem acesso a cdnjs, ou o arquivo aberto offline direto do disco),
  // `Chart` não existe. Isso não pode derrubar o resto do app (tabelas, tiles,
  // inputs), então cada função de gráfico vira um no-op nesse caso.
  const HAS_CHART = typeof Chart !== "undefined";
  // Registro de instâncias Chart.js por id de canvas. O mesmo gráfico pode ser
  // desenhado tanto no canvas fixo da página quanto no canvas do modal de
  // ampliação — cada canvasId tem sua própria instância rastreada aqui, então
  // reaproveitar o mesmo canvasId (ex.: reabrir o modal) destrói e recria certo.
  const chartInstances = {};
  function destroyChart(canvasId) {
    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
      delete chartInstances[canvasId];
    }
  }
  function trackChart(canvasId, chart) {
    chartInstances[canvasId] = chart;
  }

  if (!HAS_CHART) {
    console.warn(
      "4M Confinamento: a biblioteca Chart.js não carregou (provável bloqueio de rede a cdnjs.cloudflare.com). " +
        "Os cálculos, tiles e tabelas continuam funcionando normalmente; só os gráficos ficam ocultos."
    );
  }

  if (HAS_CHART) {
    Chart.register({
      id: "vLine",
      afterDatasetsDraw(chart, _args, opts) {
        if (opts.x == null) return;
        const { ctx, chartArea, scales } = chart;
        if (!scales.x) return;
        const xPix = scales.x.getPixelForValue(opts.x);
        if (xPix < chartArea.left || xPix > chartArea.right) return;
        ctx.save();
        ctx.strokeStyle = opts.color || cssVar("--text");
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xPix, chartArea.top);
        ctx.lineTo(xPix, chartArea.bottom);
        ctx.stroke();
        if (opts.label) {
          ctx.setLineDash([]);
          ctx.fillStyle = opts.color || cssVar("--text");
          ctx.font = "600 11px 'Public Sans', sans-serif";
          ctx.fillText(opts.label, xPix + 6, chartArea.top + 14);
        }
        ctx.restore();
      },
    });
  }

  function baseGrid() {
    return {
      color: hexToRgba(cssVar("--border") || "#888888", 1),
      borderColor: cssVar("--border"),
    };
  }
  function baseTicks() {
    return { color: cssVar("--text-muted"), font: { family: "IBM Plex Mono", size: 11 } };
  }

  function renderPesoChart(C, I, canvasId) {
    if (!HAS_CHART) return;
    canvasId = canvasId || "chartPeso";
    const el = document.getElementById(canvasId);
    if (!el) return;
    const data = [];
    for (let i = 0; i < C.N; i++) {
      data.push({ x: i + 1, y: C.PM[i] });
    }
    destroyChart(canvasId);
    const chart = new Chart(el, {
      type: "line",
      data: {
        datasets: [
          {
            label: "Peso vivo (kg)",
            data,
            borderColor: cssVar("--accent"),
            backgroundColor: hexToRgba(cssVar("--accent"), 0.12),
            fill: true,
            pointRadius: 0,
            borderWidth: 2.5,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        animation: { duration: 250 },
        plugins: {
          legend: { display: false },
          vLine: { x: I.c3, color: cssVar("--accent-2"), label: `Dia atual (${I.c3})` },
        },
        scales: {
          x: { type: "linear", title: { display: true, text: "Dias de cocho", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: { ...baseTicks(), maxTicksLimit: 12 } },
          y: { title: { display: true, text: "kg", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
        },
      },
    });
    trackChart(canvasId, chart);
    return chart;
  }

  function renderGanhoChart(C, I, canvasId) {
    if (!HAS_CHART) return;
    canvasId = canvasId || "chartGanho";
    const el = document.getElementById(canvasId);
    if (!el) return;
    const gmdData = [];
    const gdcData = [];
    for (let i = 0; i < C.N; i++) {
      const day = i + 1;
      gmdData.push({ x: day, y: C.gmd[i] });
      const gdc = (((C.PM[i] * C.RC[i]) / 100 - (I.c2 * I.a7) / 100) / day);
      gdcData.push({ x: day, y: gdc });
    }
    destroyChart(canvasId);
    const chart = new Chart(el, {
      type: "line",
      data: {
        datasets: [
          {
            label: "GMD — ganho médio diário (kg/dia)",
            data: gmdData,
            borderColor: cssVar("--accent"),
            backgroundColor: hexToRgba(cssVar("--accent"), 0.08),
            pointRadius: 0,
            borderWidth: 2.5,
            tension: 0.15,
          },
          {
            label: "GDC — ganho médio de carcaça (kg/dia)",
            data: gdcData,
            borderColor: cssVar("--accent-2"),
            backgroundColor: hexToRgba(cssVar("--accent-2"), 0.08),
            pointRadius: 0,
            borderWidth: 2.5,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        animation: { duration: 250 },
        plugins: {
          legend: { position: "bottom", labels: { color: cssVar("--text-muted"), usePointStyle: true, boxWidth: 8 } },
          vLine: { x: I.c3, color: cssVar("--text-muted"), label: `Dia atual (${I.c3})` },
        },
        scales: {
          x: { type: "linear", title: { display: true, text: "Dias de cocho", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: { ...baseTicks(), maxTicksLimit: 12 } },
          y: { title: { display: true, text: "kg/dia", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
        },
      },
    });
    trackChart(canvasId, chart);
    return chart;
  }

  function renderConsumoChart(C, I, canvasId) {
    if (!HAS_CHART) return;
    canvasId = canvasId || "chartConsumo";
    const el = document.getElementById(canvasId);
    if (!el) return;
    const cmsData = [];
    const imsData = [];
    for (let i = 0; i < C.N; i++) {
      const day = i + 1;
      cmsData.push({ x: day, y: C.cms[i] });
      const pctPV = (C.cms[i] / ((I.c2 + C.PM[i]) / 2)) * 100;
      imsData.push({ x: day, y: pctPV });
    }
    destroyChart(canvasId);
    const chart = new Chart(el, {
      type: "line",
      data: {
        datasets: [
          {
            label: "CMS calibrado (kg/dia)",
            data: cmsData,
            borderColor: cssVar("--accent"),
            backgroundColor: hexToRgba(cssVar("--accent"), 0.08),
            pointRadius: 0,
            borderWidth: 2.5,
            tension: 0.15,
            yAxisID: "y",
          },
          {
            label: "IMS — % do peso vivo",
            data: imsData,
            borderColor: cssVar("--accent-2"),
            backgroundColor: hexToRgba(cssVar("--accent-2"), 0.08),
            pointRadius: 0,
            borderWidth: 2.5,
            tension: 0.15,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        animation: { duration: 250 },
        plugins: {
          legend: { position: "bottom", labels: { color: cssVar("--text-muted"), usePointStyle: true, boxWidth: 8 } },
          vLine: { x: I.c3, color: cssVar("--text-muted"), label: `Dia atual (${I.c3})` },
        },
        scales: {
          x: { type: "linear", title: { display: true, text: "Dias de cocho", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: { ...baseTicks(), maxTicksLimit: 12 } },
          y: { position: "left", title: { display: true, text: "CMS (kg/dia)", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
          y1: { position: "right", title: { display: true, text: "IMS (% PV)", color: cssVar("--text-muted") }, grid: { display: false }, ticks: baseTicks() },
        },
      },
    });
    trackChart(canvasId, chart);
    return chart;
  }

  // Aba Calibração: os três gráficos (peso, ganho, consumo) dividem um único
  // canvas — este dispatcher decide qual renderizar conforme o botão escolhido.
  function calibChartInfo(key) {
    if (key === "gmd") {
      return {
        title: "Ganho de peso e de carcaça",
        sub: "GMD (ganho médio diário) e GDC (ganho médio de carcaça, acumulado desde a entrada) previstos para cada dia de cocho.",
        render: renderGanhoChart,
      };
    }
    if (key === "cms") {
      return {
        title: "Consumo de matéria seca",
        sub: "CMS calibrado ao campo (kg/dia, eixo esquerdo) e IMS — ingestão em % do peso vivo (eixo direito) — dia a dia.",
        render: renderConsumoChart,
      };
    }
    return {
      title: "Curva de peso vivo",
      sub: "Evolução do peso corporal ao longo dos dias de cocho — ponto marcado no dia atual.",
      render: renderPesoChart,
    };
  }

  function renderCalibChart(C, I, canvasId) {
    canvasId = canvasId || "chartCalib";
    const info = calibChartInfo(state.calibChart);
    if (canvasId === "chartCalib") {
      document.getElementById("calib-chart-title").textContent = info.title;
      document.getElementById("calib-chart-sub").textContent = info.sub;
    }
    return info.render(C, I, canvasId);
  }

  function chartMetricInfo(key) {
    if (key === "rentTotal") return { seriesKey: "rent", criterionKey: "rentTotal", label: "Rentabilidade Total (%)", unit: "%" };
    if (key === "rentMensal") return { seriesKey: "rent_m", criterionKey: "rentMensal", label: "Rentabilidade Mensal (%)", unit: "% a.m." };
    return { seriesKey: "lucro", criterionKey: "lucro", label: "Lucro (R$/cab.)", unit: "R$/cab." };
  }

  function renderModelosChart(criteriaResult, I, role, canvasId) {
    canvasId = canvasId || "chartModelos";
    const m = chartMetricInfo(state.chartMetric);
    if (canvasId === "chartModelos") {
      document.getElementById("graf-title").textContent = `${m.label} por dia de cocho — ${ROLE_LABELS[role]}`;
    }
    const series = criteriaResult.series[m.seriesKey];
    const data = [];
    for (let i = 21; i < series.length; i++) {
      data.push({ x: i + 1, y: series[i] });
    }
    const atualDay = I.c3;
    const otimoDay = criteriaResult.byCriterion[m.criterionKey].day;
    if (!HAS_CHART) return;
    const el = document.getElementById(canvasId);
    if (!el) return;
    destroyChart(canvasId);
    const chart = new Chart(el, {
      type: "line",
      data: {
        datasets: [
          {
            label: m.label,
            data,
            borderColor: cssVar("--accent"),
            backgroundColor: hexToRgba(cssVar("--accent"), 0.1),
            fill: true,
            pointRadius: 0,
            borderWidth: 2.5,
            tension: 0.1,
          },
          {
            label: "Atual",
            data: atualDay >= 1 && atualDay <= series.length ? [{ x: atualDay, y: series[atualDay - 1] }] : [],
            borderColor: "transparent",
            pointBackgroundColor: cssVar("--accent-2"),
            pointBorderColor: cssVar("--surface"),
            pointBorderWidth: 2,
            pointRadius: 7,
            showLine: false,
          },
          {
            label: "Ponto ótimo",
            data: otimoDay >= 1 && otimoDay <= series.length ? [{ x: otimoDay, y: series[otimoDay - 1] }] : [],
            borderColor: "transparent",
            pointBackgroundColor: cssVar("--negative"),
            pointBorderColor: cssVar("--surface"),
            pointBorderWidth: 2,
            pointRadius: 7,
            showLine: false,
          },
        ],
      },
      options: {
        responsive: true,
        animation: { duration: 250 },
        plugins: {
          legend: { position: "bottom", labels: { color: cssVar("--text-muted"), usePointStyle: true, boxWidth: 8 } },
        },
        scales: {
          x: { type: "linear", title: { display: true, text: "Dias de cocho", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: { ...baseTicks(), maxTicksLimit: 12 } },
          y: { title: { display: true, text: m.unit, color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
        },
      },
    });
    trackChart(canvasId, chart);
    return chart;
  }

  function histogram(data, nbins) {
    const min = Math.min(...data),
      max = Math.max(...data);
    const w = (max - min) / nbins;
    const counts = new Array(nbins).fill(0);
    for (const v of data) {
      let idx = Math.floor((v - min) / w);
      if (idx >= nbins) idx = nbins - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    }
    const points = [];
    for (let i = 0; i < nbins; i++) {
      points.push({ x: min + w * (i + 0.5), density: counts[i] / (data.length * w) });
    }
    return points;
  }

  function renderHistChart(risk, I, canvasId) {
    if (!HAS_CHART) return;
    canvasId = canvasId || "chartHist";
    const el = document.getElementById(canvasId);
    if (!el) return;
    const threshold = I.arbp5;
    const points = histogram(risk.lucroSim, 30);
    const positive = cssVar("--positive"),
      negative = cssVar("--negative");
    destroyChart(canvasId);
    const chart = new Chart(el, {
      type: "bar",
      data: {
        datasets: [
          {
            label: "Densidade",
            data: points.map((p) => ({ x: p.x, y: p.density })),
            backgroundColor: points.map((p) => hexToRgba(p.x < threshold ? negative : positive, 0.75)),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        animation: { duration: 250 },
        plugins: {
          legend: { display: false },
          vLine: { x: threshold, color: cssVar("--text"), label: `Margem mínima (R$ ${fmt(threshold, 0)})` },
        },
        scales: {
          x: { type: "linear", title: { display: true, text: "Margem líquida (R$/cab.)", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
          y: { title: { display: true, text: "Densidade", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
        },
      },
    });
    trackChart(canvasId, chart);
    return chart;
  }

  function renderScatterChart(risk, I, canvasId) {
    canvasId = canvasId || "chartScatter";
    if (canvasId === "chartScatter") {
      document.getElementById("risk-scatter-title").textContent = `Margem vs. ${risk.xLabel}`;
      document.getElementById("risk-scatter-sub").textContent = `Inclinação estimada: ${fmt(risk.slope, 2)} R$/cab. por unidade de ${risk.xLabel.toLowerCase()}.`;
    }
    if (!HAS_CHART) return;
    const el = document.getElementById(canvasId);
    if (!el) return;
    const n = risk.x.length;
    const step = Math.max(1, Math.floor(n / 900));
    const scatterPts = [];
    for (let i = 0; i < n; i += step) scatterPts.push({ x: risk.x[i], y: risk.lucroSim[i] });
    const xs = risk.x;
    const xmin = Math.min(...xs),
      xmax = Math.max(...xs);
    const lineData = [
      { x: xmin, y: risk.intercept + risk.slope * xmin },
      { x: xmax, y: risk.intercept + risk.slope * xmax },
    ];
    destroyChart(canvasId);
    const chart = new Chart(el, {
      data: {
        datasets: [
          {
            type: "scatter",
            label: "Cenários simulados",
            data: scatterPts,
            backgroundColor: hexToRgba(cssVar("--accent"), 0.35),
            pointRadius: 2.5,
          },
          {
            type: "line",
            label: "Regressão linear",
            data: lineData,
            borderColor: cssVar("--accent-2"),
            borderWidth: 2.5,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        animation: { duration: 250 },
        plugins: {
          legend: { position: "bottom", labels: { color: cssVar("--text-muted"), usePointStyle: true, boxWidth: 8 } },
        },
        scales: {
          x: { type: "linear", title: { display: true, text: risk.xLabel, color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
          y: { title: { display: true, text: "Margem líquida (R$/cab.)", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
        },
      },
    });
    trackChart(canvasId, chart);
    return chart;
  }

  function renderRiskKpis(risk, I) {
    const el = document.getElementById("risk-kpis");
    const items = [
      { label: "Dia de cocho considerado", value: `${risk.day} dias` },
      { label: "Margem média simulada", value: `R$ ${fmt(risk.mean, 2)}` },
      { label: "Desvio padrão", value: `R$ ${fmt(risk.sd, 2)}` },
      { label: `Prob. margem < R$ ${fmt(I.arbp5, 0)}`, value: `${fmt(risk.probLucro, 1)}%` },
    ];
    el.innerHTML = items.map((it) => `<div class="kpi-pill">${it.label}<b>${it.value}</b></div>`).join("");
  }

  // ---------------- comparação de cenários ----------------
  function renderCompareStats(A, B) {
    const legend = document.getElementById("compare-legend");
    if (legend) {
      legend.innerHTML = `<span><span class="dot a"></span>${scenarioNames.A}</span><span><span class="dot b"></span>${scenarioNames.B}</span>`;
    }
    const items = [
      { label: "Consumo de Matéria Seca", a: A.summary.cms, b: B.summary.cms, dec: 2, unit: "kg/dia" },
      { label: "CMS % Peso Vivo", a: A.summary.cmsPctPV, b: B.summary.cmsPctPV, dec: 2, unit: "%" },
      { label: "Ganho Médio Diário", a: A.summary.gmd, b: B.summary.gmd, dec: 3, unit: "kg" },
      { label: "Rendimento de Carcaça", a: A.summary.rc, b: B.summary.rc, dec: 2, unit: "%" },
      { label: "Ganho de Carcaça", a: A.summary.carcassGain, b: B.summary.carcassGain, dec: 3, unit: "kg/dia" },
      { label: "Peso Final", a: A.summary.finalWeight, b: B.summary.finalWeight, dec: 2, unit: "kg" },
    ];
    const el = document.getElementById("compare-stats");
    el.innerHTML = items
      .map((it) => {
        const delta = it.b - it.a;
        const sign = delta >= 0 ? "+" : "";
        return `
        <div class="stat-tile compare-stat">
          <div class="label">${it.label}</div>
          <div class="compare-pair"><span class="a">${fmt(it.a, it.dec)}</span><span class="sep">vs</span><span class="b">${fmt(it.b, it.dec)}</span></div>
          <div class="compare-delta">${it.unit} · Δ (${scenarioNames.B} − ${scenarioNames.A}): ${sign}${fmt(delta, it.dec)}</div>
        </div>`;
      })
      .join("");
  }

  function compareMetricInfo(key) {
    if (key === "gmd") return { arr: "gmd", label: "Ganho Médio Diário", unit: "kg/dia" };
    if (key === "cms") return { arr: "cms", label: "Consumo de Matéria Seca", unit: "kg/dia" };
    return { arr: "PM", label: "Peso Vivo", unit: "kg" };
  }

  function renderCompareChart(A, B, canvasId) {
    canvasId = canvasId || "chartCompare";
    const m = compareMetricInfo(state.compareMetric);
    if (canvasId === "chartCompare") {
      document.getElementById("compare-chart-title").textContent = `${m.label} — ${scenarioNames.A} vs. ${scenarioNames.B}`;
      document.getElementById("compare-chart-sub").textContent = `Linha sólida (azul): ${scenarioNames.A}. Linha tracejada (âmbar): ${scenarioNames.B}.`;
    }
    if (!HAS_CHART) return;
    const el = document.getElementById(canvasId);
    if (!el) return;
    const dataA = [],
      dataB = [];
    for (let i = 0; i < A.C.N; i++) dataA.push({ x: i + 1, y: A.C[m.arr][i] });
    for (let i = 0; i < B.C.N; i++) dataB.push({ x: i + 1, y: B.C[m.arr][i] });
    destroyChart(canvasId);
    const chart = new Chart(el, {
      type: "line",
      data: {
        datasets: [
          { label: scenarioNames.A, data: dataA, borderColor: cssVar("--accent"), backgroundColor: "transparent", pointRadius: 0, borderWidth: 2.5, tension: 0.15 },
          { label: scenarioNames.B, data: dataB, borderColor: cssVar("--accent-2"), backgroundColor: "transparent", pointRadius: 0, borderWidth: 2.5, borderDash: [6, 4], tension: 0.15 },
        ],
      },
      options: {
        responsive: true,
        animation: { duration: 250 },
        plugins: { legend: { position: "bottom", labels: { color: cssVar("--text-muted"), usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { type: "linear", title: { display: true, text: "Dias de cocho", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: { ...baseTicks(), maxTicksLimit: 12 } },
          y: { title: { display: true, text: m.unit, color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
        },
      },
    });
    trackChart(canvasId, chart);
    return chart;
  }

  function renderCompareModelTables(A, B) {
    document.getElementById("compare-models-title").textContent = `Modelos de negócio — ${ROLE_LABELS[state.negModel]}`;
    const all = state.compareCriteria.length === CRITERIA_ORDER.length;
    document.getElementById("compare-models-hint").textContent = `${all ? "Todos os critérios de projeção" : "Os critérios de projeção escolhidos"} lado a lado — cada um com o ${scenarioNames.A} e o ${scenarioNames.B}.`;
    renderDefTable("table-compare-zoot");
    renderDefTable("table-compare-econ");
    renderDefTable("table-compare-parc");
  }

  // Monta colunas cruzando os critérios de projeção escolhidos com os 2 cenários
  // (Lucro-A, Lucro-B, Rentabilidade Total-A, Rentabilidade Total-B, ...).
  function compareAllCriteriaColumns(dataKey) {
    const labels = criteriaLabels(lastState.compareA.I);
    const columnOrder = [];
    const columnLabels = {};
    const dataByKey = {};
    for (const c of CRITERIA_ORDER.filter((k) => state.compareCriteria.includes(k))) {
      for (const s of ["A", "B"]) {
        const key = `${c}_${s}`;
        columnOrder.push(key);
        columnLabels[key] = `${labels[c]} — ${scenarioNames[s]}`;
        const bundle = s === "A" ? lastState.compareA : lastState.compareB;
        dataByKey[key] = bundle.criteriaResult.byCriterion[c][dataKey];
      }
    }
    return { columnOrder, columnLabels, dataByKey };
  }

  function renderCompareRiskKpis(A, B) {
    const el = document.getElementById("compare-risk-kpis");
    const delta = B.risk.mean - A.risk.mean;
    const sign = delta >= 0 ? "+" : "";
    const items = [
      { label: `Margem média — ${scenarioNames.A}`, value: `R$ ${fmt(A.risk.mean, 2)}` },
      { label: `Margem média — ${scenarioNames.B}`, value: `R$ ${fmt(B.risk.mean, 2)}` },
      { label: `Diferença (${scenarioNames.B} − ${scenarioNames.A})`, value: `${sign}R$ ${fmt(delta, 2)}` },
      { label: "Prob. margem baixa — A / B", value: `${fmt(A.risk.probLucro, 1)}% / ${fmt(B.risk.probLucro, 1)}%` },
    ];
    el.innerHTML = items.map((it) => `<div class="kpi-pill">${it.label}<b>${it.value}</b></div>`).join("");
  }

  function minMaxOfTwo(a, b) {
    let min = Infinity,
      max = -Infinity;
    for (const v of a) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    for (const v of b) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return [min, max];
  }

  function histogramShared(data, nbins, min, max) {
    const w = (max - min) / nbins;
    const counts = new Array(nbins).fill(0);
    for (const v of data) {
      let idx = Math.floor((v - min) / w);
      if (idx >= nbins) idx = nbins - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    }
    const points = [];
    for (let i = 0; i < nbins; i++) points.push({ x: min + w * (i + 0.5), y: counts[i] / (data.length * w) });
    return points;
  }

  function renderCompareRiskChart(A, B, canvasId) {
    canvasId = canvasId || "chartCompareRisk";
    if (canvasId === "chartCompareRisk") {
      document.getElementById("compare-risk-title").textContent = `Distribuição da margem líquida — ${scenarioNames.A} vs. ${scenarioNames.B}`;
      document.getElementById("compare-risk-sub").textContent = `${scenarioNames.A} em azul, ${scenarioNames.B} em âmbar.`;
    }
    if (!HAS_CHART) return;
    const el = document.getElementById(canvasId);
    if (!el) return;
    const [min, max] = minMaxOfTwo(A.risk.lucroSim, B.risk.lucroSim);
    const ptsA = histogramShared(A.risk.lucroSim, 30, min, max);
    const ptsB = histogramShared(B.risk.lucroSim, 30, min, max);
    destroyChart(canvasId);
    const chart = new Chart(el, {
      type: "bar",
      data: {
        datasets: [
          { label: scenarioNames.A, data: ptsA, backgroundColor: hexToRgba(cssVar("--accent"), 0.55), borderWidth: 0 },
          { label: scenarioNames.B, data: ptsB, backgroundColor: hexToRgba(cssVar("--accent-2"), 0.55), borderWidth: 0 },
        ],
      },
      options: {
        responsive: true,
        animation: { duration: 250 },
        plugins: { legend: { position: "bottom", labels: { color: cssVar("--text-muted"), usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { type: "linear", title: { display: true, text: "Margem líquida (R$/cab.)", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
          y: { title: { display: true, text: "Densidade", color: cssVar("--text-muted") }, grid: baseGrid(), ticks: baseTicks() },
        },
      },
    });
    trackChart(canvasId, chart);
    return chart;
  }

  function renderComparisonTab() {
    const A = lastState.compareA,
      B = lastState.compareB;
    if (!A || !B) return;
    const desc = document.getElementById("compare-page-desc");
    if (desc) desc.textContent = `Compare o ${scenarioNames.A} e o ${scenarioNames.B} lado a lado. Troque qual está sendo editado no alternador da barra lateral.`;
    const banner = document.getElementById("compareBanner");
    if (banner) {
      banner.hidden = lastState.compareBConfigured;
      banner.textContent = `O ${scenarioNames.B} ainda não tem valores próprios — por enquanto ele é uma cópia do ${scenarioNames.A}. Troque para "${scenarioNames.B}" na barra lateral e ajuste os parâmetros que você quer comparar.`;
    }
    renderCompareStats(A, B);
    renderCompareChart(A, B);
    renderCompareModelTables(A, B);
    renderCompareRiskKpis(A, B);
    renderCompareRiskChart(A, B);
  }

  // ---------------- ciclo principal ----------------
  let debounceTimer = null;
  function scheduleRecompute() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(recompute, 90);
  }

  // Guarda o último estado calculado para que o modal de ampliação possa
  // redesenhar qualquer gráfico/tabela sob demanda, sem recalcular tudo de novo.
  const lastState = {};

  function tableCaption(def, role) {
    return `${def.title} — ${ROLE_LABELS[role]} (comparação de critérios de projeção)`;
  }
  const CRITERIA_SHORT = { lucro: "Lucro", rentTotal: "Rentabilidade Total", rentMensal: "Rentabilidade Mensal", diasFixo: "Dias de Cocho Fixo" };
  function compareCriteriaCaption() {
    if (state.compareCriteria.length === CRITERIA_ORDER.length) return "todos os critérios";
    return state.compareCriteria.map((k) => CRITERIA_SHORT[k]).join(", ");
  }
  function criteriaDataByKey(criteriaResult, dataKey) {
    const out = {};
    for (const k of CRITERIA_ORDER) out[k] = criteriaResult.byCriterion[k][dataKey];
    return out;
  }

  // Cada entrada sabe montar seus próprios dados (legenda, colunas, linhas)
  // a partir do lastState/state atuais — usado tanto para desenhar a tabela
  // normal quanto para o modal de ampliação e o "Copiar CSV".
  const TABLE_DEFS = {
    "table-zoot": {
      getData: () => ({
        caption: tableCaption({ title: "Tabela 1 — Desempenho zootécnico" }, state.negModel),
        rows: ZOOT_ROWS,
        columnOrder: CRITERIA_ORDER,
        columnLabels: criteriaLabels(lastState.I),
        dataByKey: criteriaDataByKey(lastState.criteriaResult, "zoot"),
      }),
    },
    "table-econ": {
      getData: () => ({
        caption: tableCaption({ title: "Tabela 2 — Resultado econômico do confinamento" }, state.negModel),
        rows: ECON_CONF_ROWS,
        columnOrder: CRITERIA_ORDER,
        columnLabels: criteriaLabels(lastState.I),
        dataByKey: criteriaDataByKey(lastState.criteriaResult, "econConf"),
      }),
    },
    "table-parc": {
      getData: () => ({
        caption: tableCaption({ title: "Tabela 3 — Resultado econômico do parceiro" }, state.negModel),
        rows: ECON_PARC_ROWS,
        columnOrder: CRITERIA_ORDER,
        columnLabels: criteriaLabels(lastState.I),
        dataByKey: criteriaDataByKey(lastState.criteriaResult, "econParc"),
      }),
    },
    "table-compare-zoot": {
      getData: () => ({
        caption: `Desempenho zootécnico — ${ROLE_LABELS[state.negModel]} (${compareCriteriaCaption()})`,
        rows: ZOOT_ROWS,
        ...compareAllCriteriaColumns("zoot"),
      }),
    },
    "table-compare-econ": {
      getData: () => ({
        caption: `Resultado econômico do confinamento — ${ROLE_LABELS[state.negModel]} (${compareCriteriaCaption()})`,
        rows: ECON_CONF_ROWS,
        ...compareAllCriteriaColumns("econConf"),
      }),
    },
    "table-compare-parc": {
      getData: () => ({
        caption: `Resultado econômico do parceiro — ${ROLE_LABELS[state.negModel]} (${compareCriteriaCaption()})`,
        rows: ECON_PARC_ROWS,
        ...compareAllCriteriaColumns("econParc"),
      }),
    },
  };

  function renderDefTable(tableId) {
    const d = TABLE_DEFS[tableId].getData();
    buildTable(document.getElementById(tableId), d.caption, d.rows, d.dataByKey, d.columnOrder, d.columnLabels);
  }

  // Computa tudo (calibração, modelos de negócio, risco) para um conjunto de
  // entradas — reaproveitado tanto para o cenário ativo quanto, sob demanda,
  // para o outro cenário na aba Comparação.
  function computeBundle(I, role) {
    const C = Calc.calibrate(I);
    const summary = Calc.calibrationSummary(I, C);
    const criteriaResult = Calc.computeModelByCriteria(I, role);
    const model = Calc.computeModels(I);
    const risk = Calc.riskAnalysis(I, model);
    return { I, C, summary, criteriaResult, model, risk };
  }

  function recompute() {
    const I = readInputs();
    if (!inputsValid(I)) return;

    const active = computeBundle(I, state.negModel);
    lastState.I = active.I;
    lastState.C = active.C;
    lastState.summary = active.summary;
    lastState.model = active.model;
    lastState.criteriaResult = active.criteriaResult;
    lastState.risk = active.risk;

    renderCalibStats(active.I, active.summary);
    renderCalibChart(active.C, active.I);

    renderDefTable("table-zoot");
    renderDefTable("table-econ");
    renderDefTable("table-parc");
    renderModelosChart(active.criteriaResult, active.I, state.negModel);

    renderRiskKpis(active.risk, active.I);
    renderHistChart(active.risk, active.I);
    renderScatterChart(active.risk, active.I);

    // Cenários A/B: mantém o snapshot do cenário ativo sempre atualizado com
    // os campos ao vivo, e recalcula o outro cenário a partir do snapshot dele
    // (se já existir) para alimentar a aba Comparação.
    scenarioSnapshots[activeScenario] = snapshotCurrentInputs();
    const otherKey = activeScenario === "A" ? "B" : "A";
    const otherSnap = scenarioSnapshots[otherKey];
    const otherBundle = otherSnap ? computeBundle(inputsFromSnapshot(otherSnap), state.negModel) : active;
    lastState.compareA = activeScenario === "A" ? active : otherBundle;
    lastState.compareB = activeScenario === "B" ? active : otherBundle;
    lastState.compareBConfigured = !!scenarioSnapshots.B;

    renderComparisonTab();

    if (modalOpenChartId) reopenModalChart();
    if (modalOpenTableId) reopenModalTable();
  }

  document.querySelectorAll('input[type="number"]').forEach((inp) => {
    inp.addEventListener("input", scheduleRecompute);
  });

  // ---------------- modal de ampliação ----------------
  const CHART_DEFS = {
    chartCalib: {
      title: () => calibChartInfo(state.calibChart).title,
      sub: () => calibChartInfo(state.calibChart).sub,
      render: (id) => calibChartInfo(state.calibChart).render(lastState.C, lastState.I, id),
    },
    chartModelos: {
      title: () => `Avaliação gráfica — ${ROLE_LABELS[state.negModel]}`,
      sub: "Métrica escolhida na aba Modelos de Negócio.",
      render: (id) => renderModelosChart(lastState.criteriaResult, lastState.I, state.negModel, id),
    },
    chartHist: { title: "Distribuição da margem líquida", sub: "Simulação de Monte Carlo — barras vermelhas ficam abaixo da margem mínima.", render: (id) => renderHistChart(lastState.risk, lastState.I, id) },
    chartScatter: {
      title: "Margem vs. variável de risco",
      sub: () => `Relação entre a margem simulada e ${lastState.risk ? lastState.risk.xLabel.toLowerCase() : "a variável escolhida"}.`,
      render: (id) => renderScatterChart(lastState.risk, lastState.I, id),
    },
    chartCompare: {
      title: () => `${compareMetricInfo(state.compareMetric).label} — ${scenarioNames.A} vs. ${scenarioNames.B}`,
      sub: () => `Linha sólida (azul): ${scenarioNames.A}. Linha tracejada (âmbar): ${scenarioNames.B}.`,
      render: (id) => renderCompareChart(lastState.compareA, lastState.compareB, id),
    },
    chartCompareRisk: {
      title: () => `Distribuição da margem líquida — ${scenarioNames.A} vs. ${scenarioNames.B}`,
      sub: () => `${scenarioNames.A} em azul, ${scenarioNames.B} em âmbar.`,
      render: (id) => renderCompareRiskChart(lastState.compareA, lastState.compareB, id),
    },
  };

  const modalOverlay = document.getElementById("modalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const modalSub = document.getElementById("modalSub");
  const modalBody = document.getElementById("modalBody");
  const modalCloseBtn = document.getElementById("modalClose");
  let modalOpenChartId = null;
  let modalOpenTableId = null;

  function openChartModal(canvasId) {
    const def = CHART_DEFS[canvasId];
    if (!def || !lastState.I) return;
    modalOpenChartId = canvasId;
    modalOpenTableId = null;
    modalTitle.textContent = typeof def.title === "function" ? def.title() : def.title;
    modalSub.textContent = typeof def.sub === "function" ? def.sub() : def.sub;
    modalBody.innerHTML = `<canvas id="modalCanvas"></canvas>`;
    def.render("modalCanvas");
    openModal();
  }

  function reopenModalChart() {
    const def = CHART_DEFS[modalOpenChartId];
    if (!def) return;
    modalTitle.textContent = typeof def.title === "function" ? def.title() : def.title;
    modalSub.textContent = typeof def.sub === "function" ? def.sub() : def.sub;
    def.render("modalCanvas");
  }

  function openTableModal(tableId) {
    const def = TABLE_DEFS[tableId];
    if (!def || !lastState.criteriaResult) return;
    modalOpenChartId = null;
    modalOpenTableId = tableId;
    const d = def.getData();
    modalTitle.textContent = d.caption;
    modalSub.textContent = "Mesmos dados da tabela na página, em tamanho ampliado — atualiza junto com os campos.";
    modalBody.innerHTML = `<div class="table-wrap"><table class="data" id="modalTable"></table></div>`;
    buildTable(document.getElementById("modalTable"), d.caption, d.rows, d.dataByKey, d.columnOrder, d.columnLabels);
    openModal();
  }

  function reopenModalTable() {
    const def = TABLE_DEFS[modalOpenTableId];
    const tableEl = document.getElementById("modalTable");
    if (!def || !tableEl) return;
    const d = def.getData();
    modalTitle.textContent = d.caption;
    buildTable(tableEl, d.caption, d.rows, d.dataByKey, d.columnOrder, d.columnLabels);
  }

  function openModal() {
    modalOverlay.hidden = false;
  }
  function closeModal() {
    modalOverlay.hidden = true;
    modalOpenChartId = null;
    modalOpenTableId = null;
    destroyChart("modalCanvas");
    modalBody.innerHTML = "";
  }

  document.querySelectorAll("[data-expand-chart]").forEach((btn) => {
    btn.addEventListener("click", () => openChartModal(btn.dataset.expandChart));
  });
  document.querySelectorAll("[data-expand-table]").forEach((btn) => {
    btn.addEventListener("click", () => openTableModal(btn.dataset.expandTable));
  });
  modalCloseBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modalOverlay.hidden) closeModal();
    if (reportPickerOverlay && !reportPickerOverlay.hidden) closeReportPicker();
  });

  // ---------------- relatório em PDF (via impressão do navegador) ----------------
  // O sandbox do Artifact bloqueia downloads iniciados por script (<a download>,
  // blobs etc.), então geramos o PDF pela caixa de impressão nativa do
  // navegador: o botão monta um relatório em HTML puro (#reportView, oculto na
  // tela, visível só em @media print) e chama window.print(); a pessoa escolhe
  // "Salvar como PDF" no diálogo do sistema.
  const reportView = document.getElementById("reportView");
  const reportBtn = document.getElementById("reportBtn");

  function inputRows(pairs) {
    return pairs.map(([label, val]) => `<div><span>${label}</span><b>${val}</b></div>`).join("");
  }

  // Gráficos de abas não ativas ficam dentro de contêineres com display:none,
  // então o Chart.js pode tê-los desenhado com largura zero. Antes de
  // capturar como imagem, mostra tudo brevemente (sem gerar repaint visível,
  // já que tudo roda de forma síncrona antes do navegador pintar a tela),
  // força um resize de cada gráfico e só então tira o "print" do canvas.
  function captureAllChartImages() {
    if (!HAS_CHART) return {};
    const views = [...document.querySelectorAll(".view")];
    const subviews = [...document.querySelectorAll(".subview")];
    const prevViews = views.map((v) => v.style.display);
    const prevSubs = subviews.map((v) => v.style.display);
    views.forEach((v) => (v.style.display = "block"));
    subviews.forEach((v) => (v.style.display = "block"));

    const images = {};

    // Calibração compartilha um único canvas entre peso/gmd/cms — renderiza
    // cada variante temporariamente para capturar as 3 imagens, depois
    // devolve a tela ao que o usuário estava vendo.
    const prevCalibChart = state.calibChart;
    for (const key of ["peso", "gmd", "cms"]) {
      state.calibChart = key;
      try {
        const chart = renderCalibChart(lastState.C, lastState.I, "chartCalib");
        if (chart) {
          chart.resize();
          images["chartCalib_" + key] = chart.toBase64Image("image/png", 1);
        }
      } catch (e) {
        /* segue para os outros gráficos mesmo se um falhar */
      }
    }
    state.calibChart = prevCalibChart;
    renderCalibChart(lastState.C, lastState.I, "chartCalib");

    const ids = ["chartModelos", "chartHist", "chartScatter"];
    ids.forEach((id) => {
      const chart = chartInstances[id];
      if (!chart) return;
      try {
        chart.resize();
        images[id] = chart.toBase64Image("image/png", 1);
      } catch (e) {
        /* se um canvas específico falhar, os demais e o resto do relatório seguem normalmente */
      }
    });

    views.forEach((v, i) => (v.style.display = prevViews[i]));
    subviews.forEach((v, i) => (v.style.display = prevSubs[i]));
    return images;
  }

  function chartFigure(images, id, caption) {
    if (!images[id]) return "";
    return `<div class="r-chart"><img src="${images[id]}" alt="${caption}"><div class="r-chart-cap">${caption}</div></div>`;
  }

  // Monta uma subseção completa (texto + 3 tabelas) para um modelo de
  // negócio específico, independente do que está selecionado na tela —
  // permite incluir mais de um modelo no mesmo relatório.
  function buildModelSection(I, role) {
    const bundle = Calc.computeModelByCriteria(I, role);
    const labels = criteriaLabels(I);
    const zootData = {},
      econData = {},
      parcData = {};
    for (const k of CRITERIA_ORDER) {
      zootData[k] = bundle.byCriterion[k].zoot;
      econData[k] = bundle.byCriterion[k].econConf;
      parcData[k] = bundle.byCriterion[k].econParc;
    }
    const idZoot = `reportTableZoot_${role}`;
    const idEcon = `reportTableEcon_${role}`;
    const idParc = `reportTableParc_${role}`;
    const d = bundle.byCriterion;
    return {
      html: `
        <h3>${ROLE_LABELS[role]}</h3>
        <p>Dias de cocho selecionados — Lucro: ${d.lucro.day}, Rentabilidade Total: ${d.rentTotal.day}, Rentabilidade Mensal: ${d.rentMensal.day}, Dias Fixo: ${d.diasFixo.day}.</p>
        <table id="${idZoot}"></table>
        <table id="${idEcon}"></table>
        <table id="${idParc}"></table>
      `,
      build: () => {
        buildTable(document.getElementById(idZoot), `Desempenho zootécnico — ${ROLE_LABELS[role]}`, ZOOT_ROWS, zootData, CRITERIA_ORDER, labels);
        buildTable(document.getElementById(idEcon), `Resultado econômico do confinamento — ${ROLE_LABELS[role]}`, ECON_CONF_ROWS, econData, CRITERIA_ORDER, labels);
        buildTable(document.getElementById(idParc), `Resultado econômico do parceiro — ${ROLE_LABELS[role]}`, ECON_PARC_ROWS, parcData, CRITERIA_ORDER, labels);
      },
    };
  }

  function buildReport(roles) {
    if (!lastState.I) return;
    if (!roles || roles.length === 0) roles = [state.negModel];
    const { I, C, risk } = lastState;
    const summary = Calc.calibrationSummary(I, C);
    const now = new Date();
    const dateStr = `${now.toLocaleDateString("pt-BR")} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    const loggedUser = (loggedInAs && loggedInAs.textContent) || "—";
    const charts = captureAllChartImages();
    const modelSections = roles.map((r) => buildModelSection(I, r));

    reportView.innerHTML = `
      <div class="r-head">
        <div>
          <img class="r-logo" src="logo_probeef.png" alt="ProBeef">
          <h1>4M Confinamento — Relatório de Resultados</h1>
          <div class="r-sub">Calibração zootécnica, modelos de negócio e análise de risco</div>
        </div>
        <div class="r-meta">Gerado em ${dateStr}<br>Usuário: ${loggedUser}<br>Cenário: ${scenarioNames[activeScenario]}</div>
      </div>

      <section>
        <h2>1. Calibração zootécnica</h2>
        <div class="r-input-grid">
          ${inputRows([
            ["Raça", I.a1],
            ["Sexo", I.c1],
            ["Peso de entrada", `${fmt(I.c2, 0)} kg`],
            ["Dias de cocho (atual)", I.c3],
            ["Adaptação", `${I.d1} dias`],
            ["Rend. carcaça inicial", `${I.a7}%`],
            ["ELm adaptação / terminação", `${I.d2} / ${I.d5} Mcal/kg`],
            ["ELg adaptação / terminação", `${I.d3} / ${I.d6} Mcal/kg`],
            ["CMS alvo", `${I.c5} kg/dia`],
            ["Padrão GMD / RC", `${I.c6} / ${I.c7}`],
          ])}
        </div>
        <div class="r-stat-grid">
          <div class="r-stat"><div class="l">CMS médio</div><div class="v">${fmt(summary.cms, 2)} kg/dia</div></div>
          <div class="r-stat"><div class="l">CMS % PV</div><div class="v">${fmt(summary.cmsPctPV, 2)}%</div></div>
          <div class="r-stat"><div class="l">GMD médio</div><div class="v">${fmt(summary.gmd, 3)} kg</div></div>
          <div class="r-stat"><div class="l">Rend. Carcaça</div><div class="v">${fmt(summary.rc, 2)}%</div></div>
          <div class="r-stat"><div class="l">Ganho de carcaça</div><div class="v">${fmt(summary.carcassGain, 3)} kg/dia</div></div>
          <div class="r-stat"><div class="l">Peso final (dia ${I.c3})</div><div class="v">${fmt(summary.finalWeight, 2)} kg</div></div>
        </div>
        ${chartFigure(charts, "chartCalib_peso", "Curva de peso vivo")}
        ${chartFigure(charts, "chartCalib_gmd", "Ganho de peso e de carcaça (GMD e GDC)")}
        ${chartFigure(charts, "chartCalib_cms", "Consumo de matéria seca (CMS e IMS)")}
      </section>

      <section>
        <h2>2. Informações financeiras</h2>
        <div class="r-input-grid">
          ${inputRows([
            ["Custo boi magro", `R$ ${fmt(I.f1, 2)}/@`],
            ["Valor de venda", `R$ ${fmt(I.b0, 2)}/@`],
            ["Custo frete", `R$ ${fmt(I.f2, 2)} (${I.f21})`],
            ["Custo processamento", `R$ ${fmt(I.f4, 2)} (${I.f41})`],
            ["Custo operacional", `R$ ${fmt(I.f3, 2)}/cab./dia`],
            ["Nº de animais", I.a3],
            ["Dieta adaptação / terminação", `R$ ${fmt(I.d4, 0)} / ${fmt(I.d7, 0)} por ton.`],
            ["Valor diária (Boitel)", `R$ ${fmt(I.bp1, 2)}`],
            ["Valor @ produzida", `R$ ${fmt(I.bp2, 2)}`],
            ["Bônus parceiro", `${I.bp3}%`],
            ["Taxa de juros", `${I.f7}% a.a.`],
            ["Financia alimento / gado", `${I.f8} / ${I.f9}`],
            ["Venda", I.f10],
            ["Taxa de mortalidade", `${I.m1}% (${I.m11})`],
            ["Bonificação", `R$ ${fmt(I.b1, 2)}/@ após ${I.b2} dias`],
          ])}
        </div>
      </section>

      <section>
        <h2>3. Modelos de negócio</h2>
        <p>Comparação dos 4 critérios de projeção (Lucro, Rentabilidade Total, Rentabilidade Mensal, Dias Fixo) para cada modelo escolhido.</p>
        ${modelSections.map((s) => s.html).join("")}
        ${chartFigure(charts, "chartModelos", `Avaliação gráfica — ${ROLE_LABELS[state.negModel]}`)}
      </section>

      <section>
        <h2>4. Análise de risco</h2>
        <p>Simulação de Monte Carlo (15.000 cenários) da margem líquida do modelo Boi Próprio no dia de cocho ${risk.day}, considerando as variações informadas abaixo.</p>
        <div class="r-input-grid">
          ${inputRows([
            ["Var. @ boi magro", `R$ ${I.arbp1}`],
            ["Var. @ boi gordo", `R$ ${I.arbp2}`],
            ["Var. dieta de adaptação", `R$ ${I.arbp3}/ton.`],
            ["Var. dieta de terminação", `R$ ${I.arbp4}/ton.`],
            ["Margem mínima aceitável", `R$ ${fmt(I.arbp5, 0)}/cab.`],
            ["Variável analisada", I.An],
          ])}
        </div>
        <div class="r-stat-grid">
          <div class="r-stat"><div class="l">Margem média simulada</div><div class="v">R$ ${fmt(risk.mean, 2)}</div></div>
          <div class="r-stat"><div class="l">Desvio padrão</div><div class="v">R$ ${fmt(risk.sd, 2)}</div></div>
          <div class="r-stat"><div class="l">Prob. margem &lt; R$ ${fmt(I.arbp5, 0)}</div><div class="v">${fmt(risk.probLucro, 1)}%</div></div>
        </div>
        ${chartFigure(charts, "chartHist", "Distribuição da margem líquida")}
        ${chartFigure(charts, "chartScatter", "Margem vs. variável de risco")}
      </section>

      <section>
        <h2>5. Metodologia</h2>
        <h3>Curva de consumo (CMS)</h3>
        <p>O consumo de matéria seca diário é estimado por uma curva não linear em função dos dias de cocho e do peso de entrada. Essa curva é calibrada para reproduzir o valor de CMS informado como "alvo" (medido em campo), ajustando um fator que desloca a curva padrão para cima ou para baixo sem alterar seu formato.</p>
        <h3>Ganho de peso (GMD) e peso de carcaça</h3>
        <p>O ganho médio diário é calculado dia a dia a partir da energia líquida disponível para ganho — o consumo total menos a fração usada para mantença do animal —, da eficiência de conversão dessa energia em peso (que depende do sexo do animal) e dos padrões de GMD e rendimento de carcaça informados na Calibração. O peso de carcaça de cada dia é estimado por uma equação de regressão a partir do peso vivo, do ganho de peso e dos dias de cocho, respeitando o rendimento de carcaça mínimo informado.</p>
        <h3>Indicadores zootécnicos</h3>
        <ul>
          <li><b>Rendimento de Carcaça</b>: peso de carcaça estimado dividido pelo peso vivo do dia, em %.</li>
          <li><b>Conversão Alimentar</b>: consumo de matéria seca acumulado desde a entrada dividido pelo ganho de peso acumulado no mesmo período (kg de matéria seca por kg de peso vivo ganho).</li>
          <li><b>Eficiência Biológica</b>: consumo de matéria seca acumulado dividido pelas arrobas de carcaça produzidas desde a entrada (kg de matéria seca por arroba).</li>
        </ul>
        <h3>Modelos de negócio</h3>
        <ul>
          <li><b>Boi Próprio</b>: o confinamento é dono do animal do início ao fim — assume o custo de compra, todos os custos de produção e a receita da venda; fica exposto à variação de preço do boi magro e do boi gordo.</li>
          <li><b>Boitel</b>: o confinamento presta o serviço de engorda cobrando uma diária fixa por cabeça; não é dono do animal e não está exposto à variação do preço do boi.</li>
          <li><b>Arrobas Produzidas</b>: o confinamento é remunerado por arroba de peso de carcaça ganho durante o período, alinhando sua remuneração ao desempenho zootécnico do lote.</li>
          <li><b>Parceria</b>: o resultado da venda é dividido entre o dono do boi e o confinamento segundo uma regra de bônus, combinando elementos dos modelos anteriores.</li>
        </ul>
        <h3>Critério de otimização do dia de cocho</h3>
        <p>Para cada modelo, o aplicativo varre os dias de cocho entre 22 e 180 e escolhe automaticamente o dia que maximiza o critério selecionado (lucro por cabeça, rentabilidade total ou rentabilidade mensal); alternativamente, é possível fixar manualmente um número de dias de cocho na aba Modelos de Negócio.</p>
        <h3>Análise de risco (simulação de Monte Carlo)</h3>
        <p>A partir do cenário do dia de cocho ótimo do modelo Boi Próprio, o aplicativo simula 15.000 cenários possíveis variando aleatoriamente — segundo distribuição normal — o preço de compra do boi magro, o preço de venda do boi gordo e o custo das dietas de adaptação e terminação, dentro das faixas de variação informadas na aba Análise de Risco. A distribuição resultante da margem líquida permite estimar a probabilidade de a margem ficar abaixo do valor mínimo aceitável definido, além da sensibilidade da margem à variável de risco escolhida.</p>
      </section>

      <div class="r-foot">4M Confinamento — relatório gerado automaticamente a partir dos parâmetros informados nas abas do aplicativo. Responsável: André Mauric (andre_mauric@cargill.com).</div>
    `;

    modelSections.forEach((s) => s.build());
  }

  // ---------------- seleção de modelos para o relatório ----------------
  const reportPickerOverlay = document.getElementById("reportPickerOverlay");
  const reportPickerList = document.getElementById("reportPickerList");
  const reportPickerClose = document.getElementById("reportPickerClose");
  const reportPickerConfirm = document.getElementById("reportPickerConfirm");

  function openReportPicker() {
    if (!reportPickerOverlay) return;
    reportPickerList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = cb.value === state.negModel;
    });
    reportPickerOverlay.hidden = false;
  }
  function closeReportPicker() {
    if (reportPickerOverlay) reportPickerOverlay.hidden = true;
  }

  if (reportBtn) reportBtn.addEventListener("click", openReportPicker);
  if (reportPickerClose) reportPickerClose.addEventListener("click", closeReportPicker);
  if (reportPickerOverlay) {
    reportPickerOverlay.addEventListener("click", (e) => {
      if (e.target === reportPickerOverlay) closeReportPicker();
    });
  }
  if (reportPickerConfirm) {
    reportPickerConfirm.addEventListener("click", async () => {
      const roles = [...reportPickerList.querySelectorAll("input[type=checkbox]:checked")].map((cb) => cb.value);
      if (roles.length === 0) {
        showToast("Escolha pelo menos um modelo de negócio");
        return;
      }
      closeReportPicker();
      buildReport(roles);
      // Espera o logo carregar para ele não sair em branco no PDF.
      const logo = reportView.querySelector(".r-logo");
      if (logo) await logo.decode().catch(() => {});
      window.print();
    });
  }

  // ---------------- minhas simulações ----------------
  async function apiListSimulations(all) {
    const res = await fetch(`${API_BASE}/simulations${all ? "?all=1" : ""}`, { credentials: "same-origin" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Falha ao listar simulações (${res.status})`);
    }
    return (await res.json()).simulations;
  }

  async function apiSaveSimulation(name, data, id) {
    const url = id ? `${API_BASE}/simulations/${id}` : `${API_BASE}/simulations`;
    const res = await fetch(url, {
      method: id ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, data }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Falha ao salvar (${res.status})`);
    }
    return (await res.json()).simulation;
  }

  async function apiDeleteSimulation(id) {
    const res = await fetch(`${API_BASE}/simulations/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Falha ao excluir (${res.status})`);
    }
    return res.json();
  }

  // Empacota tudo que define uma simulação: os dois cenários A/B completos
  // (valores + nomes) e as configurações compartilhadas de visualização.
  function captureFullSimulation() {
    scenarioSnapshots[activeScenario] = snapshotCurrentInputs();
    return {
      scenarioSnapshots: JSON.parse(JSON.stringify(scenarioSnapshots)),
      scenarioNames: { ...scenarioNames },
      activeScenario,
      negModel: state.negModel,
      chartMetric: state.chartMetric,
      compareMetric: state.compareMetric,
      compareCriteria: [...state.compareCriteria],
      calibChart: state.calibChart,
    };
  }

  function syncSharedSegButtons() {
    for (const key of ["negModel", "chartMetric", "compareMetric", "calibChart"]) {
      document.querySelectorAll(`.seg[data-seg="${key}"]`).forEach((segEl) => {
        segEl.querySelectorAll("button").forEach((b) => {
          b.classList.toggle("active", b.dataset.value === state[key]);
        });
      });
    }
  }

  function loadFullSimulation(saved) {
    if (!saved || !saved.scenarioSnapshots) return;
    scenarioSnapshots.A = saved.scenarioSnapshots.A || null;
    scenarioSnapshots.B = saved.scenarioSnapshots.B || null;
    if (saved.scenarioNames) {
      scenarioNames.A = saved.scenarioNames.A || "Cenário A";
      scenarioNames.B = saved.scenarioNames.B || "Cenário B";
    }
    state.negModel = saved.negModel || state.negModel;
    state.chartMetric = saved.chartMetric || state.chartMetric;
    state.compareMetric = saved.compareMetric || state.compareMetric;
    state.calibChart = saved.calibChart || state.calibChart;
    // Simulações antigas não têm a escolha: ficam com todos os critérios.
    const crit = Array.isArray(saved.compareCriteria) ? CRITERIA_ORDER.filter((k) => saved.compareCriteria.includes(k)) : [];
    state.compareCriteria = crit.length ? crit : [...CRITERIA_ORDER];
    syncMultiSeg("compareCriteria");
    activeScenario = saved.activeScenario === "B" ? "B" : "A";

    const snap = scenarioSnapshots[activeScenario];
    if (snap) applySnapshot(snap);
    syncSharedSegButtons();
    updateScenarioButtonLabels();
    if (scenarioNameInput) scenarioNameInput.value = scenarioNames[activeScenario];
    scheduleRecompute();
  }

  function formatSimDate(iso) {
    try {
      return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return iso;
    }
  }

  function renderSimList(container, items, opts) {
    if (!items || items.length === 0) {
      container.innerHTML = `<div class="sim-empty">Nenhuma simulação ${opts && opts.all ? "" : "salva ainda"}.</div>`;
      return;
    }
    container.innerHTML = items
      .map((it) => {
        const ownerTag = opts && opts.all ? ` · dono: <b>${it.ownerName}</b>` : "";
        const canEdit = !opts || !opts.all || isAdmin;
        return `
        <div class="sim-item" data-id="${it.id}">
          <div class="sim-item-info">
            <div class="sim-item-name">${it.name}</div>
            <div class="sim-item-meta">Atualizado em ${formatSimDate(it.updatedAt)}${ownerTag}</div>
          </div>
          <div class="sim-item-actions">
            <button class="btn" data-sim-action="load" data-sim-id="${it.id}">Carregar</button>
            ${canEdit ? `<button class="btn" data-sim-action="rename" data-sim-id="${it.id}" data-sim-name="${it.name}">Renomear</button>` : ""}
            ${canEdit ? `<button class="btn" data-sim-action="delete" data-sim-id="${it.id}">Excluir</button>` : ""}
          </div>
        </div>`;
      })
      .join("");
  }

  let simCache = { mine: [], all: [] };

  function findSimById(id) {
    return [...simCache.mine, ...simCache.all].find((it) => String(it.id) === String(id));
  }

  async function refreshSimulationsTab() {
    const available = document.getElementById("simAvailableArea");
    if (!available) return;

    available.hidden = false;
    const adminSection = document.getElementById("simAdminSection");
    const listMineEl = document.getElementById("simListMine");
    const listAllEl = document.getElementById("simListAll");

    try {
      simCache.mine = await apiListSimulations(false);
      renderSimList(listMineEl, simCache.mine, { all: false });
    } catch (e) {
      listMineEl.innerHTML = `<div class="sim-empty">${e.message}</div>`;
    }

    if (isAdmin) {
      adminSection.hidden = false;
      try {
        simCache.all = await apiListSimulations(true);
        renderSimList(listAllEl, simCache.all, { all: true });
      } catch (e) {
        listAllEl.innerHTML = `<div class="sim-empty">${e.message}</div>`;
      }
    } else {
      adminSection.hidden = true;
    }
  }

  const simNameInput = document.getElementById("simNameInput");
  const simSaveBtn = document.getElementById("simSaveBtn");
  if (simSaveBtn) {
    simSaveBtn.addEventListener("click", async () => {
      const name = (simNameInput.value || "").trim();
      if (!name) {
        showToast("Dê um nome para a simulação");
        return;
      }
      try {
        await apiSaveSimulation(name, captureFullSimulation());
        simNameInput.value = "";
        showToast("Simulação salva");
        refreshSimulationsTab();
      } catch (e) {
        showToast(e.message);
      }
    });
  }

  document.querySelectorAll(".sim-list").forEach((list) => {
    list.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-sim-action]");
      if (!btn) return;
      const action = btn.dataset.simAction;
      const id = btn.dataset.simId;
      const item = findSimById(id);
      if (!item) return;

      if (action === "load") {
        loadFullSimulation(item.data);
        showToast(`Simulação "${item.name}" carregada`);
      } else if (action === "rename") {
        const novo = window.prompt("Novo nome da simulação:", item.name);
        if (!novo || !novo.trim() || novo.trim() === item.name) return;
        try {
          await apiSaveSimulation(novo.trim(), item.data, item.id);
          showToast("Simulação renomeada");
          refreshSimulationsTab();
        } catch (err) {
          showToast(err.message);
        }
      } else if (action === "delete") {
        if (!window.confirm(`Excluir a simulação "${item.name}"? Essa ação não pode ser desfeita.`)) return;
        try {
          await apiDeleteSimulation(item.id);
          showToast("Simulação excluída");
          refreshSimulationsTab();
        } catch (err) {
          showToast(err.message);
        }
      }
    });
  });

  recompute();
})();
