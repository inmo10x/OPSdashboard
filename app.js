// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
// Meta mensual de cash del equipo (USD) — para "Meta vs. realizado"
const META_MENSUAL_USD = 40000;

// Bonificación mensual por contrato: % del cash cobrado del mes.
// Estas personas no aparecen en las hojas de datos, por eso se configuran acá.
const BONIFICACION_MENSUAL = [
  { nombre: 'Elber',    pct: 0.005 },
  { nombre: 'Patricia', pct: 0.005 },
];

// ═══════════════════════════════════════════════
//  RAW DATA
// ═══════════════════════════════════════════════
let RAW_MD = [], RAW_CC = [], RAW_V = [], RAW_C = [], RAW_CL = [], RAW_PC = [], RAW_ES = [], RAW_MDIA = [];
let DATA_FLOOR = '', DATA_CEIL = '';

// ═══════════════════════════════════════════════
//  FILTERS
// ═══════════════════════════════════════════════
let dateFrom='', dateTo='';
// true cuando el usuario fija un rango explícito (preset o inputs). Mientras sea
// false, el rango sigue al máximo de los datos en cada carga/revalidación SWR.
let userFiltered=false;

// ═══════════════════════════════════════════════
//  AUTH — la contraseña NO vive en el código: el usuario la escribe y se manda
//  como token al Apps Script, que la valida server-side antes de devolver datos.
// ═══════════════════════════════════════════════
let authUser=null, authToken=null;

let FIXED_PRESETS = null; // botones fijos (Todo, 7d) capturados en el primer render

function buildMonthPresets() {
  const MNAMES={'01':'Ene','02':'Feb','03':'Mar','04':'Abr','05':'May','06':'Jun','07':'Jul','08':'Ago','09':'Sep','10':'Oct','11':'Nov','12':'Dic'};
  const months=[...new Set([...RAW_MD,...RAW_CC,...RAW_C].map(r=>r.Fecha).filter(Boolean).map(d=>d.slice(0,7)))].sort();
  const wrap=document.getElementById('month-btns');
  if(!wrap) return;
  // Idempotente: siempre reconstruye desde los botones fijos originales
  if (FIXED_PRESETS === null) FIXED_PRESETS = wrap.innerHTML;
  wrap.innerHTML=months.map(m=>'<button class="preset" onclick="setPreset(\'m:'+m+'\')">'+MNAMES[m.slice(5,7)]+'</button>').join('')+FIXED_PRESETS;
}

function setPreset(p) {
  document.querySelectorAll('.preset').forEach(b=>b.classList.remove('active'));
  if(event&&event.target) event.target.classList.add('active');
  const minD=DATA_FLOOR, maxD=DATA_CEIL;
  if(p.startsWith('m:')) {
    const ym=p.slice(2); const[y,m]=ym.split('-').map(Number);
    dateFrom=ym+'-01'; dateTo=new Date(y,m,0).toISOString().slice(0,10);
  } else if(p==='all') {
    dateFrom=minD; dateTo=maxD;
  } else if(p==='last7') {
    const d=new Date(maxD); d.setDate(d.getDate()-6);
    dateFrom=d.toISOString().slice(0,10); dateTo=maxD;
  }
  document.getElementById('date-from').value=dateFrom;
  document.getElementById('date-to').value=dateTo;
  applyFilter();
  // "Todo" = seguir el rango completo: reanudar auto-seguimiento en revalidaciones
  if (p === 'all') userFiltered = false;
}

function applyFilter() {
  dateFrom = document.getElementById('date-from').value;
  dateTo   = document.getElementById('date-to').value;
  userFiltered = true;  // el usuario fijó un rango: dejar de auto-seguir los datos
  renderAll();
}

function inRange(d) { if(!d) return false; if(!dateFrom||!dateTo) return true; return d>=dateFrom&&d<=dateTo; }

function weekOf(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0=Sun
  const diff = d.getDate() - day + (day===0 ? -6 : 1);
  const mon = new Date(d.setDate(diff));
  return mon.toISOString().slice(0,10);
}

function fmtDate(d) { return d.slice(5).replace('-','/'); }
function fmtMoney(n) {
  if (n >= 1000) return '$' + (n/1000).toFixed(1).replace('.0','') + 'K';
  return '$' + Math.round(n);
}
function pct(a,b) { return b ? Math.round(a/b*100) : 0; }

// ═══════════════════════════════════════════════
//  CHART INSTANCES
// ═══════════════════════════════════════════════
const charts = {};
function destroyChart(id) { if(charts[id]){ charts[id].destroy(); delete charts[id]; } }

// Color de grilla según tema (las opciones por-chart pisan a Chart.defaults)
function gridCol() {
  return document.documentElement.getAttribute('data-theme')==='dark' ? '#2e2c28' : '#f0ece4';
}
function legendCol() {
  return document.documentElement.getAttribute('data-theme')==='dark' ? '#9a978f' : '#68655e';
}

// Actualiza un chart existente en vez de destruir/recrear (evita el flash y re-anima solo lo que cambió)
function upsertChart(id, canvasId, config) {
  const existing = charts[id];
  if (existing && existing.config.type === config.type) {
    existing.data = config.data;
    Object.assign(existing.options, config.options);
    existing.update();
    return existing;
  }
  if (existing) destroyChart(id);
  const ctx = document.getElementById(canvasId).getContext('2d');
  charts[id] = new Chart(ctx, config);
  return charts[id];
}

function applyChartTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  Chart.defaults.color       = dark ? '#68655e' : '#9a978f';
  Chart.defaults.borderColor = dark ? '#2e2c28' : '#e2ddd4';
}
Chart.defaults.font.family = "'DM Sans',sans-serif";
Chart.defaults.font.size = 10;
Chart.defaults.maintainAspectRatio = false; // los canvas viven en .chart-box con altura fija
applyChartTheme();

const GOLD='#a8832a', GOLD_L='#c9a84c', GOLD_P='rgba(168,131,42,.12)';
const GREEN='#3d6b50', GREEN_P='rgba(61,107,80,.15)';
const RED='#944030',   RED_P='rgba(148,64,48,.15)';
const BLUE='#2a527a',  BLUE_P='rgba(42,82,122,.12)';
const GY='#9a978f',    GY_P='rgba(154,151,143,.12)';

// ── Estilos por tipo de cobro (con fallback para tipos nuevos en la hoja) ──
const TIPO_STYLE = {
  'Nuevo':      {ico:'✦', css:'var(--green)', bg:'var(--green-p)',  hex:'#3d6b50', fill:'rgba(61,107,80,.75)'},
  'CxC':        {ico:'↻', css:'var(--gold)',  bg:'var(--gold-pale)',hex:'#a8832a', fill:'rgba(168,131,42,.75)'},
  'Renovación': {ico:'★', css:'var(--blue)',  bg:'var(--blue-p)',   hex:'#2a527a', fill:'rgba(42,82,122,.75)'},
  'Upsell':     {ico:'▲', css:'#7c5cbf',      bg:'#f0edf8',         hex:'#7c5cbf', fill:'rgba(124,92,191,.75)'},
};
// Paleta de reserva para tipos no registrados (se asignan en orden de aparición)
const TIPO_FALLBACK = [
  {ico:'●', css:'#b0653a', bg:'#f7ede6', hex:'#b0653a', fill:'rgba(176,101,58,.75)'},
  {ico:'●', css:'#4a8a8c', bg:'#e8f2f2', hex:'#4a8a8c', fill:'rgba(74,138,140,.75)'},
  {ico:'●', css:'#8c4a7c', bg:'#f4eaf1', hex:'#8c4a7c', fill:'rgba(140,74,124,.75)'},
];
const tipoStyleCache = {};
function tipoStyle(t) {
  if (TIPO_STYLE[t]) return TIPO_STYLE[t];
  if (!tipoStyleCache[t]) {
    tipoStyleCache[t] = TIPO_FALLBACK[Object.keys(tipoStyleCache).length % TIPO_FALLBACK.length];
  }
  return tipoStyleCache[t];
}

// ═══════════════════════════════════════════════
//  CORE STATS (compartido entre período actual y anterior)
// ═══════════════════════════════════════════════
const NO_ASISTE = ['no asiste','no show','cancelada','cancelado'];
const esAsistencia = r => !NO_ASISTE.includes(r.Evento.toLowerCase());
const esRenov = r => r.Tipo.toLowerCase().includes('renov');

// Filtra las 5 fuentes de datos por un predicado de fecha y calcula los agregados base.
function computeCoreStats(inRangeFn) {
  const md = RAW_MD.filter(r => inRangeFn(r.Fecha));
  const cc = RAW_CC.filter(r => inRangeFn(r.Fecha));
  const v  = RAW_V.filter(r  => inRangeFn(r['Fecha Cierre']));
  const co = RAW_C.filter(r  => inRangeFn(r.Fecha));
  const cl = RAW_CL.filter(r => inRangeFn(r.Fecha));

  // Agendas = confirmados por Call Confirmer; Asistencias = CLOSER_LOG sin no-shows
  const totAg = cc.filter(r=>r.Estado==='Confirmado').length;
  const totAs = cl.filter(esAsistencia).length;
  const totCash  = co.reduce((s,r)=>s+r.Monto,0);
  const totVenta = v.reduce((s,r)=>s+r.Venta,0);
  const vNuevas  = v.filter(r=>!esRenov(r));
  const vRenov   = v.filter(esRenov);
  const ticket   = v.length ? Math.round(totVenta / v.length) : 0;
  // AOV = venta total / clientes únicos (un cliente puede tener varios contratos)
  const nClientes = new Set(v.map(r=>r.Cliente)).size;
  const aov = nClientes ? Math.round(totVenta / nClientes) : 0;

  return { md, cc, v, co, cl,
           totAg, totAs, totCash, totVenta, ticket, aov, nClientes,
           vNuevas, vRenov, totNuevas: vNuevas.length, totRenov: vRenov.length };
}

