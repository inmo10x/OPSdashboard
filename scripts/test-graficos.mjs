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
const c = vm.createContext({});
vm.runInContext(extract('const EMBUDO_QUIEBRE =', 'function renderEmbudoGraficos(')
  + extract('function fmtDate(', 'function pct('), c);
const plain = value => JSON.parse(JSON.stringify(value));
const campos = ['inversion','ventaUSD','cpl','costoVenta','cac','bookings','venta','asistencias','cierres','show','cierre'];
function fila(inicio = '2026-08-03', cambios = {}) {
  return {
    'Semana inicio (lun)':inicio, Mes:8, 'Leads (GHL)':4, Agendas:8,
    'Inversión Meta (USD)':24, 'Agendas de venta (CRM)':3,
    'Venta nueva (USD)':90, 'Cash sin renovaciones (USD)':70,
    'Citas confirmadas':2, 'Reuniones realizadas (1ª con cada lead)':1, 'Cierres nuevos':1,
    'CPL (USD)':6, 'Costo por agenda de venta (USD)':8, 'CAC (USD)':24,
    '% show (realizadas/confirmadas)':0.78, '% cierre (cierres/realizadas)':0.25, ...cambios,
  };
}
const scenarios = [
  ['columnas monetarias y agendas conservan identidades distintas', () => {
    const r = c.parseEmbudo([fila()])[0];
    assert.equal(r.venta,3); assert.equal(r.ventaUSD,90); assert.equal(r.cashUSD,70);
    const s = c.embudoSeries([r], 'semanal');
    assert.deepEqual(plain(s.venta),[3]); assert.deepEqual(plain(s.ventaUSD),[90]);
    const vacio = c.parseEmbudo([fila(undefined, {'Venta nueva (USD)':'','Cash sin renovaciones (USD)':''})])[0];
    assert.equal(vacio.ventaUSD,null); assert.equal(vacio.cashUSD,null); assert.equal(vacio.venta,3);
  }],
  ['mensual suma cada volumen completo y propaga cualquier semana ausente', () => {
    const a = fila(), b = fila('2026-08-10', {'Venta nueva (USD)':30,'Cash sin renovaciones (USD)':20});
    const completo = c.embudoMensual(c.parseEmbudo([a,b]))[0];
    assert.equal(completo.ventaUSD,120); assert.equal(completo.cashUSD,90); assert.equal(completo.venta,6);
    const columnas = {
      inversion:'Inversión Meta (USD)', bookings:'Leads (GHL)', agendas:'Agendas', venta:'Agendas de venta (CRM)',
      ventaUSD:'Venta nueva (USD)', cashUSD:'Cash sin renovaciones (USD)', confirmadas:'Citas confirmadas',
      asistencias:'Reuniones realizadas (1ª con cada lead)', cierres:'Cierres nuevos',
    };
    for (const [key,col] of Object.entries(columnas)) {
      for (const weeks of [[{...a,[col]:''},b],[a,{...b,[col]:''}]]) {
        const m = c.embudoMensual(c.parseEmbudo(weeks))[0];
        assert.equal(m[key],null, `Total incompleto de ${key}`);
        if (key in c.embudoSeries([m], 'mensual')) assert.equal(c.embudoSeries([m], 'mensual')[key][0],null);
      }
    }
  }],
  ['ausentes son null en todas las series; ceros reales siguen siendo cero', () => {
    const rows = [null,0,2].map(value => ({inicio:'2026-08-03',...Object.fromEntries(campos.map(k=>[k,value]))}));
    const s = c.embudoSeries(rows, 'semanal');
    for (const key of campos) {
      assert.equal(s[key][0],null, `Hueco de ${key}, nunca cero`);
      assert.equal(s[key][1],0, `Cero real de ${key}`);
      assert.equal(s[key][2], ['show','cierre'].includes(key) ? 200 : 2);
    }
  }],
  ['tasas fraccionarias pasan a porcentaje sin convertir null en cero', () => {
    const r = c.parseEmbudo([fila()])[0];
    const s = c.embudoSeries([r,{...r,show:null,cierre:null}], 'semanal');
    assert.deepEqual(plain(s.show),[78,null]); assert.deepEqual(plain(s.cierre),[25,null]);
  }],
  ['etiquetas semanales y mensuales, orden recibido y entrada intacta', () => {
    // Orden inverso deliberado: la preparación de series no debe ordenar filas.
    const rows = c.parseEmbudo([fila(),fila('2026-09-07',{Mes:9,'Venta nueva (USD)':50})]).reverse();
    rows.forEach((r,i) => campos.forEach((key,j) => { r[key] = (i+1)*(j+1); }));
    const before = plain(rows);
    const semanal = c.embudoSeries(rows, 'semanal');
    assert.deepEqual(plain(semanal.labels),['07/09','03/08']);
    for (const [j,key] of campos.entries()) {
      const factor = ['show','cierre'].includes(key) ? 100 : 1;
      assert.deepEqual(plain(semanal[key]),[(j+1)*factor,2*(j+1)*factor],key);
    }
    assert.deepEqual(plain(rows),before);
    const mensual = c.embudoSeries([{...rows[0],periodo:'2027-01'},{...rows[1],periodo:'2026-12'}], 'mensual');
    assert.deepEqual(plain(mensual.labels),['Ene 2027','Dic 2026']);
    for (const key of campos) assert.deepEqual(plain(mensual[key]),plain(semanal[key]));
    const empty = c.embudoSeries([], 'mensual');
    for (const key of ['labels',...campos]) assert.deepEqual(plain(empty[key]),[]);
  }],
];
for (const [name, run] of scenarios) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack}`); process.exitCode = 1; }
}
