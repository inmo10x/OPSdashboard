import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// La ruta opcional permite verificar mutaciones sin modificar app.js.
const source = readFileSync(process.argv[2] || new URL('../app.js', import.meta.url), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `No se encontró ${start}`);
  return source.slice(from, to);
}
const elements = {};
let core;
const c = vm.createContext({
  document: {getElementById: id => elements[id] ||= {}},
  computeCoreStats: () => core, inRange: () => true, esAsistencia: r => r.Asistio,
  GOLD: 'gold', GREEN: 'green'
});
vm.runInContext(extract('const META_MENSUAL_USD', '//  RAW DATA')
  + extract('function weekOf(', '//  CHART INSTANCES')
  + extract('function computeStats(', '//  RENDER ALL')
  + extract('function renderClosers(', 'const TARGET_SHOW')
  + extract('function renderRangeLabel(', 'function renderStrip(')
  + extract('function embudoFormato(', 'function setEmbudoModo('), c);

function render(rows) {
  core = {md:[],cl:[],cc:[],co:[],v:[]};
  for (const [Closer, d] of Object.entries(rows)) {
    const Fecha = '2026-07-06';
    if (d.ag+d.as+d.ci || !d.cash) core.md.push({Closer,Fecha,Agendas:d.ag,Asistencias:d.as,Cierres:d.ci,Seguimientos:0});
    for (let i=0;i<d.ag;i++) core.cc.push({Closer,Fecha,Estado:'Confirmado'});
    for (let i=0;i<d.as;i++) core.cl.push({Closer,Fecha,Asistio:true});
    if (d.cash) core.co.push({Closer,Fecha,Monto:d.cash});
  }
  const stats = c.computeStats();
  c.renderClosers(stats);
  const html = elements['closer-list'].innerHTML;
  return [...html.matchAll(/<div class="ccard" id="cc-([^"]+)">([\s\S]*?)(?=<div class="ccard" id=|$)/g)]
    .map(([,name,html]) => ({name,html,badge:html.match(/class="cbadge ([^"]+)">([^<]+)/)}));
}
function verify(rows) {
  const cards = render(rows);
  const visible = Object.keys(rows).filter(name => {
    const d = rows[name]; return d.ag+d.as+d.ci!==0 || d.cash!==0;
  });
  const sorted = visible.sort((a,b)=>rows[b].cash-rows[a].cash);
  assert.deepEqual(cards.map(r=>r.name), sorted, 'Visibilidad y orden por cash');
  const leader = sorted.find(name=>rows[name].cash>0);
  for (const card of cards) {
    const d = rows[card.name];
    const conversion = d.as>=10 && d.ci===0;
    const low = d.ag<6;
    const expected = card.name===leader ? ['b-gold','Líder']
      : conversion ? ['b-red','Sin cierres'] : low ? ['b-grey','Baja actividad'] : null;
    assert.deepEqual(card.badge ? card.badge.slice(1) : null, expected, `Badge de ${card.name}`);
    assert.equal(card.html.includes('Alerta Conversión'), conversion, `Conversión de ${card.name}`);
    assert.equal(card.html.includes('pero 0 cierres'), conversion, `Texto de conversión de ${card.name}`);
    if (conversion) assert.ok(card.html.includes(`Show rate ${(d.ag ? Math.round(d.as/d.ag*100) : 0)}%`), 'Show rate real');
    assert.equal(card.html.includes('Actividad muy baja'), low, `Actividad de ${card.name}`);
    if (low) assert.ok(card.html.includes(`(${d.ag} agendas)`));
    assert.match(card.html, /class="cav cav-[ISKG]"/, `Avatar de ${card.name}`);
    assert.ok(card.html.includes(c.fmtMoney(d.cash)), 'Cash real visible');
  }
  assert.equal(cards.filter(r=>r.badge?.[2]==='Líder').length, leader ? 1 : 0);
  return cards;
}
const scenarios = [
  ['datos reales, cobros sin llamadas, ocultación y avatares nuevos', () => {
    verify({
      Sebastian:{ag:69,as:62,ci:7,cash:19419},
      Guillermo:{ag:48,as:48,ci:0,cash:0},
      Karim:{ag:318,as:239,ci:31,cash:81559},
      Nury:{ag:0,as:0,ci:0,cash:21343},
      Alexandra:{ag:0,as:0,ci:0,cash:4285},
      Ignacio:{ag:100,as:80,ci:40,cash:100000},
      SinDatos:{ag:0,as:0,ci:0,cash:0}
    });
  }],
  ['umbrales, prioridad y reglas independientes del nombre', () => {
    for (const ag of [0,5,6,20]) for (const as of [0,2,9,10,11]) for (const ci of [0,1,7]) {
      verify({Nuevo:{ag,as,ci,cash:0}});
    }
    verify({Otro:{ag:5,as:10,ci:0,cash:200}, Mayor:{ag:0,as:0,ci:0,cash:300}});
    verify({EmpateA:{ag:6,as:10,ci:1,cash:100}, EmpateB:{ag:6,as:10,ci:1,cash:100}});
    verify({Sebastian:{ag:69,as:62,ci:7,cash:0}, Guillermo:{ag:48,as:48,ci:0,cash:0}});
  }],
  ['avatares estables y paleta con más de cuatro personas', () => {
    const rows = Object.fromEntries(['A','B','C','D','E','F'].map((name,i)=>[name,{ag:6,as:2,ci:1,cash:i+1}]));
    const before = verify(rows);
    rows.A.cash=100;
    const after = verify(rows);
    for (const card of before) assert.equal(card.html.match(/class="cav ([^"]+)"/)[1],
      after.find(r=>r.name===card.name).html.match(/class="cav ([^"]+)"/)[1]);
  }],
  ['fechas DD/MM, rango compartido y dólares completos', () => {
    assert.equal(c.fmtDate('2026-07-06'),'06/07');
    c.dateFrom='2026-07-06'; c.dateTo='2026-07-12'; c.renderRangeLabel();
    assert.ok(Object.values(elements).some(el=>el.textContent?.includes('06/07') && el.textContent?.includes('12/07')));
    for (const [input, expected] of [[4477.72,'$4.478'],[4458.19,'$4.458'],[2204.25,'$2.204'],[2172.91,'$2.173'],[0,'$0'],[999.5,'$1.000']]) {
      assert.equal(c.fmtMoneyFull(input),expected);
      assert.equal(c.embudoFormato(input,'money'),expected);
    }
    assert.notEqual(c.fmtMoneyFull(4477.72),c.fmtMoneyFull(4458.19));
    assert.equal(c.fmtMoney(4477.72),'$4.5K', 'KPI abreviado conservado');
    assert.equal(c.escapeHTML('&<>"\''),'&amp;&lt;&gt;&quot;&#39;');
  }]
];
for (const [name, run] of scenarios) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack}`); process.exitCode = 1; }
}