// ═══════════════════════════════════════════════
//  PREVIOUS PERIOD COMPARISON
// ═══════════════════════════════════════════════
function computePrevStats() {
  if (!dateFrom || !dateTo || !DATA_FLOOR || !DATA_CEIL) return null;
  const d1 = new Date(dateFrom + 'T00:00:00Z'), d2 = new Date(dateTo + 'T00:00:00Z');
  const duration = Math.round((d2 - d1) / 86400000);
  if (!Number.isFinite(duration) || duration < 0) return null;
  const prevTo = new Date(d1); prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  const monthEnd = new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth() + 1, 0));
  // Un mes completo se compara con el mes calendario anterior, sin días prestados.
  if (d1.getUTCDate() === 1 && d2.getTime() === monthEnd.getTime()) {
    prevFrom.setUTCDate(1);
  } else {
    prevFrom.setUTCDate(prevFrom.getUTCDate() - duration);
  }
  const pFrom = prevFrom.toISOString().slice(0,10);
  const pTo   = prevTo.toISOString().slice(0,10);
  if (pFrom < DATA_FLOOR || pTo > DATA_CEIL) return null;

  const s = computeCoreStats(d => d && d >= pFrom && d <= pTo);
  return { ...s, sr: pct(s.totAs, s.totAg), cr: pct(s.totNuevas, s.totAs) };
}

function deltaHTML(text, cls, css, suffix, title='') {
  return `<span class="${css} ${cls}"${title ? ` title="${title}"` : ''}>${text}${suffix && text !== 'sin período previo' ? ' <span class="vs">vs. período anterior</span>' : ''}</span>`;
}

// delta para valores absolutos → muestra % de cambio
function delta(curr, prev, css='kpi-delta', suffix=false) {
  const html = (text, cls, title='') => deltaHTML(text, cls, css, suffix, title);
  if (typeof prev !== 'number') return html('sin período previo', 'flat');
  if (prev === 0) return curr > 0 ? html('▲ nuevo', 'up') : html('sin cambio', 'flat');
  const exact = (curr - prev) / Math.abs(prev) * 100;
  const d = Math.round(exact);
  if (d === 0) return html('sin cambio', 'flat');
  const cls = d > 0 ? 'up' : 'down', arrow = d > 0 ? '▲' : '▼';
  if (Math.abs(exact) >= 1000) return html(`${arrow} >${Math.floor(Math.abs(exact)/100)}×`, cls, `${exact}%`);
  return html(`${arrow} ${Math.abs(d)}%${suffix ? '' : ' vs ant.'}`, cls);
}

// delta para tasas/porcentajes → muestra diferencia en pp
function deltaP(curr, prev, css='kpi-delta', suffix=false) {
  if (typeof prev !== 'number') return deltaHTML('sin período previo', 'flat', css, suffix);
  const d = Math.round(curr - prev);
  if (d === 0) return deltaHTML('sin cambio', 'flat', css, suffix);
  const cls = d > 0 ? 'up' : 'down', arrow = d > 0 ? '▲' : '▼';
  return deltaHTML(`${arrow} ${Math.abs(d)}pp${suffix ? '' : ' vs ant.'}`, cls, css, suffix);
}

// ═══════════════════════════════════════════════
//  COMPUTE STATS
// ═══════════════════════════════════════════════
function computeStats() {
  const core = computeCoreStats(inRange);
  const { md, cc, v, co, cl } = core;
  const clFilt = cl;

  const totCi = md.reduce((s,r)=>s+r.Cierres,0);
  const totCobrado = v.reduce((s,r)=>s+r.Cobrado,0);
  const totPdte = v.reduce((s,r)=>s+r.Pendiente,0);

  const allCN=[...new Set([...md.map(r=>r.Closer),...clFilt.map(r=>r.Closer)])].filter(Boolean);
  const ORDER=['Ignacio','Sebastian','Karim','Guillermo'];
  const closers=ORDER.filter(c=>allCN.includes(c)).concat(allCN.filter(c=>!ORDER.includes(c)));
  const byCloser={};
  closers.forEach(c=>{
    const rows=md.filter(r=>r.Closer===c);
    const coRows=co.filter(r=>r.Closer===c);
    const vRows=v.filter(r=>r.Closer===c);
    const clRows=clFilt.filter(r=>r.Closer===c);
    const ccRows=cc.filter(r=>r.Closer===c&&r.Estado==='Confirmado');
    byCloser[c]={
      ag:ccRows.length,
      as:clRows.filter(esAsistencia).length,
      ci:rows.reduce((s,r)=>s+r.Cierres,0),
      se:rows.reduce((s,r)=>s+r.Seguimientos,0),
      cash:coRows.reduce((s,r)=>s+r.Monto,0),
      ventas:vRows.length,
    };
  });

  // Weekly cash (total + by tipo) — tipos dinámicos según los datos,
  // para que un tipo nuevo en la hoja (ej. "Iniciando") no se pierda ni
  // se contabilice como CxC.
  const tiposCash = [...new Set(co.map(r => r.Tipo || 'CxC'))];
  const weekCash = {};
  const weekCashByTipo = {};
  co.forEach(r => {
    const w = weekOf(r.Fecha);
    weekCash[w] = (weekCash[w]||0) + r.Monto;
    if (!weekCashByTipo[w]) weekCashByTipo[w] = {};
    const t = r.Tipo || 'CxC';
    weekCashByTipo[w][t] = (weekCashByTipo[w][t]||0) + r.Monto;
  });

  // Weekly confirmer
  const weekConf = {};
  cc.forEach(r => {
    const w=weekOf(r.Fecha);
    if(!weekConf[w]) weekConf[w]={conf:0,canc:0,desc:0};
    if(r.Estado==='Confirmado') weekConf[w].conf++;
    else if(r.Estado==='Cancelado') weekConf[w].canc++;
    else if(r.Estado==='Descalificado') weekConf[w].desc++;
  });

  // Confirmer totals
  const confConf = cc.filter(r=>r.Estado==='Confirmado').length;
  const confCanc = cc.filter(r=>r.Estado==='Cancelado').length;
  const confDesc = cc.filter(r=>r.Estado==='Descalificado').length;
  const confTotal = confConf+confCanc+confDesc;

  // Conf by closer
  const confByCloser = {};
  cc.filter(r=>r.Estado==='Confirmado').forEach(r=>{
    confByCloser[r.Closer]=(confByCloser[r.Closer]||0)+1;
  });

  return {...core,totCi,totCobrado,totPdte,byCloser,tiposCash,weekCash,weekCashByTipo,weekConf,confConf,confCanc,confDesc,confTotal,confByCloser,closers};
}

// ═══════════════════════════════════════════════
//  RENDER ALL
// ═══════════════════════════════════════════════
function renderAll() {
  const s = computeStats();
  renderStrip(s);
  renderOverview(s);
  renderKPIs(s);
  renderRangeLabel();
  renderTipo(s);
  renderCashChart(s);
  renderFunnelChart(s);
  renderClosers(s);
  renderVentasPorCloser(s);
  renderRevenueShare(s);
  renderRatesChart(s);
  renderConfirmer(s);
  if(document.getElementById('page-ventas').classList.contains('active')) renderVentas(s);
  if(document.getElementById('page-embudo').classList.contains('active')) renderEmbudo();
}

function renderRangeLabel() {
  const f = dateFrom.slice(5).replace('-','/');
  const t = dateTo.slice(5).replace('-','/');
  document.getElementById('range-label').textContent = f + ' – ' + t;
}

function renderStrip(s) {
  const showRate = pct(s.totAs, s.totAg);
  const closeRate = pct(s.totNuevas, s.totAs);
  document.getElementById('s-cash').textContent    = fmtMoney(s.totCash);
  document.getElementById('s-ventas').textContent  = s.totNuevas+'+'+(s.totRenov);
  document.getElementById('s-close').textContent   = closeRate+'%';
  document.getElementById('s-show').textContent    = showRate+'%';
}

// Métricas de conversión (fila de embudo en Visión General)
function renderKPIs(s) {
  const sr = pct(s.totAs,s.totAg), cr = pct(s.totNuevas,s.totAs);
  const p = computePrevStats();

  document.getElementById('k-ventas').textContent     = s.totNuevas;
  document.getElementById('k-ventas-sub').textContent = s.totNuevas+' contrato'+(s.totNuevas!==1?'s':'');
  document.getElementById('k-renov').textContent      = s.totRenov;
  document.getElementById('k-renov-sub').textContent  = s.totRenov+' contrato'+(s.totRenov!==1?'s':'');
  document.getElementById('k-agendas').textContent = s.totAg;
  document.getElementById('k-show').textContent    = sr+'%';
  document.getElementById('k-show-sub').textContent = s.totAs+'/'+s.totAg+' asist. / conf.';
  document.getElementById('k-close').textContent   = cr+'%';
  document.getElementById('k-close-sub').textContent = s.totNuevas+'/'+s.totAs+' nuevas';

  // Deltas vs período anterior
  document.getElementById('k-ventas-delta').innerHTML     = delta(s.totNuevas, p&&p.totNuevas);
  document.getElementById('k-renov-delta').innerHTML      = delta(s.totRenov,  p&&p.totRenov);
  document.getElementById('k-agendas-delta').innerHTML    = delta(s.totAg,     p&&p.totAg);
  document.getElementById('k-show-delta').innerHTML       = deltaP(sr,         p&&p.sr);
  document.getElementById('k-close-delta').innerHTML      = deltaP(cr,         p&&p.cr);
}

// ═══════════════════════════════════════════════
//  VISIÓN GENERAL (estilo muestra)
// ═══════════════════════════════════════════════

