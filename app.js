// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
// Meta mensual de cash del equipo (USD) — para "Meta vs. realizado"
const META_MENSUAL_USD = 40000;

// ═══════════════════════════════════════════════
//  RAW DATA
// ═══════════════════════════════════════════════
let RAW_MD = [], RAW_CC = [], RAW_V = [], RAW_C = [], RAW_CL = [], RAW_PC = [];

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
  const all=[...RAW_MD,...RAW_CC,...RAW_C].map(r=>r.Fecha).filter(Boolean).sort();
  const minD=all[0]||'', maxD=all[all.length-1]||'';
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
  if (!dateFrom || !dateTo) return null;
  const d1 = new Date(dateFrom + 'T12:00:00'), d2 = new Date(dateTo + 'T12:00:00');
  const duration = Math.round((d2 - d1) / 86400000);
  const prevTo   = new Date(d1); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - duration);
  const pFrom = prevFrom.toISOString().slice(0,10);
  const pTo   = prevTo.toISOString().slice(0,10);

  const s = computeCoreStats(d => d && d >= pFrom && d <= pTo);
  return { ...s, sr: pct(s.totAs, s.totAg), cr: pct(s.totNuevas, s.totAs) };
}

// delta para valores absolutos → muestra % de cambio
function delta(curr, prev) {
  if (typeof prev !== 'number') return '';
  if (prev === 0) return curr > 0 ? '<span class="kpi-delta up">▲ nuevo</span>' : '';
  const d = Math.round((curr - prev) / Math.abs(prev) * 100);
  if (Math.abs(d) < 1) return '<span class="kpi-delta flat">→ sin cambio</span>';
  const cls = d > 0 ? 'up' : 'down', arrow = d > 0 ? '▲' : '▼';
  return `<span class="kpi-delta ${cls}">${arrow} ${Math.abs(d)}% vs ant.</span>`;
}

