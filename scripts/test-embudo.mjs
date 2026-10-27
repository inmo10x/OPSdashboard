import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `No se encontró ${start}`);
  return source.slice(from, to);
}
const elements = {};
const c = vm.createContext({
  RAW_ES: [], RAW_MDIA: [], dateFrom: '', dateTo: '',
  document: { querySelectorAll: () => [], getElementById: id => elements[id] ||= {} },
  // Ninguna fecha de la hoja debe convertirse a Date, ni siquiera en otra zona horaria.
  Date: class {
    constructor(...args) { if (args.length) throw new Error('Conversión de fecha prohibida'); }
    toISOString() { return '2026-10-27T00:00:00.000Z'; }
  }
});
vm.runInContext(extract('const EMBUDO_QUIEBRE =', 'function showPage(')
  + extract('function inRange(', 'function weekOf(')
  + extract('function fmtDate(', 'function pct('), c);
const leadKey = 'Leads (definición reescrita)';
function row(inicio = '2026-08-03', overrides = {}) {
  return {
    'Semana inicio (lun)': inicio+'T07:00:00.000Z', 'Semana fin (dom)': '2026-08-09T08:00:00.000Z',
    Mes: 8, 'Inversión Meta (USD)': 12, [leadKey]: 3, Agendas: 6,
    'Agendas de venta (CRM)': 2, 'Citas confirmadas': 2,
    'Reuniones realizadas (1ª con cada lead)': 1, 'Cierres nuevos': 1,
    'CPL (USD)': 4.123456, 'Costo por agenda de venta (USD)': 6.123456,
    '% show (realizadas/confirmadas)': 0.51, '% cierre (cierres/realizadas)': 0.91,
    'Costo por reunión': 12.123456, 'CAC (USD)': 12.654321, ...overrides
  };
}
const parse = rows => c.parseEmbudo(rows);
const nd = value => {
  const html = c.embudoFormato(value, 'ratio');
  assert.match(html, />n\/d</);
  assert.doesNotMatch(html, /NaN|Infinity/);
};
const scenarios = [
  ['fechas por corte, verano e invierno; META_DIARIO conservado', () => {
    const rows = parse([row('2026-08-03'), row('2026-01-05', {'Semana inicio (lun)': '2026-01-05T08:00:00.000Z'})]);
    assert.equal(rows[0].inicio, '2026-01-05'); assert.equal(rows[1].inicio, '2026-08-03');
    assert.equal(rows[1].fin, '2026-08-09');
    const md = c.parseMetaDiario([{Fecha:'2026-01-05T08:00:00.000Z', 'Inversión Meta (USD)':'', 'Leads (GHL)':0, Fuente:'manual', Nota:'nota', 'Agendas de venta (CRM)':2}])[0];
    assert.equal(md.Fecha, '2026-01-05'); assert.equal(md.Inversion, null);
    assert.equal(md.Leads, 0); assert.equal(md.AgendasVenta, 2);
    assert.equal(md.Fuente, 'manual'); assert.equal(md.Nota, 'nota');
  }],
  ['placeholders pasados y futuros descartados; datos y ceros preservados', () => {
    const empty = {'Inversión Meta (USD)':'', Agendas:5, [leadKey]:'', 'Agendas de venta (CRM)':''};
    for (const fecha of ['2025-12-29', '2026-11-02']) {
      assert.equal(parse([row(fecha, empty)]).length, 0);
      for (const key of ['Inversión Meta (USD)', leadKey, 'Agendas de venta (CRM)']) {
        for (const value of [0,1]) {
          assert.equal(parse([row(fecha, {...empty, [key]:value})]).length, 1);
        }
      }
    }
    const r = parse([row('2026-08-03', {'Inversión Meta (USD)':'', [leadKey]:'', 'CPL (USD)':'', 'CAC (USD)':0})])[0];
    assert.equal(r.inversion, null); assert.equal(r.bookings, null); assert.equal(r.cpl, null);
    assert.equal(r.cac, 0); nd(r.cpl); assert.equal(c.embudoFormato(r.cac,'money'), '$0');
  }],
  ['placeholder de diciembre no anula enero al ampliar el rango', () => {
    const placeholder = row('2025-12-29', {Mes:1, 'Inversión Meta (USD)':'', [leadKey]:'', 'Agendas de venta (CRM)':''});
    const real = row('2026-01-05', {Mes:1});
    const weeks = parse([placeholder, real]);
    const monthly = c.embudoMensual(weeks);
    assert.equal(monthly.length,1);
    assert.equal(monthly[0].periodo,'2026-01');
    assert.equal(monthly[0].inversion,12); assert.equal(monthly[0].bookings,3);
    assert.equal(monthly[0].cpl,4); assert.equal(monthly[0].costoVenta,6);
    assert.equal(monthly[0].costoAsistencia,12); assert.equal(monthly[0].cac,12);
  }],
  ['semanal conserva precisión y razones originales, salvo QB/B', () => {
    const r = parse([row()])[0];
    for (const [key, value] of Object.entries({cpl:4.123456,costoVenta:6.123456,show:0.51,cierre:0.91,costoAsistencia:12.123456,cac:12.654321,qb:0.5})) assert.equal(r[key], value);
    assert.equal(c.embudoFormato(r.qb,'ratio'), '0,50');
    assert.equal(c.embudoFormato(r.show,'pct'), '51%');
  }],
  ['mensual suma volúmenes y recalcula todas las razones', () => {
    const a = row('2026-08-03', {'% show (realizadas/confirmadas)':0.5, '% cierre (cierres/realizadas)':1});
    const b = row('2026-08-10', {'Inversión Meta (USD)':28, [leadKey]:7, Agendas:14,
      'Agendas de venta (CRM)':8, 'Citas confirmadas':18, 'Reuniones realizadas (1ª con cada lead)':3,
      'Cierres nuevos':1, '% show (realizadas/confirmadas)':3/18, '% cierre (cierres/realizadas)':1/3});
    const m = c.embudoMensual(parse([a,b]))[0];
    for (const [key,value] of Object.entries({inversion:40,bookings:10,agendas:20,venta:10,confirmadas:20,asistencias:4,cierres:2,
      cpl:4,qb:0.5,costoVenta:4,show:0.2,cierre:0.5,costoAsistencia:10,cac:20})) assert.equal(m[key],value,key);
    assert.notEqual(m.show, (0.5+3/18)/2); assert.notEqual(m.cierre, (1+1/3)/2);
    const incomplete = c.embudoMensual(parse([a,{...b,'Inversión Meta (USD)':''}]))[0];
    assert.equal(incomplete.inversion,null); nd(incomplete.cpl); nd(incomplete.cac);
  }],
  ['quiebre semanal y mensual; agrupación usa Mes de la hoja', () => {
    const weeks = parse([row('2026-06-29',{Mes:7}), row('2026-07-13',{Mes:7}), row('2026-07-20',{Mes:7})]);
    nd(weeks[0].qb); nd(weeks[1].qb); assert.equal(weeks[2].qb,0.5);
    const months = c.embudoMensual(weeks);
    assert.equal(months.length,1); assert.equal(months[0].periodo,'2026-07'); nd(months[0].qb);
    nd(c.embudoMensual([weeks[0]])[0].qb);
    assert.equal(c.embudoMensual(parse([row(),row('2026-08-10')]))[0].qb,0.5);
  }],
  ['división por cero o ausencia produce n/d en todas las razones', () => {
    for (const [a,b] of [[1,0],[null,2],[2,null],[0,0]]) { assert.equal(c.embudoDivision(a,b),null); nd(c.embudoDivision(a,b)); }
    assert.equal(c.embudoDivision(0,2),0);
    for (const value of [0,'']) {
      const r = parse([row('2026-08-03', {[leadKey]:value,Agendas:value,'Agendas de venta (CRM)':value,
        'Citas confirmadas':value,'Reuniones realizadas (1ª con cada lead)':value,'Cierres nuevos':value})]);
      const m = c.embudoMensual(r)[0];
      for (const key of ['cpl','qb','costoVenta','show','cierre','costoAsistencia','cac']) nd(m[key]);
      nd(r[0].qb);
    }
  }],
  ['prefijo flexible, error visible si falta o es ambiguo, escape y filtro', () => {
    assert.equal(parse([row()])[0].bookings,3);
    const bad = row(); delete bad[leadKey];
    assert.throws(() => parse([bad]), /Leads \(/);
    assert.throws(() => parse([row(undefined, {'Leads (otra)':2})]), /única columna/);
    // Evaluar el cableado real de ingest sin red ni el resto del dashboard.
    c.texts = {EMBUDO_SEMANAL:[bad],META_DIARIO:[]};
    vm.runInContext(extract('    RAW_MDIA =', '    const allDates='),c);
    c.renderEmbudo(); assert.match(elements['embudo-table-wrap'].innerHTML,/role="alert".*Leads/);
    vm.runInContext('embudoError = "<img>";',c); c.renderEmbudo();
    assert.match(elements['embudo-table-wrap'].innerHTML,/&lt;img&gt;/);
    vm.runInContext('embudoError = "";',c);
    c.RAW_ES = parse([row('2026-07-13'),row('2026-07-20'),row('2026-08-03')]);
    c.dateFrom='2026-07-20'; c.dateTo='2026-07-20'; c.renderEmbudo();
    let html = elements['embudo-table-wrap'].innerHTML;
    assert.match(html,/embudo-quiebre/); assert.match(html,/Inicio leads GHL/);
    assert.match(html,/07\/20 – 08\/09/);
    assert.doesNotMatch(html,/07\/13|08\/03|2026-07-20/);
    assert.equal((html.match(/scope="col"/g)||[]).length,13);
    c.setEmbudoModo('mensual'); html=elements['embudo-table-wrap'].innerHTML;
    assert.match(html,/2026-08/); assert.match(html,/0,50/);
    c.setEmbudoModo('semanal');
    c.RAW_ES[1].fin='2026-<script>'; c.renderEmbudo();
    assert.match(elements['embudo-table-wrap'].innerHTML,/&lt;script&gt;/);
  }]
];
for (const [name, run] of scenarios) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack}`); process.exitCode = 1; }
}