// Sparkline SVG a partir de una serie numérica (sin Chart.js: más liviano)
function sparklineSVG(values) {
  if (!values || values.length < 2) return '<svg class="ov-spark"></svg>';
  const W = 200, H = 36, PAD = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = (max - min) || 1;
  const pts = values.map((v, i) => {
    const x = PAD + i * (W - 2*PAD) / (values.length - 1);
    const y = H - PAD - (v - min) * (H - 2*PAD) / span;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  const fill = 'M' + pts[0] + ' L' + pts.slice(1).join(' L') + ` L${W-PAD},${H} L${PAD},${H} Z`;
  return `<svg class="ov-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`
    + `<path class="spark-fill" d="${fill}"></path>`
    + `<polyline points="${pts.join(' ')}"></polyline></svg>`;
}

// Serie semanal a partir de filas {campoFecha, valor}
function weeklySeries(rows, fechaKey, valFn) {
  const byW = {};
  rows.forEach(r => {
    const d = r[fechaKey];
    if (!d) return;
    const w = weekOf(d);
    byW[w] = (byW[w]||0) + valFn(r);
  });
  return Object.keys(byW).sort().map(w => byW[w]);
}

function renderOverview(s) {
  const p = computePrevStats();

  // ── KPI cards con sparkline ─────────────────
  const wCash    = weeklySeries(s.co, 'Fecha', r=>r.Monto);
  const wVenta   = weeklySeries(s.v, 'Fecha Cierre', r=>r.Venta);
  const wNContr  = weeklySeries(s.v, 'Fecha Cierre', ()=>1);
  const wTicket  = wVenta.map((v,i)=> wNContr[i] ? Math.round(v/wNContr[i]) : 0);
  // AOV semanal = venta de la semana / clientes únicos de la semana
  const aovByW = {};
  s.v.forEach(r => {
    const w = weekOf(r['Fecha Cierre']);
    if (!aovByW[w]) aovByW[w] = {venta:0, cli:new Set()};
    aovByW[w].venta += r.Venta; aovByW[w].cli.add(r.Cliente);
  });
  const wAOV = Object.keys(aovByW).sort().map(w => Math.round(aovByW[w].venta / aovByW[w].cli.size));
  const cards = [
    {lbl:'Cash Collected',  val:fmtMoney(s.totCash),  delta:delta(s.totCash, p&&p.totCash, 'ov-kpi-delta', true),  spark:wCash},
    {lbl:'Ventas Totales',  val:fmtMoney(s.totVenta), delta:delta(s.totVenta, p&&p.totVenta, 'ov-kpi-delta', true), spark:wVenta},
    {lbl:'Ticket Prom.',    val:fmtMoney(s.ticket),   delta:delta(s.ticket, p&&p.ticket, 'ov-kpi-delta', true),   spark:wTicket},
    {lbl:'AOV',             val:fmtMoney(s.aov),      delta:delta(s.aov, p&&p.aov, 'ov-kpi-delta', true),      spark:wAOV},
  ];
  document.getElementById('ov-kpis').innerHTML = cards.map(c => `
    <div class="ov-kpi">
      <div class="ov-kpi-lbl">${c.lbl}</div>
      <div class="ov-kpi-val">${c.val}</div>
      ${c.delta}
      ${sparklineSVG(c.spark)}
    </div>`).join('');

  // ── Ranking de closers (% del total de cash) ─
  const rk = s.closers
    .map(c => ({ name:c, cash:s.byCloser[c].cash }))
    .filter(r => r.cash > 0)
    .sort((a,b) => b.cash - a.cash);
  const totalCash = s.totCash || 1;
  document.getElementById('rk-body').innerHTML = rk.map((r,i) => {
    const share = Math.round(r.cash/totalCash*100);
    const col = share >= 40 ? 'var(--green)' : share >= 15 ? 'var(--gold)' : 'var(--red)';
    return `<tr>
      <td class="rk-pos">${i+1}</td>
      <td class="rk-name">${r.name}</td>
      <td>${fmtMoney(r.cash)}</td>
      <td><div class="rk-bar-cell"><div class="rk-bar"><i style="width:${Math.min(share,100)}%;background:${col};"></i></div><span class="rk-pct">${share}%</span></div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--g4);">Sin datos</td></tr>';

  // ── Meta vs Realizado (mensual) ──────────────
  const MN = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const byMonth = {};
  s.co.forEach(r => { const m = r.Fecha.slice(0,7); byMonth[m] = (byMonth[m]||0) + r.Monto; });
  const months = Object.keys(byMonth).sort();
  upsertChart('meta', 'c-meta', {
    type:'bar',
    data:{
      labels: months.map(m => MN[+m.slice(5,7)-1]),
      datasets:[
        {label:'Meta',      data:months.map(()=>META_MENSUAL_USD), backgroundColor:GY_P,   borderColor:GY,    borderWidth:1, borderRadius:3},
        {label:'Realizado', data:months.map(m=>Math.round(byMonth[m])), backgroundColor:GREEN_P, borderColor:GREEN, borderWidth:1.5, borderRadius:3},
      ]
    },
    options:{responsive:true,
      plugins:{legend:{position:'bottom',labels:{boxWidth:8,padding:10,color:legendCol()}},
        tooltip:{callbacks:{label: ctx => ' '+ctx.dataset.label+': $'+(ctx.parsed.y/1000).toFixed(1)+'K'}}},
      scales:{y:{grid:{color:gridCol()},ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'K'}},x:{grid:{display:false}}}
    }
  });

  // ── Ticket promedio en el tiempo (semanal) ───
  const wKeys = [...new Set(s.v.map(r=>weekOf(r['Fecha Cierre'])))].sort();
  const tSerie = wKeys.map(w => {
    const rows = s.v.filter(r=>weekOf(r['Fecha Cierre'])===w);
    return rows.length ? Math.round(rows.reduce((a,r)=>a+r.Venta,0)/rows.length) : 0;
  });
  upsertChart('ticketTime', 'c-ticket-time', {
    type:'line',
    data:{
      labels: wKeys.map(fmtDate),
      datasets:[{
        label:'Ticket prom.', data:tSerie,
        borderColor:GREEN, backgroundColor:GREEN_P,
        borderWidth:2, pointRadius:2.5, pointBackgroundColor:GREEN,
        tension:.3, fill:true,
      }]
    },
    options:{responsive:true,
      plugins:{legend:{display:false},
        tooltip:{callbacks:{label: ctx => ' $'+ctx.parsed.y.toLocaleString()}}},
      scales:{y:{grid:{color:gridCol()},ticks:{callback:v=>'$'+(v/1000).toFixed(1)+'K'}},x:{grid:{display:false}}}
    }
  });

  // ── Programas campeones (por Plan) ───────────
  const byPlan = {};
  s.v.forEach(r => {
    const pl = (r.Plan||'Sin plan').trim() || 'Sin plan';
    if (!byPlan[pl]) byPlan[pl] = {n:0, venta:0};
    byPlan[pl].n++; byPlan[pl].venta += r.Venta;
  });
  const planes = Object.entries(byPlan).sort((a,b)=>b[1].venta-a[1].venta);
  document.getElementById('pc-body').innerHTML = planes.map(([pl,d]) => `
    <tr>
      <td class="pc-name">${pl}</td>
      <td>${d.n}</td>
      <td class="pc-cash">${fmtMoney(d.venta)}</td>
    </tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--g4);">Sin datos</td></tr>';

  // ── Origen de las ventas (por tipo) ──────────
  const byTipoV = {};
  s.v.forEach(r => {
    const t = (r.Tipo||'Sin tipo').trim() || 'Sin tipo';
    if (!byTipoV[t]) byTipoV[t] = {n:0, venta:0};
    byTipoV[t].n++; byTipoV[t].venta += r.Venta;
  });
  const totV = s.totVenta || 1;
  const dotCols = ['var(--green)','var(--blue)','var(--gold)','#7c5cbf','var(--red)'];
  document.getElementById('ventas-origen').innerHTML =
    Object.entries(byTipoV).sort((a,b)=>b[1].venta-a[1].venta).map(([t,d],i) => `
    <div class="ov-mini-row">
      <div class="ov-mini-dot" style="background:${dotCols[i%dotCols.length]};"></div>
      <div class="ov-mini-lbl">${t} <span style="color:var(--g4);">· ${d.n} contrato${d.n!==1?'s':''}</span></div>
      <div class="ov-mini-val">${fmtMoney(d.venta)}</div>
      <div class="ov-mini-sub">${Math.round(d.venta/totV*100)}%</div>
    </div>`).join('');
}

function renderCashChart(s) {
  const weeks = Object.keys(s.weekCash).sort();
  // Tipos dinámicos: los conocidos con su estilo, los nuevos con paleta de reserva
  const orden = ['Nuevo','CxC','Renovación','Upsell'];
  const tipos = [...s.tiposCash].sort((a,b)=>{
    const ia = orden.indexOf(a), ib = orden.indexOf(b);
    return (ia<0?99:ia) - (ib<0?99:ib);
  });
  upsertChart('cash', 'c-cash', {
    type:'bar',
    data:{
      labels: weeks.map(fmtDate),
      datasets: tipos.map(t=>({
        label: t,
        data: weeks.map(w => Math.round((s.weekCashByTipo[w]||{})[t]||0)),
        backgroundColor: tipoStyle(t).fill,
        borderColor: tipoStyle(t).hex,
        borderWidth: 1,
        borderRadius: 3,
      }))
    },
    options:{
      responsive: true,
      plugins:{
        legend:{position:'bottom',labels:{boxWidth:10,padding:12,color:legendCol()}},
        tooltip:{callbacks:{label: ctx => ' '+ctx.dataset.label+': $'+(ctx.parsed.y/1000).toFixed(1)+'K'}}
      },
      scales:{
        x:{stacked:true, grid:{color:gridCol()}},
        y:{stacked:true, grid:{color:gridCol()}, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'K'}}
      }
    }
  });
}

function renderFunnelChart(s) {
  const cls = Object.keys(s.byCloser).filter(c=>s.byCloser[c].ag+s.byCloser[c].as>0);
  upsertChart('funnel', 'c-funnel', {
    type:'bar',
    data:{
      labels:cls,
      datasets:[
        {label:'Agendas',   data:cls.map(c=>s.byCloser[c].ag), backgroundColor:GY_P,  borderColor:GY,    borderWidth:1},
        {label:'Asistencias',data:cls.map(c=>s.byCloser[c].as), backgroundColor:GOLD_P,borderColor:GOLD,  borderWidth:1},
        {label:'Cierres',   data:cls.map(c=>s.byCloser[c].ci), backgroundColor:GREEN_P,borderColor:GREEN, borderWidth:1},
      ]
    },
    options:{responsive:true,
      plugins:{legend:{position:'bottom',labels:{boxWidth:8,padding:10,color:legendCol()}}},
      scales:{y:{grid:{color:gridCol()}},x:{grid:{color:gridCol()}}}
    }
  });
}

function renderClosers(s) {
  const badges = {
    Ignacio:{cls:'b-gold',txt:'Líder'},
    Sebastian:{cls:'b-red',txt:'Sin Cierres'},
    Karim:{cls:'b-grey',txt:'En Desarrollo'},
    Guillermo:{cls:'b-grey',txt:'Baja Actividad'}
  };
  const cavs = {Ignacio:'cav-I',Sebastian:'cav-S',Karim:'cav-K',Guillermo:'cav-G'};

  let html = '';
  s.closers.forEach(c => {
    const d = s.byCloser[c];
    if(d.ag+d.as+d.ci===0) return;
    const sr = pct(d.as,d.ag), cr = pct(d.ci,d.as);
    const b = badges[c]||{cls:'b-grey',txt:c};

    // Weekly rows
    const weekRows = {};
    s.md.filter(r=>r.Closer===c).forEach(r=>{
      const w=weekOf(r.Fecha);
      if(!weekRows[w]) weekRows[w]={ag:0,as:0,ci:0,cash:0};
      weekRows[w].ag+=r.Agendas; weekRows[w].as+=r.Asistencias; weekRows[w].ci+=r.Cierres;
    });
    s.co.filter(r=>r.Closer===c).forEach(r=>{
      const w=weekOf(r.Fecha);
      if(!weekRows[w]) weekRows[w]={ag:0,as:0,ci:0,cash:0};
      weekRows[w].cash+=r.Monto;
    });
    const wkeys = Object.keys(weekRows).sort();
    const whtml = wkeys.map(w=>`
      <tr>
        <td>${fmtDate(w)}</td>
        <td>${weekRows[w].ag}</td><td>${weekRows[w].as}</td><td>${weekRows[w].ci}</td>
        <td class="cash">${weekRows[w].cash>0?fmtMoney(weekRows[w].cash):'—'}</td>
      </tr>`).join('');
    const totCash  = s.co.filter(r=>r.Closer===c).reduce((s,r)=>s+r.Monto,0);
    const totVenta = s.v.filter(r=>r.Closer===c).reduce((s,r)=>s+r.Venta,0);

    const sebAlert = c==='Sebastian' ? `
      <div class="alert warn" style="margin:0 14px 12px">
        <div class="alert-title">⚠ Alerta Conversión</div>
        Show rate ${sr}% pero 0 cierres. El cuello de botella está en la conversión, no en la convocatoria.
      </div>` : '';
    const guillAlert = c==='Guillermo' && d.ag<6 ? `
      <div class="alert gy" style="margin:0 14px 12px">
        <div class="alert-title">📌 Nota</div>
        Actividad muy baja (${d.ag} agendas). Necesita más volumen para evaluar su tasa de conversión real.
      </div>` : '';

    html += `
    <div class="ccard" id="cc-${c}">
      <div class="ccard-head" onclick="toggleCloser('${c}')">
        <div class="cav ${cavs[c]}">${c[0]}</div>
        <div class="cname">${c}</div>
        <span class="cbadge ${b.cls}">${b.txt}</span>
        <span class="chevron">▼</span>
      </div>
      <div class="cstats" style="grid-template-columns:repeat(5,1fr)">
        <div class="cs"><div class="cs-val">${d.ag}</div><div class="cs-lbl">Agendas</div></div>
        <div class="cs"><div class="cs-val">${d.as}</div><div class="cs-lbl">Asistencias</div></div>
        <div class="cs"><div class="cs-val">${d.ci}</div><div class="cs-lbl">Cierres</div></div>
        <div class="cs"><div class="cs-val" style="color:var(--green)">${fmtMoney(totVenta)}</div><div class="cs-lbl">Venta Total</div></div>
        <div class="cs"><div class="cs-val" style="color:${totCash>0?'var(--gold-deep)':'var(--g3)'}">${totCash>0?fmtMoney(totCash):'$0'}</div><div class="cs-lbl">Cash</div></div>
      </div>
      <div class="cdetail">
        ${sebAlert}${guillAlert}
        <div class="rate-block">
          <div class="rate-row-item">
            <span class="rate-name">Show Rate</span>
            <div class="rate-track"><div class="rate-fill" style="width:${sr}%;background:${GOLD}"></div></div>
            <span class="rate-pct">${sr}%</span>
          </div>
          <div class="rate-row-item">
            <span class="rate-name">Close Rate</span>
            <div class="rate-track"><div class="rate-fill" style="width:${cr}%;background:${GREEN}"></div></div>
            <span class="rate-pct">${cr}%</span>
          </div>
        </div>
        <div class="wtable-wrap">
          <table class="wtable">
            <thead><tr><th>Semana</th><th>Ag.</th><th>As.</th><th>Ci.</th><th>Cash</th></tr></thead>
            <tbody>
              ${whtml}
              <tr>
                <td>TOTAL</td><td>${d.ag}</td><td>${d.as}</td><td>${d.ci}</td>
                <td class="cash">${totCash>0?fmtMoney(totCash):'$0'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  });
  document.getElementById('closer-list').innerHTML = html || '<div class="no-data"><span>🔍</span>Sin datos en este período</div>';
  // Reaplicar el filtro activo si el usuario tenía una búsqueda escrita
  // (la lista se reconstruye en cada render, incl. revalidación en background)
  const sf = document.getElementById('closer-search-input');
  if (sf && sf.value) filterClosers(sf.value);
}

const TARGET_SHOW  = 70;  // Meta Show Rate %
const TARGET_CLOSE = 25;  // Meta Close Rate %

function renderRatesChart(s) {
  const cls = s.closers.filter(c=>s.byCloser[c].ag>0);
  upsertChart('rates', 'c-rates', {
    type:'bar',
    data:{
      labels:cls,
      datasets:[
        {label:'Show Rate %', data:cls.map(c=>pct(s.byCloser[c].as,s.byCloser[c].ag)), backgroundColor:GOLD_P, borderColor:GOLD, borderWidth:1.5},
        {label:'Close Rate %',data:cls.map(c=>pct(s.byCloser[c].ci,s.byCloser[c].as)), backgroundColor:GREEN_P,borderColor:GREEN,borderWidth:1.5},
        // Líneas de meta
        {label:'Meta Show '+TARGET_SHOW+'%', type:'line',
         data:cls.map(()=>TARGET_SHOW), borderColor:GOLD, borderWidth:1.5,
         borderDash:[5,4], pointRadius:0, fill:false, tension:0},
        {label:'Meta Close '+TARGET_CLOSE+'%', type:'line',
         data:cls.map(()=>TARGET_CLOSE), borderColor:GREEN, borderWidth:1.5,
         borderDash:[5,4], pointRadius:0, fill:false, tension:0},
      ]
    },
    options:{responsive:true,
      plugins:{legend:{position:'bottom',labels:{
        boxWidth:8, padding:12, color:legendCol(),
        filter: item => !item.text.startsWith('Meta') // ocultar metas del legend principal
      }}},
      scales:{y:{grid:{color:gridCol()},ticks:{callback:v=>v+'%'},max:110},x:{grid:{color:gridCol()}}}
    }
  });
  // Leyenda custom de metas
  const wrap = document.getElementById('c-rates').closest('.cc');
  if (wrap && !wrap.querySelector('.target-legend')) {
    const leg = document.createElement('div');
    leg.className = 'target-legend';
    leg.innerHTML =
      `<div class="target-legend-item"><div class="target-legend-line" style="border-color:${GOLD}"></div>Meta Show Rate ${TARGET_SHOW}%</div>` +
      `<div class="target-legend-item"><div class="target-legend-line" style="border-color:${GREEN}"></div>Meta Close Rate ${TARGET_CLOSE}%</div>`;
    wrap.appendChild(leg);
  }
}

// Ventas por closer: barras apiladas Nuevas vs Renovaciones (USD vendidos)
function renderVentasPorCloser(s) {
  // $ vendido por closer separado por tipo, ordenado de mayor a menor total
  const porCloser = {};
  s.v.forEach(r => {
    if (!r.Closer) return;
    if (!porCloser[r.Closer]) porCloser[r.Closer] = { nuevas:0, renov:0 };
    porCloser[r.Closer][esRenov(r) ? 'renov' : 'nuevas'] += r.Venta;
  });
  const cls = Object.keys(porCloser)
    .filter(c => porCloser[c].nuevas + porCloser[c].renov > 0)
    .sort((a,b) => (porCloser[b].nuevas+porCloser[b].renov) - (porCloser[a].nuevas+porCloser[a].renov));

  upsertChart('ventasCloser', 'c-ventas-closer', {
    type:'bar',
    data:{
      labels: cls,
      datasets:[
        {label:'Nuevas',       data:cls.map(c=>Math.round(porCloser[c].nuevas)), backgroundColor:'rgba(61,107,80,.75)',  borderColor:GREEN, borderWidth:1, borderRadius:3},
        {label:'Renovaciones', data:cls.map(c=>Math.round(porCloser[c].renov)),  backgroundColor:'rgba(42,82,122,.75)', borderColor:BLUE,  borderWidth:1, borderRadius:3},
      ]
    },
    options:{ responsive:true,
      plugins:{
        legend:{position:'bottom',labels:{boxWidth:10,padding:12,color:legendCol()}},
        tooltip:{callbacks:{label: ctx => ' '+ctx.dataset.label+': $'+(ctx.parsed.y/1000).toFixed(1)+'K'}}
      },
      scales:{
        x:{stacked:true, grid:{color:gridCol()}},
        y:{stacked:true, grid:{color:gridCol()}, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'K'}}
      }
    }
  });
}

// Contribución al revenue: dona con el % del cash cobrado por cada closer
function renderRevenueShare(s) {
  const cls = s.closers.filter(c => (s.byCloser[c].cash||0) > 0)
                        .sort((a,b)=> s.byCloser[b].cash - s.byCloser[a].cash);
  const tot = cls.reduce((t,c)=>t+s.byCloser[c].cash,0);
  const palette  = [GOLD, GREEN, BLUE, '#7c5cbf', GY, '#b5793f'];
  const paletteP = ['rgba(168,131,42,.8)','rgba(61,107,80,.8)','rgba(42,82,122,.8)','rgba(124,92,191,.8)','rgba(154,151,143,.8)','rgba(181,121,63,.8)'];

  upsertChart('revenueShare', 'c-revenue-share', {
    type:'doughnut',
    data:{
      labels: cls,
      datasets:[{
        data: cls.map(c=>Math.round(s.byCloser[c].cash)),
        backgroundColor: cls.map((_,i)=>paletteP[i % paletteP.length]),
        borderColor:     cls.map((_,i)=>palette[i % palette.length]),
        borderWidth:2
      }]
    },
    options:{ responsive:true, cutout:'58%',
      plugins:{
        legend:{position:'bottom',labels:{boxWidth:10,padding:12,color:legendCol()}},
        tooltip:{callbacks:{label: ctx => {
          const v = ctx.parsed, p = tot ? Math.round(v/tot*100) : 0;
          return ' '+ctx.label+': $'+(v/1000).toFixed(1)+'K ('+p+'%)';
        }}}
      }
    }
  });
}

function renderConfirmer(s) {
  const rate = pct(s.confConf,s.confTotal);
  document.getElementById('conf-header-wrap').innerHTML = `
    <div class="conf-header">
      <div class="conf-av">C</div>
      <div><div class="conf-name">Claudia</div><div class="conf-role">Call Confirmer</div></div>
      <div class="conf-rate"><div class="conf-rate-val">${rate}%</div><div class="conf-rate-lbl">Tasa Conf.</div></div>
    </div>`;

  document.getElementById('conf-stats-wrap').innerHTML = `
    <div class="conf-stat"><div class="conf-stat-val" style="color:var(--green)">${s.confConf}</div><div class="conf-stat-lbl">Confirmados</div></div>
    <div class="conf-stat"><div class="conf-stat-val" style="color:var(--red)">${s.confCanc}</div><div class="conf-stat-lbl">Cancelados</div></div>
    <div class="conf-stat"><div class="conf-stat-val" style="color:var(--g3)">${s.confDesc}</div><div class="conf-stat-lbl">Descalif.</div></div>`;

  const confPct = s.confTotal ? Math.round(s.confConf/s.confTotal*100) : 0;
  const cancPct = s.confTotal ? Math.round(s.confCanc/s.confTotal*100) : 0;
  const descPct = Math.max(0,100-confPct-cancPct);
  document.getElementById('conf-pipe').innerHTML = `
    <div class="pipe-seg" style="width:${confPct}%;background:var(--green);color:#fff;">${confPct}% ✓</div>
    <div class="pipe-seg" style="width:${cancPct}%;background:var(--red-p);color:var(--red);">${cancPct}% ✗</div>
    ${descPct>0?`<div class="pipe-seg" style="width:${descPct}%;background:var(--bg2);color:var(--g4);">${descPct}%</div>`:''}`;

  // Weekly chart
  const weeks = Object.keys(s.weekConf).sort();
  upsertChart('confWeek', 'c-conf-week', {
    type:'bar',
    data:{
      labels:weeks.map(fmtDate),
      datasets:[
        {label:'Confirmados', data:weeks.map(w=>s.weekConf[w].conf), backgroundColor:GREEN_P, borderColor:GREEN, borderWidth:1},
        {label:'Cancelados',  data:weeks.map(w=>s.weekConf[w].canc), backgroundColor:RED_P,   borderColor:RED,   borderWidth:1},
        {label:'Descalif.',   data:weeks.map(w=>s.weekConf[w].desc), backgroundColor:GY_P,    borderColor:GY,    borderWidth:1},
      ]
    },
    options:{responsive:true,
      plugins:{legend:{position:'bottom',labels:{boxWidth:8,padding:10,color:legendCol()}}},
      scales:{y:{grid:{color:gridCol()}},x:{grid:{color:gridCol()}}}
    }
  });

  // By closer donut
  const ckeys = Object.keys(s.confByCloser);
  upsertChart('confCloser', 'c-conf-closer', {
    type:'doughnut',
    data:{
      labels:ckeys,
      datasets:[{
        data:ckeys.map(k=>s.confByCloser[k]),
        backgroundColor:[GOLD_P,BLUE_P,GREEN_P,GY_P],
        borderColor:[GOLD,BLUE,GREEN,GY],
        borderWidth:2
      }]
    },
    options:{responsive:true,cutout:'58%',
      plugins:{legend:{position:'bottom',labels:{boxWidth:10,padding:12,color:legendCol()}}}
    }
  });
}

function renderVentas(s) {
  const totV = s.totVenta, totC = s.totCobrado, totP = s.totPdte;
  document.getElementById('ventas-kpis').innerHTML = `
    <div class="kpi g"><div class="kpi-lbl">Total Ventas</div><div class="kpi-val">${fmtMoney(totV)}</div><div class="kpi-sub">${s.v.length} contratos</div></div>
    <div class="kpi gn"><div class="kpi-lbl">Cobrado</div><div class="kpi-val">${fmtMoney(totC)}</div><div class="kpi-sub">${pct(totC,totV)}% del total</div></div>
    <div class="kpi rd"><div class="kpi-lbl">Pendiente</div><div class="kpi-val">${fmtMoney(totP)}</div><div class="kpi-sub">${pct(totP,totV)}% por cobrar</div></div>`;

  // Se calcula desde cobros aunque no haya ventas en el período.
  const MNAMES_C = {'01':'Ene','02':'Feb','03':'Mar','04':'Abr','05':'May','06':'Jun','07':'Jul','08':'Ago','09':'Sep','10':'Oct','11':'Nov','12':'Dic'};
  const commissionLabel = value => String(value).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
  const paymentEl = document.getElementById('bonificacion-mensual-wrap');
  paymentEl.innerHTML = '';
  if (BONIFICACION_MENSUAL.length) {
    const cashByMonth = {};
    s.co.forEach(r => {
      if (!r.Fecha) return;
      const ym = r.Fecha.slice(0,7);
      cashByMonth[ym] = (cashByMonth[ym] || 0) + r.Monto;
    });
    const paymentMonths = Object.keys(cashByMonth).sort();
    const totalCash = paymentMonths.reduce((sum, ym) => sum + cashByMonth[ym], 0);
    const paymentColumns = BONIFICACION_MENSUAL.map(person => ({
      ...person, total: totalCash * person.pct, color: 'var(--gold-deep)'
    }));
    const monthlyPaymentRows = paymentMonths.map(ym => {
      const mn = MNAMES_C[ym.slice(5,7)] + ' ' + ym.slice(0,4);
      const d = paymentColumns.map(column => cashByMonth[ym] * column.pct);
      const rowTot = d.reduce((sum, value) => sum + value, 0);
      return '<tr>'
        +'<td style="padding:9px 10px;font-size:.68rem;color:var(--g2);font-weight:500;border-bottom:1px solid var(--border);">'+mn+'</td>'
        +paymentColumns.map((column, i) => '<td style="padding:9px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:600;font-size:.82rem;color:'+column.color+';border-bottom:1px solid var(--border);">'+(d[i]!==0?fmtMoney(d[i]):'—')+'</td>' ).join('')
        +'<td style="padding:9px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:.82rem;color:var(--g1);border-bottom:1px solid var(--border);">'+fmtMoney(rowTot)+'</td>'
        +'</tr>';
    }).join('');
    paymentEl.innerHTML = '<div style="padding:0 16px 16px;">'
      +'<div style="background:var(--white);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);margin-bottom:14px;">'
      +'<div style="padding:11px 14px;background:var(--ink);display:flex;align-items:center;gap:8px;">'
      +'<span style="font-family:\'Jost\',sans-serif;font-weight:700;font-size:.88rem;color:#fff;">Bonificación mensual</span>'
      +'<span style="font-size:.58rem;color:var(--g4);text-transform:uppercase;letter-spacing:.07em;margin-left:auto;">USD</span>'
      +'</div>'
      +'<div style="overflow-x:auto;">'
      +'<table style="width:100%;border-collapse:collapse;">'
      +'<thead><tr style="background:var(--bg);">'
      +'<th style="padding:8px 10px;text-align:left;font-size:.57rem;color:var(--g4);text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">Mes</th>'
      +paymentColumns.map(column => '<th style="padding:8px 10px;text-align:right;font-size:.57rem;color:'+column.color+';text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">'+commissionLabel(column.nombre)+'</th>' ).join('')
      +'<th style="padding:8px 10px;text-align:right;font-size:.57rem;color:var(--g3);text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">Total</th>'
      +'</tr></thead>'
      +'<tbody>'+monthlyPaymentRows+'</tbody>'
      +'<tfoot><tr style="background:var(--bg);">'
      +'<td style="padding:10px 10px;font-size:.65rem;font-weight:700;color:var(--g1);text-transform:uppercase;letter-spacing:.05em;">TOTAL</td>'
      +paymentColumns.map(column => '<td style="padding:10px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:.95rem;color:'+column.color+';">'+fmtMoney(column.total)+'</td>' ).join('')
      +'<td style="padding:10px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:1rem;color:var(--g1);">'+fmtMoney(paymentColumns.reduce((sum, column) => sum + column.total, 0))+'</td>'
      +'</tr></tfoot>'
      +'</table>'
      +'</div></div>'
      +'</div>';
  }

  if(s.v.length===0){
    document.getElementById('vtable-wrap').innerHTML='<div class="no-data"><span>💰</span>Sin ventas en este período</div>';
    document.getElementById('fc-list').innerHTML='';
    return;
  }

  let rows = s.v.map(r=>`
    <div class="vrow">
      <div class="vcol" style="flex:2"><div class="vname">${r.Cliente}</div><div class="vclose">${r.Closer} · ${r.Plan}</div></div>
      <div class="vcol vmonto">${fmtMoney(r.Venta)}</div>
      <div class="vcol vcobrado">${fmtMoney(r.Cobrado)}</div>
      <div class="vcol vpdte" style="color:${r.Pendiente>0?'var(--red)':'var(--g4)'}">${r.Pendiente>0?fmtMoney(r.Pendiente):'—'}</div>
    </div>`).join('');

  document.getElementById('vtable-wrap').innerHTML = `
    <div class="vtable-wrap">
      <div class="vrow hdr">
        <div class="vcol vlbl" style="flex:2">Cliente</div>
        <div class="vcol vlbl" style="text-align:right">Monto</div>
        <div class="vcol vlbl" style="text-align:right">Cobrado</div>
        <div class="vcol vlbl" style="text-align:right">Pdte.</div>
      </div>${rows}
    </div>`;

  // Comisiones
  const commissionPalette = ['var(--gold-deep)', 'var(--blue)', 'var(--green)', 'var(--red)', 'var(--g2)'];
  const commissionColors = new Map();
  RAW_C.forEach(r => {
    if (r.ComCloser > 0 && !commissionColors.has(r.Closer)) {
      commissionColors.set(r.Closer, commissionPalette[commissionColors.size % commissionPalette.length]);
    }
  });

  // Totals from the sheet, with no person-specific exclusions or rates.
  const comC = new Map();
  s.co.forEach(r => {
    comC.set(r.Closer, (comC.get(r.Closer)||0) + (r.ComCloser||0));
  });
  const totConf = s.co.reduce((acc,r)=>acc+(r.ComConf||0), 0);
  const comRows = [...comC].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const totComC = comRows.reduce((acc,[,v])=>acc+v, 0);
  // s.cc is RAW_CC filtered to the same period by computeCoreStats.
  const confirmers = [...new Set(s.cc.map(r => r.Confirmer.trim()).filter(Boolean))];
  const confirmerLabel = confirmers.length === 1 ? confirmers[0] : 'Call Confirmer';
  const columns = comRows.map(([name, total]) => ({
    name, total, color: commissionColors.get(name),
    amount: r => r.Closer === name ? (r.ComCloser||0) : 0
  }));
  columns.push({name: confirmerLabel, total: totConf, color: 'var(--green)', amount: r => r.ComConf||0});

  // Monthly values use exactly the same columns as the header and totals.
  const monthlyMap = {};
  s.co.forEach(r => {
    if (!r.Fecha) return;
    const ym = r.Fecha.slice(0,7);
    if (!monthlyMap[ym]) monthlyMap[ym] = columns.map(() => 0);
    columns.forEach((column, i) => { monthlyMap[ym][i] += column.amount(r); });
  });
  const monthKeys = Object.keys(monthlyMap).sort();

  const monthTableRows = monthKeys.map(ym => {
    const mn = MNAMES_C[ym.slice(5,7)] + ' ' + ym.slice(0,4);
    const d = monthlyMap[ym];
    const rowTot = d.reduce((sum, value) => sum + value, 0);
    return '<tr>'
      +'<td style="padding:9px 10px;font-size:.68rem;color:var(--g2);font-weight:500;border-bottom:1px solid var(--border);">'+mn+'</td>'
      +columns.map((column, i) => '<td style="padding:9px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:600;font-size:.82rem;color:'+column.color+';border-bottom:1px solid var(--border);">'+(d[i]!==0?fmtMoney(d[i]):'—')+'</td>' ).join('')
      +'<td style="padding:9px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:.82rem;color:var(--g1);border-bottom:1px solid var(--border);">'+fmtMoney(rowTot)+'</td>'
      +'</tr>';
  }).join('');

  const cEl = document.getElementById('comisiones-wrap');
  if (cEl) {
    cEl.innerHTML =
      // ── MONTHLY BREAKDOWN TABLE ──
      '<div style="background:var(--white);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);margin-bottom:14px;">'
      +'<div style="padding:11px 14px;background:var(--ink);display:flex;align-items:center;gap:8px;">'
      +'<span style="font-family:\'Jost\',sans-serif;font-weight:700;font-size:.88rem;color:#fff;">Desglose Mensual</span>'
      +'<span style="font-size:.58rem;color:var(--g4);text-transform:uppercase;letter-spacing:.07em;margin-left:auto;">USD</span>'
      +'</div>'
      +'<div style="overflow-x:auto;">'
      +'<table style="width:100%;border-collapse:collapse;">'
      +'<thead><tr style="background:var(--bg);">'
      +'<th style="padding:8px 10px;text-align:left;font-size:.57rem;color:var(--g4);text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">Mes</th>'
      +columns.map(column => '<th style="padding:8px 10px;text-align:right;font-size:.57rem;color:'+column.color+';text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">'+commissionLabel(column.name)+'</th>' ).join('')
      +'<th style="padding:8px 10px;text-align:right;font-size:.57rem;color:var(--g3);text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">Total</th>'
      +'</tr></thead>'
      +'<tbody>'+monthTableRows+'</tbody>'
      +'<tfoot><tr style="background:var(--bg);">'
      +'<td style="padding:10px 10px;font-size:.65rem;font-weight:700;color:var(--g1);text-transform:uppercase;letter-spacing:.05em;">TOTAL</td>'
      +columns.map(column => '<td style="padding:10px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:.95rem;color:'+column.color+';">'+fmtMoney(column.total)+'</td>' ).join('')
      +'<td style="padding:10px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:1rem;color:var(--g1);">'+fmtMoney(totComC+totConf)+'</td>'
      +'</tr></tfoot>'
      +'</table>'
      +'</div></div>'

      // ── CLOSER CARDS ──
      +'<div style="background:var(--white);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);margin-bottom:10px;">'
      +'<div style="padding:9px 14px;background:var(--bg);border-bottom:1px solid var(--border);font-size:.6rem;font-weight:600;color:var(--g3);text-transform:uppercase;letter-spacing:.07em;">Closers</div>'
      + comRows.map(([c,v]) =>
          '<div style="display:flex;align-items:center;padding:11px 14px;border-bottom:1px solid var(--border);gap:12px;">'
          +'<div style="width:32px;height:32px;border-radius:50%;background:var(--gold-pale);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;color:'+commissionColors.get(c)+';">'+commissionLabel(c[0])+'</div>'
          +'<div style="flex:1;font-size:.72rem;font-weight:500;color:var(--g1);">'+commissionLabel(c)+'</div>'
          +'<div style="font-weight:700;font-size:1rem;color:var(--gold-deep);">'+fmtMoney(v)+'</div>'
          +'</div>'
        ).join('')
      +'<div style="display:flex;justify-content:space-between;padding:9px 14px;background:var(--bg);">'
      +'<span style="font-size:.6rem;color:var(--g3);font-weight:600;text-transform:uppercase;">Total</span>'
      +'<span style="font-weight:700;color:var(--gold-deep);">'+fmtMoney(totComC)+'</span>'
      +'</div></div>'

      // ── CONFIRMER CARD ──
      +'<div style="background:var(--white);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);">'
      +'<div style="padding:9px 14px;background:var(--bg);border-bottom:1px solid var(--border);font-size:.6rem;font-weight:600;color:var(--g3);text-transform:uppercase;letter-spacing:.07em;">Call Confirmer</div>'
      +'<div style="display:flex;align-items:center;padding:11px 14px;border-bottom:1px solid var(--border);gap:12px;">'
      +'<div style="width:32px;height:32px;border-radius:50%;background:var(--green-p);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--green);">C</div>'
      +'<div style="flex:1;font-size:.72rem;font-weight:500;color:var(--g1);">' +commissionLabel(confirmerLabel)+'</div>'
      +'<div style="font-weight:700;font-size:1rem;color:var(--green);">'+fmtMoney(totConf)+'</div>'
      +'</div>'
      +'<div style="display:flex;justify-content:space-between;padding:9px 14px;background:var(--bg);">'
      +'<span style="font-size:.6rem;color:var(--g3);font-weight:600;text-transform:uppercase;">Total</span>'
      +'<span style="font-weight:700;color:var(--green);">'+fmtMoney(totConf)+'</span>'
      +'</div></div>';
  }
}

function renderTipo(s) {
  const el = document.getElementById('tipo-row');
  if (!el) return;
  const total = s.totCash || 1;
  // Tipos según los datos reales, ordenados por monto desc (los conocidos
  // primero mantienen su estilo; los nuevos reciben la paleta de reserva)
  const tipoB = {};
  s.co.forEach(r => {
    const t = r.Tipo || 'CxC';
    tipoB[t] = (tipoB[t]||0) + r.Monto;
  });
  const tipos = Object.keys(tipoB).sort((a,b)=>tipoB[b]-tipoB[a]);
  el.innerHTML = tipos.map(k => {
    const st = tipoStyle(k);
    const m = tipoB[k], p = Math.round(m/total*100);
    return '<div class="kpi" style="min-width:110px;border-top:3px solid '+st.css+';">'
      +'<div class="kpi-lbl" style="display:flex;align-items:center;gap:4px;"><span style="color:'+st.css+';">'+st.ico+'</span>'+k.toUpperCase()+'</div>'
      +'<div class="kpi-val" style="color:'+st.css+';font-size:1.5rem;">'+fmtMoney(m)+'</div>'
      +'<div class="kpi-sub">'+p+'% del cash</div>'
    +'</div>';
  }).join('');
}

// ═══════════════════════════════════════════════
//  CLOSER SEARCH
// ═══════════════════════════════════════════════
function filterClosers(q) {
  const term = q.toLowerCase().trim();
  document.querySelectorAll('#closer-list .ccard').forEach(card => {
    const name = card.id.replace('cc-','').toLowerCase();
    card.style.display = (!term || name.includes(term)) ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════
//  EXPORT PDF
// ═══════════════════════════════════════════════
function exportPDF() {
  // Expand all closer cards before printing
  document.querySelectorAll('.ccard').forEach(c => c.classList.add('open'));
  window.print();
  // Restore state after print dialog
  setTimeout(() => document.querySelectorAll('.ccard').forEach(c => c.classList.remove('open')), 1000);
}

// ═══════════════════════════════════════════════
//  INTERACTIONS
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
//  EMBUDO
// ═══════════════════════════════════════════════
const EMBUDO_QUIEBRE = '2026-07-20';
let embudoModo = 'semanal', embudoError = '';

function embudoFecha(value) { return typeof value === 'string' ? value.slice(0,10) : ''; }
function embudoNumero(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function embudoDivision(a, b) {
  return a == null || b == null || b === 0 ? null : a / b;
}
function parseEmbudo(rows, hoy = new Date().toISOString().slice(0,10)) {
  if (!rows.length) return [];
  const keys = [...new Set(rows.flatMap(r => Object.keys(r).filter(k => k.startsWith('Leads ('))))];
  if (keys.length !== 1) throw new Error('Embudo: se esperaba una única columna que empiece con "Leads (". Revisá la hoja EMBUDO_SEMANAL.');
  return rows.map(r => ({
    inicio: embudoFecha(r['Semana inicio (lun)']), fin: embudoFecha(r['Semana fin (dom)']),
    mes: embudoNumero(r.Mes), inversion: embudoNumero(r['Inversión Meta (USD)']),
    bookings: embudoNumero(r[keys[0]]), agendas: embudoNumero(r.Agendas),
    venta: embudoNumero(r['Agendas de venta (CRM)']), confirmadas: embudoNumero(r['Citas confirmadas']),
    asistencias: embudoNumero(r['Reuniones realizadas (1ª con cada lead)']), cierres: embudoNumero(r['Cierres nuevos']),
    cpl: embudoNumero(r['CPL (USD)']), costoVenta: embudoNumero(r['Costo por agenda de venta (USD)']),
    show: embudoNumero(r['% show (realizadas/confirmadas)']), cierre: embudoNumero(r['% cierre (cierres/realizadas)']),
    costoAsistencia: embudoNumero(r['Costo por reunión']), cac: embudoNumero(r['CAC (USD)']),
  })).filter(r => r.inicio && !(r.inicio > hoy && !r.inversion && !r.agendas && !r.bookings))
    .map(r => ({...r, qb: r.inicio >= EMBUDO_QUIEBRE ? embudoDivision(r.bookings, r.agendas) : null}))
    .sort((a,b) => a.inicio.localeCompare(b.inicio));
}
function parseMetaDiario(rows) {
  return rows.map(r => ({
    Fecha: embudoFecha(r.Fecha), Inversion: embudoNumero(r['Inversión Meta (USD)']),
    Leads: embudoNumero(r['Leads (GHL)']), AgendasVenta: embudoNumero(r['Agendas de venta (CRM)']),
    Fuente: String(r.Fuente || ''), Nota: String(r.Nota || ''),
  }));
}
function embudoMensual(rows) {
  const groups = new Map();
  rows.forEach(r => {
    // El mes lo asigna la hoja; ajustar el año en semanas que cruzan diciembre.
    let year = Number(r.inicio.slice(0,4));
    if (r.inicio.slice(5,7) === '12' && r.mes === 1) year++;
    if (r.inicio.slice(5,7) === '01' && r.mes === 12) year--;
    const key = year+'-'+String(r.mes).padStart(2,'0');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  return [...groups].sort(([a],[b]) => a.localeCompare(b)).map(([periodo, weeks]) => {
    const r = {periodo};
    // Una suma incompleta sigue siendo ausencia, no un total artificialmente bajo.
    ['inversion','bookings','agendas','venta','confirmadas','asistencias','cierres'].forEach(k => {
      r[k] = weeks.some(w => w[k] == null) ? null : weeks.reduce((sum,w) => sum+w[k], 0);
    });
    r.cpl = embudoDivision(r.inversion, r.bookings);
    r.qb = weeks.every(w => w.inicio >= EMBUDO_QUIEBRE) ? embudoDivision(r.bookings, r.agendas) : null;
    r.costoVenta = embudoDivision(r.inversion, r.venta);
    r.show = embudoDivision(r.asistencias, r.confirmadas);
    r.cierre = embudoDivision(r.cierres, r.asistencias);
    r.costoAsistencia = embudoDivision(r.inversion, r.asistencias);
    r.cac = embudoDivision(r.inversion, r.cierres);
    return r;
  });
}
function embudoEscape(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function embudoFormato(value, type) {
  if (value == null || !Number.isFinite(value)) return '<span class="embudo-nd">n/d</span>';
  if (type === 'money') return fmtMoney(value);
  if (type === 'pct') return Math.round(value*100)+'%';
  if (type === 'ratio') return value.toFixed(2).replace('.',',');
  return String(value);
}
function setEmbudoModo(modo) {
  embudoModo = modo === 'mensual' ? 'mensual' : 'semanal';
  renderEmbudo();
}
function renderEmbudo() {
  document.querySelectorAll('[data-embudo-modo]').forEach(b => {
    const on = b.dataset.embudoModo === embudoModo;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const wrap = document.getElementById('embudo-table-wrap');
  if (embudoError) {
    wrap.innerHTML = '<p role="alert">'+embudoEscape(embudoError)+'</p>';
    return;
  }
  const weeks = RAW_ES.filter(r => inRange(r.inicio));
  const rows = embudoModo === 'mensual' ? embudoMensual(weeks) : weeks;
  if (!rows.length) { wrap.innerHTML = '<div class="no-data">Sin datos de embudo en este período</div>'; return; }
  const columns = [
    ['Inversión','inversion','money'], ['Q bookings','bookings'], ['$ Q booking','cpl','money'],
    ['QB/B','qb','ratio'], ['Agendas de venta','venta'], ['Costo por agenda de venta','costoVenta','money'],
    ['Asistencias','asistencias'], ['% asistencia','show','pct'], ['Cierres','cierres'],
    ['% cierre','cierre','pct'], ['Costo por asistencia','costoAsistencia','money'], ['CAC','cac','money'],
  ];
  wrap.innerHTML = '<table class="embudo-table"><thead><tr><th scope="col">Período</th>'
    +columns.map(([label]) => '<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'
    +rows.map(r => {
      const quiebre = r.inicio === EMBUDO_QUIEBRE;
      const periodo = r.periodo || r.inicio+' – '+r.fin;
      return '<tr'+(quiebre ? ' class="embudo-quiebre"' : '')+'><th scope="row">'+embudoEscape(periodo)
        +(quiebre ? '<span class="embudo-badge">Inicio leads GHL</span>' : '')+'</th>'
        +columns.map(([,key,type]) => '<td>'+embudoFormato(r[key],type)+'</td>').join('')+'</tr>';
    }).join('')+'</tbody></table>';
}

function showPage(id, el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  // Sincronizar ambas navegaciones (sidebar desktop + tabs móvil) por data-page
  document.querySelectorAll('.tab').forEach(t=>{
    const on = t.dataset.page === id;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.sb-item').forEach(b=> b.classList.toggle('active', b.dataset.page === id));
  document.getElementById('page-'+id).classList.add('active');
  window.scrollTo(0,0);
  if (id === 'embudo') renderEmbudo();
  if (!RAW_C.length) return;
  const s = computeStats();
  if (id === 'ventas') renderVentas(s);
  // Chart.js no puede medir canvas ocultos (quedan en 0×0 y resize() no los
  // recupera): destruir y re-crear los charts de la página recién mostrada.
  const PAGE_CHARTS = {
    overview:  ['meta','ticketTime','cash','funnel'],
    closers:   ['rates','ventasCloser','revenueShare'],
    confirmer: ['confWeek','confCloser'],
  };
  (PAGE_CHARTS[id]||[]).forEach(destroyChart);
  if (id === 'overview')  { renderOverview(s); renderCashChart(s); renderFunnelChart(s); }
  if (id === 'closers')   { renderRatesChart(s); renderVentasPorCloser(s); renderRevenueShare(s); }
  if (id === 'confirmer') { renderConfirmer(s); }
}

function toggleCloser(name) {
  document.getElementById('cc-'+name).classList.toggle('open');
}

// ═══════════════════════════════════════════════
//  LIVE FETCH
// ═══════════════════════════════════════════════
function parseCSV(text) {
  const lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim().split('\n');
  function split(line) {
    const vals=[]; let cur='',inQ=false;
    for(let i=0;i<line.length;i++) {
      const ch=line[i];
      if(ch==='"') { if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ; }
      else if(ch===','&&!inQ) { vals.push(cur.trim());cur=''; }
      else cur+=ch;
    }
    vals.push(cur.trim());
    return vals;
  }
  const headers=split(lines[0]);
  return lines.slice(1).filter(l=>l.trim()).map(line=>{
    const vals=split(line),obj={};
    headers.forEach((h,i)=>{ obj[h]=(vals[i]||'').replace(/^"|"$/g,''); });
    return obj;
  });
}
function toDate(s) {
  if(!s||s===''||s==='NaT') return null;
  s=s.trim();
  if(s.length>=10&&s[4]==='-') return s.slice(0,10);
  if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const[d,m,y]=s.split('/'); return y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0');
  }
  return null;
}
function toN(v) { const n=parseFloat(String(v||0).replace(/,/g,'.')); return isNaN(n)?0:n; }

// ── LocalStorage cache (stale-while-revalidate) ──
// El cache se muestra al instante (aunque esté vencido) y se refresca
// en background; el TTL solo decide si hace falta revalidar.
const CACHE_KEY = 'ops_dash_v1';
const CACHE_TTL = 5 * 60 * 1000;
function loadCacheEntry() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)||'null'); } catch(e) { return null; }
}
function saveCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ts:Date.now(), data})); } catch(e) {}
}

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz1oFF7dx-uNZeC-NwJuwh0QYB49EQRgy5MVjv70TNWh1CeRGDNCMz6z2ykN0yCIAw9/exec';

// fetch() con CORS en vez de JSONP: Chrome moderno bloquea el JSONP con
// ERR_BLOCKED_BY_ORB porque el Apps Script responde con Content-Type no-JS.
// El Apps Script sigue envolviendo la respuesta como cb(...), así que se
// quita el envoltorio antes de parsear — no requiere cambios server-side.
async function fetchOnce(timeoutMs) {
  const auth = '&user=' + encodeURIComponent(authUser||'') + '&token=' + encodeURIComponent(authToken||'');
  const url = APPS_SCRIPT_URL + '?callback=cb' + auth;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let text;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    text = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout');
    throw new Error(e.message && e.message.startsWith('HTTP') ? e.message : 'No se pudo cargar Apps Script');
  } finally {
    clearTimeout(timer);
  }
  // Quitar envoltorio JSONP "cb(...)" si está presente
  const m = text.match(/^\s*[\w$]+\s*\(([\s\S]*)\)\s*;?\s*$/);
  let data;
  try {
    data = JSON.parse(m ? m[1] : text);
  } catch (e) {
    throw new Error('Respuesta inválida del Apps Script');
  }
  // El Apps Script responde {error:...} cuando el token es inválido o falta
  if (data && data.error) throw new Error('AUTH');
  return data;
}

function classifyError(e) {
  // Solo AUTH indica credenciales inválidas; los demás fallos son del servicio.
  return e && e.message === 'AUTH' ? 'auth' : 'servicio';
}

async function fetchRemote({onRetry} = {}) {
  const waits = [3, 10];
  const timeouts = [45000, 60000, 90000];
  const totalAttempts = waits.length + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await fetchOnce(timeouts[attempt - 1]);
    } catch (e) {
      if (classifyError(e) === 'auth' || attempt === totalAttempts) throw e;
      const seconds = waits[attempt - 1];
      if (onRetry) onRetry(attempt, totalAttempts, seconds);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
  }
}

async function loadData(force) {
  document.getElementById('error-banner').style.display='none';

  const entry = force ? null : loadCacheEntry();
  const isFresh = entry && (Date.now() - entry.ts) < CACHE_TTL;

  if (entry) {
    // Render inmediato desde cache (aunque esté vencido); muestra su hora real
    ingest(entry.data, true, entry.ts);
    if (isFresh) return;
    // Cache vencido → revalidar en background, sin loader
    try {
      const texts = await fetchRemote();
      saveCache(texts);
      ingest(texts, false);
    } catch(e) { /* silencioso: ya hay datos en pantalla */ }
    return;
  }

  // Sin cache → loader + fetch normal
  document.getElementById('loader').style.display='flex';
  let texts;
  try {
    texts = await fetchRemote();
    saveCache(texts);
  } catch(err) {
    document.getElementById('loader').style.display='none';
    document.getElementById('error-banner').style.display='flex';
    document.getElementById('error-msg').textContent='Error: '+err.message;
    return;
  }
  ingest(texts, false);
}

function ingest(texts, fromCache, cacheTs) {
  try {

    function toDateAS(val) {
      if (!val) return null;
      if (val instanceof Date) {
        return val.getFullYear()+'-'+String(val.getMonth()+1).padStart(2,'0')+'-'+String(val.getDate()).padStart(2,'0');
      }
      if (typeof val === 'number' && val >= 20000 && val <= 60000) {
        return new Date(Date.UTC(1899,11,30) + val * 86400000).toISOString().slice(0,10);
      }
      return toDate(String(val));
    }

    RAW_MD = (texts['METRICAS_DIARIAS']||[])
      .filter(r => r['Fecha'] && r['Closer'] && r['Closer'] !== 'Closer')
      .map(r => ({
        Fecha: toDateAS(r['Fecha']), Closer: String(r['Closer']),
        Agendas: toN(r['Agendas']), Asistencias: toN(r['Asistencias']),
        Cierres: toN(r['Cierres']), Seguimientos: toN(r['Seguimientos']),
        CashCollect: toN(r['Cash Collect ($)']),
      })).filter(r => r.Fecha && r.Closer);

    RAW_CC = (texts['CALL_CONFIRMER_LOG']||[])
      .filter(r => r['Fecha'] && r['Confirmer'])
      .map(r => ({
        Fecha: toDateAS(r['Fecha']), Confirmer: String(r['Confirmer']),
        Estado: String(r['Estado']||''), Closer: String(r['Closer']||''),
      })).filter(r => r.Fecha);

    RAW_CL = (texts['CLOSER_LOG']||[])
      .filter(r => r['Fecha'] && r['Closer'] && r['Closer'] !== 'Closer')
      .map(r => ({
        Fecha: toDateAS(r['Fecha']), Closer: String(r['Closer']),
        Evento: String(r['Evento']||''),
      })).filter(r => r.Fecha && r.Closer);

    RAW_V = (texts['VENTAS']||[])
      .filter(r => r['Cliente'] && r['Venta ($)'])
      .map(r => ({
        Cliente: String(r['Cliente']),
        'Fecha Cierre': toDateAS(r['Fecha Cierre']),
        Closer: String(r['Closer']), Plan: String(r['Plan']),
        Venta: toN(r['Venta ($)']), Cobrado: toN(r['Cobrado ($)']),
        Pendiente: toN(r['PDTE PAGO ($)']),
        Tipo: String(r['Tipo']||''),
      })).filter(r => r['Fecha Cierre'] && r.Venta > 0);

    RAW_C = (texts['COBROS_DIARIOS']||[])
      .filter(r => r['Fecha Pago'] && r['Monto Pagado'])
      .map(r => ({
        Fecha: toDateAS(r['Fecha Pago']), Closer: String(r['Closer']),
        Monto: toN(r['Monto Pagado']),
        ComCloser: toN(r['Comisión Closer']),
        ComConf: toN(r['Comisión Confirmer']),
        Tipo: String(r['Tipo']||'CxC'),
      })).filter(r => r.Fecha && r.Monto > 0);

    RAW_PC = (texts['PLAN_CUOTAS']||[])
      .filter(r => r['Fecha Vencimiento'])
      .map(r => ({
        FechaVenc: toDateAS(r['Fecha Vencimiento']),
        Closer: String(r['Closer']),
        Monto: toN(r['Por Pagar']),
        Estado: String(r['Estado']||''),
        LeadMail: String(r['Lead Mail']||''),
      })).filter(r => r.FechaVenc && r.Monto > 0);

    RAW_MDIA = parseMetaDiario(texts['META_DIARIO'] || []);
    RAW_ES = [];
    embudoError = '';
    try { RAW_ES = parseEmbudo(texts['EMBUDO_SEMANAL'] || []); }
    catch (err) { embudoError = err.message; }

    const allDates=[...RAW_MD,...RAW_CC,...RAW_CL,...RAW_C].map(r=>r.Fecha)
      .concat(RAW_V.map(r=>r['Fecha Cierre']))
      .filter(d=>d && d >= '2020-01-01' && d <= '2035-12-31').sort();
    DATA_FLOOR=allDates[0]||''; DATA_CEIL=allDates[allDates.length-1]||'';
    // Si el usuario no fijó un rango, seguir el máximo de los datos (extiende a
    // los días nuevos que llegan en la revalidación SWR). Si filtró, se respeta.
    if(allDates.length && !userFiltered) {
      dateFrom=DATA_FLOOR; dateTo=DATA_CEIL;
      document.getElementById('date-from').value=dateFrom;
      document.getElementById('date-to').value=dateTo;
    }
    document.getElementById('loader').style.display='none';
    // Si viene de caché, mostrar la hora real en que se guardó (no la actual)
    const stamp = (fromCache && cacheTs) ? new Date(cacheTs) : new Date();
    const timeStr = stamp.toLocaleDateString('es-CL')+' '+stamp.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
    document.getElementById('last-updated').textContent = (fromCache ? '⚡ Caché: ' : 'Actualizado: ') + timeStr;
    buildMonthPresets();
    renderAll();
  } catch(err) {
    document.getElementById('loader').style.display='none';
    document.getElementById('error-banner').style.display='flex';
    document.getElementById('error-msg').textContent='Error al procesar datos: '+err.message;
  }
}

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
//  DARK MODE
// ═══════════════════════════════════════════════
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next   = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ops_theme', next);
  applyChartTheme();
  // Redraw charts with new colors
  if (RAW_MD.length) renderAll();
}

// Inicializar tema guardado (antes de que carguen los datos, para evitar flash)
(function initTheme() {
  const saved = localStorage.getItem('ops_theme');
  // Detectar preferencia del sistema si no hay guardado
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  applyChartTheme();
})();

// ═══════════════════════════════════════════════
//  AUTH FLOW
// ═══════════════════════════════════════════════
async function doLogin(e) {
  e.preventDefault();
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  const originalButtonText = btn.textContent;
  authUser = u; authToken = p;
  btn.disabled = true; btn.textContent = 'Verificando…'; err.textContent = '';
  try {
    const texts = await fetchRemote({
      onRetry(attempt, total, seconds) {
        btn.textContent = `Reintentando… (${attempt + 1} de ${total})`;
        err.textContent = `El servicio tarda en responder. Intento ${attempt + 1} de ${total} en ${seconds} segundos.`;
      }
    });
    err.textContent = '';
    sessionStorage.setItem('ops_auth', JSON.stringify({u, p}));
    saveCache(texts);
    document.getElementById('login-gate').style.display = 'none';
    ingest(texts, false);
  } catch (ex) {
    authUser = null; authToken = null;
    err.textContent = classifyError(ex) === 'auth'
      ? 'Usuario o contraseña incorrectos'
      : 'El servicio de Google no está disponible en este momento. Suele ser un problema temporal. Intenta de nuevo en un par de minutos.';
  } finally {
    btn.disabled = false; btn.textContent = originalButtonText;
  }
  return false;
}

function logout() {
  sessionStorage.removeItem('ops_auth');
  location.reload();
}

// Bootstrap: si hay sesión activa, entrar directo; si no, mostrar el gate.
(function initAuth() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('ops_auth') || 'null'); } catch (e) {}
  if (saved && saved.p) {
    authUser = saved.u; authToken = saved.p;
    document.getElementById('login-gate').style.display = 'none';
    loadData();   // usa caché + revalida con el token de sesión
  } else {
    document.getElementById('login-user').focus();
  }
})();