// delta para tasas/porcentajes → muestra diferencia en pp
function deltaP(curr, prev) {
  if (typeof prev !== 'number') return '';
  const d = curr - prev;
  if (Math.abs(d) < 1) return '<span class="kpi-delta flat">→ igual</span>';
  const cls = d > 0 ? 'up' : 'down', arrow = d > 0 ? '▲' : '▼';
  return `<span class="kpi-delta ${cls}">${arrow} ${Math.abs(d)}pp vs ant.</span>`;
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
  if(document.getElementById('page-bonos').classList.contains('active')) renderBonos(s);
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
  if (p) {
    document.getElementById('k-ventas-delta').innerHTML     = delta(s.totNuevas, p.totNuevas);
    document.getElementById('k-renov-delta').innerHTML      = delta(s.totRenov,  p.totRenov);
    document.getElementById('k-agendas-delta').innerHTML    = delta(s.totAg,     p.totAg);
    document.getElementById('k-show-delta').innerHTML       = deltaP(sr,         p.sr);
    document.getElementById('k-close-delta').innerHTML      = deltaP(cr,         p.cr);
  }
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
  const dHTML = (curr, prev, fmt) => {
    if (!p || typeof prev !== 'number' || prev === 0) return '<span class="ov-kpi-delta up">▲ nuevo <span class="vs">vs. período anterior</span></span>';
    const d = Math.round((curr-prev)/Math.abs(prev)*100);
    const up = d >= 0;
    return `<span class="ov-kpi-delta ${up?'up':'down'}">${up?'▲':'▼'} ${Math.abs(d)}% <span class="vs">vs. período anterior</span></span>`;
  };
  const cards = [
    {lbl:'Cash Collected',  val:fmtMoney(s.totCash),  delta:dHTML(s.totCash,  p&&p.totCash),  spark:wCash},
    {lbl:'Ventas Totales',  val:fmtMoney(s.totVenta), delta:dHTML(s.totVenta, p&&p.totVenta), spark:wVenta},
    {lbl:'Ticket Prom.',    val:fmtMoney(s.ticket),   delta:dHTML(s.ticket,   p&&p.ticket),   spark:wTicket},
    {lbl:'AOV',             val:fmtMoney(s.aov),      delta:dHTML(s.aov,      p&&p.aov),      spark:wAOV},
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
  const MNAMES_C = {'01':'Ene','02':'Feb','03':'Mar','04':'Abr','05':'May','06':'Jun','07':'Jul','08':'Ago','09':'Sep','10':'Oct','11':'Nov','12':'Dic'};
  const SIN = ['Guillermo'];
  const cCol = {Ignacio:'var(--gold-deep)', Sebastian:'var(--blue)', Karim:'var(--green)'};

  // Totals per closer and confirmer
  const comC = {};
  s.co.forEach(r => {
    if (SIN.includes(r.Closer)) return;
    comC[r.Closer] = (comC[r.Closer]||0) + (r.ComCloser||0);
  });
  const totConf = s.co.reduce((acc,r)=>acc+(r.ComConf||0), 0);
  const comRows = Object.entries(comC).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const totComC = comRows.reduce((acc,[,v])=>acc+v, 0);

  // Monthly breakdown: Ignacio, Sebastian, Claudia
  const monthlyMap = {};
  s.co.forEach(r => {
    if (!r.Fecha) return;
    const ym = r.Fecha.slice(0,7);
    if (!monthlyMap[ym]) monthlyMap[ym] = {Ignacio:0, Sebastian:0, Claudia:0};
    if (!SIN.includes(r.Closer) && r.ComCloser > 0) {
      if (r.Closer === 'Ignacio')   monthlyMap[ym].Ignacio   += r.ComCloser;
      if (r.Closer === 'Sebastian') monthlyMap[ym].Sebastian += r.ComCloser;
    }
    if (r.ComConf > 0) monthlyMap[ym].Claudia += r.ComConf;
  });
  const monthKeys = Object.keys(monthlyMap).sort();
  const totI  = monthKeys.reduce((a,m)=>a+monthlyMap[m].Ignacio,0);
  const totSe = monthKeys.reduce((a,m)=>a+monthlyMap[m].Sebastian,0);
  const totCl = monthKeys.reduce((a,m)=>a+monthlyMap[m].Claudia,0);

  const monthTableRows = monthKeys.map(ym => {
    const mn = MNAMES_C[ym.slice(5,7)] + ' ' + ym.slice(0,4);
    const d = monthlyMap[ym];
    const rowTot = d.Ignacio + d.Sebastian + d.Claudia;
    return '<tr>'
      +'<td style="padding:9px 10px;font-size:.68rem;color:var(--g2);font-weight:500;border-bottom:1px solid var(--border);">'+mn+'</td>'
      +'<td style="padding:9px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:600;font-size:.82rem;color:var(--gold-deep);border-bottom:1px solid var(--border);">'+(d.Ignacio>0?fmtMoney(d.Ignacio):'—')+'</td>'
      +'<td style="padding:9px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:600;font-size:.82rem;color:var(--blue);border-bottom:1px solid var(--border);">'+(d.Sebastian>0?fmtMoney(d.Sebastian):'—')+'</td>'
      +'<td style="padding:9px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:600;font-size:.82rem;color:var(--green);border-bottom:1px solid var(--border);">'+(d.Claudia>0?fmtMoney(d.Claudia):'—')+'</td>'
      +'<td style="padding:9px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:.82rem;color:var(--g1);border-bottom:1px solid var(--border);">'+fmtMoney(rowTot)+'</td>'
      +'</tr>';
  }).join('');

  const cEl = document.getElementById('comisiones-wrap');
  if (cEl) {
    cEl.innerHTML =
      // ── MONTHLY BREAKDOWN TABLE ──
      '<div style="background:var(--white);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);margin-bottom:14px;">'
      +'<div style="padding:11px 14px;background:var(--g1);display:flex;align-items:center;gap:8px;">'
      +'<span style="font-family:\'Jost\',sans-serif;font-weight:700;font-size:.88rem;color:#fff;">Desglose Mensual</span>'
      +'<span style="font-size:.58rem;color:var(--g4);text-transform:uppercase;letter-spacing:.07em;margin-left:auto;">USD</span>'
      +'</div>'
      +'<div style="overflow-x:auto;">'
      +'<table style="width:100%;border-collapse:collapse;">'
      +'<thead><tr style="background:var(--bg);">'
      +'<th style="padding:8px 10px;text-align:left;font-size:.57rem;color:var(--g4);text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">Mes</th>'
      +'<th style="padding:8px 10px;text-align:right;font-size:.57rem;color:var(--gold-deep);text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">Ignacio</th>'
      +'<th style="padding:8px 10px;text-align:right;font-size:.57rem;color:var(--blue);text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">Sebastian</th>'
      +'<th style="padding:8px 10px;text-align:right;font-size:.57rem;color:var(--green);text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">Claudia</th>'
      +'<th style="padding:8px 10px;text-align:right;font-size:.57rem;color:var(--g3);text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--border2);">Total</th>'
      +'</tr></thead>'
      +'<tbody>'+monthTableRows+'</tbody>'
      +'<tfoot><tr style="background:var(--bg);">'
      +'<td style="padding:10px 10px;font-size:.65rem;font-weight:700;color:var(--g1);text-transform:uppercase;letter-spacing:.05em;">TOTAL</td>'
      +'<td style="padding:10px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:.95rem;color:var(--gold-deep);">'+fmtMoney(totI)+'</td>'
      +'<td style="padding:10px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:.95rem;color:var(--blue);">'+fmtMoney(totSe)+'</td>'
      +'<td style="padding:10px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:.95rem;color:var(--green);">'+fmtMoney(totCl)+'</td>'
      +'<td style="padding:10px 10px;text-align:right;font-family:\'Jost\',sans-serif;font-weight:700;font-size:1rem;color:var(--g1);">'+fmtMoney(totI+totSe+totCl)+'</td>'
      +'</tr></tfoot>'
      +'</table>'
      +'</div></div>'

      // ── CLOSER CARDS ──
      +'<div style="background:var(--white);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);margin-bottom:10px;">'
      +'<div style="padding:9px 14px;background:var(--bg);border-bottom:1px solid var(--border);font-size:.6rem;font-weight:600;color:var(--g3);text-transform:uppercase;letter-spacing:.07em;">Closers</div>'
      + comRows.map(([c,v]) =>
          '<div style="display:flex;align-items:center;padding:11px 14px;border-bottom:1px solid var(--border);gap:12px;">'
          +'<div style="width:32px;height:32px;border-radius:50%;background:var(--gold-pale);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;color:'+(cCol[c]||'var(--g2)')+';">'+c[0]+'</div>'
          +'<div style="flex:1;font-size:.72rem;font-weight:500;color:var(--g1);">'+c+'</div>'
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
      +'<div style="flex:1;font-size:.72rem;font-weight:500;color:var(--g1);">Claudia</div>'
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
//  BONOS
// ═══════════════════════════════════════════════
function renderBonos(s) {
  const MNAMES_B = {'01':'Ene','02':'Feb','03':'Mar','04':'Abr','05':'May','06':'Jun','07':'Jul','08':'Ago','09':'Sep','10':'Oct','11':'Nov','12':'Dic'};
  const BONO_CLOSERS = ['Ignacio','Sebastian','Karim'];
  const cColB = {Ignacio:'var(--gold-deep)', Sebastian:'var(--blue)', Karim:'var(--green)'};
  const cavCls = {Ignacio:'cav-I', Sebastian:'cav-S', Karim:'cav-K'};

  // All months present in filtered data
  const allMonths = [...new Set([
    ...s.co.map(r => r.Fecha ? r.Fecha.slice(0,7) : null),
    ...s.v.map(r => r['Fecha Cierre'] ? r['Fecha Cierre'].slice(0,7) : null)
  ].filter(Boolean))].sort();

  let html = '';

  BONO_CLOSERS.forEach(closer => {
    const hasActivity = s.co.some(r=>r.Closer===closer) || s.v.some(r=>r.Closer===closer);
    if (!hasActivity) return;

    let monthsHtml = '';
    let totContado=0, totVolumen=0, totCantidad=0;

    allMonths.forEach(ym => {
      const mn = MNAMES_B[ym.slice(5,7)] + ' ' + ym.slice(0,4);

      // Cash cobrado en el mes por este closer
      const cashMes = s.co.filter(r=>r.Closer===closer && r.Fecha && r.Fecha.slice(0,7)===ym)
                          .reduce((a,r)=>a+r.Monto, 0);

      // Ventas cerradas en el mes con al menos algún cobro · solo clientes nuevos (Bono cantidad)
      const ventasCerradas = s.v.filter(r=>
        r.Closer===closer &&
        r['Fecha Cierre'] && r['Fecha Cierre'].slice(0,7)===ym &&
        r.Cobrado > 0 &&
        !r.Tipo.toLowerCase().includes('renov')
      ).length;

      // Ventas pagadas 100% al contado · clientes nuevos únicamente (Bono pago contado)
      // Se excluyen renovaciones según columna Notas de la hoja VENTAS
      const ventasContado = s.v.filter(r=>
        r.Closer===closer &&
        r['Fecha Cierre'] && r['Fecha Cierre'].slice(0,7)===ym &&
        r.Pendiente <= 0.01 && r.Cobrado > 0 &&
        !r.Tipo.toLowerCase().includes('renov')
      ).length;

      // Bono 1: pago completo al contado · $30 c/u
      const bonoContado  = ventasContado * 30;
      // Bono 2: volumen · $250 por tramo de $15K
      const tramosVol    = Math.floor(cashMes / 15000);
      const bonoVolumen  = tramosVol * 250;
      // Bono 3: cantidad · $500 por cada 10 ventas cerradas y cobradas
      const tramosVta    = Math.floor(ventasCerradas / 10);
      const bonoCantidad = tramosVta * 500;
      const mesBono      = bonoContado + bonoVolumen + bonoCantidad;

      totContado  += bonoContado;
      totVolumen  += bonoVolumen;
      totCantidad += bonoCantidad;

      if (cashMes===0 && ventasCerradas===0) return;

      const fColor = col => mesBono>0 ? col : 'var(--g4)';
      monthsHtml += `
        <div style="border-bottom:1px solid var(--border);padding:12px 14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="font-family:'Jost',sans-serif;font-weight:600;font-size:.82rem;color:var(--g1);">${mn}</span>
            <span style="font-family:'Jost',sans-serif;font-weight:700;font-size:1rem;color:${mesBono>0?cColB[closer]:'var(--g4)'};">${mesBono>0?'$'+Math.round(mesBono):'Sin bono'}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            <div style="background:var(--bg);border-radius:6px;padding:9px 10px;text-align:center;">
              <div style="font-size:.54rem;color:var(--g4);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;">Pago Contado</div>
              <div style="font-family:'Jost',sans-serif;font-weight:700;font-size:1.05rem;color:${bonoContado>0?'var(--green)':'var(--g4)'};">${bonoContado>0?'+$'+bonoContado:'—'}</div>
              <div style="font-size:.54rem;color:var(--g4);margin-top:2px;">${ventasContado} venta${ventasContado!==1?'s':''} × $30</div>
            </div>
            <div style="background:var(--bg);border-radius:6px;padding:9px 10px;text-align:center;">
              <div style="font-size:.54rem;color:var(--g4);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;">Volumen</div>
              <div style="font-family:'Jost',sans-serif;font-weight:700;font-size:1.05rem;color:${bonoVolumen>0?'var(--gold-deep)':'var(--g4)'};">${bonoVolumen>0?'+$'+bonoVolumen:'—'}</div>
              <div style="font-size:.54rem;color:var(--g4);margin-top:2px;">${tramosVol} tramo${tramosVol!==1?'s':''} × $15K</div>
            </div>
            <div style="background:var(--bg);border-radius:6px;padding:9px 10px;text-align:center;">
              <div style="font-size:.54rem;color:var(--g4);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;">Cant. Ventas</div>
              <div style="font-family:'Jost',sans-serif;font-weight:700;font-size:1.05rem;color:${bonoCantidad>0?'var(--blue)':'var(--g4)'};">${bonoCantidad>0?'+$'+bonoCantidad:'—'}</div>
              <div style="font-size:.54rem;color:var(--g4);margin-top:2px;">${ventasCerradas} venta${ventasCerradas!==1?'s':''} · ${tramosVta} × 10</div>
            </div>
          </div>
        </div>`;
    });

    const grandTotal = totContado + totVolumen + totCantidad;

    html += `
    <div style="background:var(--white);border:1px solid var(--border);border-radius:var(--r2);box-shadow:var(--sh);margin:0 16px 14px;overflow:hidden;">
      <div style="background:var(--g1);padding:14px;display:flex;align-items:center;gap:12px;">
        <div class="cav ${cavCls[closer]}" style="width:40px;height:40px;font-size:1.1rem;">${closer[0]}</div>
        <div style="flex:1;">
          <div style="font-family:'Jost',sans-serif;font-weight:700;font-size:1rem;color:#fff;">${closer}</div>
          <div style="font-size:.58rem;color:var(--g4);text-transform:uppercase;letter-spacing:.07em;">Closer</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:'Jost',sans-serif;font-weight:700;font-size:1.6rem;color:${grandTotal>0?'var(--gold-l)':'var(--g4)'};">${grandTotal>0?'$'+Math.round(grandTotal):'$0'}</div>
          <div style="font-size:.54rem;color:var(--g4);">Total bonos período</div>
        </div>
      </div>
      ${monthsHtml || '<div style="padding:20px;text-align:center;font-size:.7rem;color:var(--g4);">Sin actividad en el período</div>'}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);border-top:2px solid var(--border2);background:var(--bg);">
        <div style="padding:10px 8px;text-align:center;border-right:1px solid var(--border);">
          <div style="font-size:.52rem;color:var(--g4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Pago Contado</div>
          <div style="font-family:'Jost',sans-serif;font-weight:700;font-size:.95rem;color:${totContado>0?'var(--green)':'var(--g4)'};">${totContado>0?'$'+Math.round(totContado):'$0'}</div>
        </div>
        <div style="padding:10px 8px;text-align:center;border-right:1px solid var(--border);">
          <div style="font-size:.52rem;color:var(--g4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Volumen</div>
          <div style="font-family:'Jost',sans-serif;font-weight:700;font-size:.95rem;color:${totVolumen>0?'var(--gold-deep)':'var(--g4)'};">${totVolumen>0?'$'+Math.round(totVolumen):'$0'}</div>
        </div>
        <div style="padding:10px 8px;text-align:center;">
          <div style="font-size:.52rem;color:var(--g4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Cant. Ventas</div>
          <div style="font-family:'Jost',sans-serif;font-weight:700;font-size:.95rem;color:${totCantidad>0?'var(--blue)':'var(--g4)'};">${totCantidad>0?'$'+Math.round(totCantidad):'$0'}</div>
        </div>
      </div>
      <div style="margin:12px 14px;padding:10px 13px;border-left:3px solid var(--g5);background:var(--bg);border-radius:0 6px 6px 0;">
        <div style="font-size:.57rem;font-weight:600;color:var(--g3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">⚙ Excelencia Operativa · Discrecional</div>
        <div style="font-size:.64rem;color:var(--g3);line-height:1.5;">USD 150 si cumple 100% reportabilidad diaria, CRM completo y 0 reclamos formales. Requiere validación manual del período.</div>
      </div>
    </div>`;
  });

  document.getElementById('bonos-list').innerHTML = html || '<div class="no-data"><span>🏆</span>Sin datos para calcular bonos</div>';
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
  if (id === 'ventas' && RAW_C.length) { const s = computeStats(); renderVentas(s); }
  if (id === 'bonos'  && RAW_C.length) { const s = computeStats(); renderBonos(s); }
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

async function fetchRemote() {
  // El Apps Script puede tardar 20-40s en frío o dar 404 transitorio por
  // cuota; un reintento con backoff evita el "Reintentar" manual del usuario.
  try {
    return await fetchOnce(60000);
  } catch (e) {
    if (e.message === 'AUTH') throw e;   // credenciales malas: no reintentar
    await new Promise(r => setTimeout(r, 3000));
    return await fetchOnce(60000);
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

    const allDates=[...RAW_MD,...RAW_CC,...RAW_C].map(r=>r.Fecha).filter(Boolean).sort();
    // Si el usuario no fijó un rango, seguir el máximo de los datos (extiende a
    // los días nuevos que llegan en la revalidación SWR). Si filtró, se respeta.
    if(allDates.length && !userFiltered) {
      dateFrom=allDates[0]; dateTo=allDates[allDates.length-1];
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
  authUser = u; authToken = p;
  btn.disabled = true; btn.textContent = 'Verificando…'; err.textContent = '';
  try {
    const texts = await fetchRemote();        // valida credenciales contra el Apps Script
    sessionStorage.setItem('ops_auth', JSON.stringify({u, p}));
    saveCache(texts);
    document.getElementById('login-gate').style.display = 'none';
    ingest(texts, false);
  } catch (ex) {
    authUser = null; authToken = null;
    err.textContent = ex.message === 'AUTH'
      ? 'Usuario o contraseña incorrectos'
      : 'Error de conexión: ' + ex.message;
    btn.disabled = false; btn.textContent = 'Entrar';
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
