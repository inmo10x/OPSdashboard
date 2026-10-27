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
const c = vm.createContext({
  RAW_MD: [], RAW_CC: [], RAW_CL: [], RAW_V: [], RAW_C: [],
  dateFrom: '', dateTo: '', DATA_FLOOR: '', DATA_CEIL: '',
  document: {getElementById: id => elements[id] ||= {}}
});
vm.runInContext(extract('const META_MENSUAL_USD', '//  RAW DATA')
  + extract('function inRange(', '//  CHART INSTANCES')
  + extract('const esAsistencia =', '//  RENDER ALL')
  + extract('function renderKPIs(', '// ═════════'), c);
const fila = Evento => ({Fecha:'2026-01-12', Closer:'Ana', Lead:'L1', Cliente:'L1', Evento});
function calcular(eventos, estados = ['Confirmado']) {
  c.RAW_CL = eventos.map(fila);
  c.RAW_CC = estados.map(Estado => ({Fecha:'2026-01-12', Closer:'Ana', Lead:'L1', Estado}));
  return c.computeStats();
}
function verificarEvento(evento, esperado) {
  c.row = fila(evento);
  assert.equal(vm.runInContext('esAsistencia(row)', c), Boolean(esperado), `Predicado: ${JSON.stringify(evento)}`);
  const s = calcular([evento]);
  assert.equal(s.totAs, esperado, `Total: ${JSON.stringify(evento)}`);
  assert.equal(s.byCloser.Ana.as, esperado, `Closer: ${JSON.stringify(evento)}`);
}
const scenarios = [
  ['lista blanca exacta en CONFIG y cuatro eventos por separado', () => {
    assert.deepEqual(Array.from(vm.runInContext('EVENTOS_ASISTENCIA', c)),
      ['asistencia','cierre','perdido','seguimiento']);
    for (const evento of ['asistencia','cierre','perdido','seguimiento']) verificarEvento(evento, 1);
  }],
  ['eventos ajenos, vacíos y desconocidos no cuentan', () => {
    for (const evento of ['agenda','reserva','cash collect','','evento futuro inventado','no asiste','cancelada','no show','cancelado']) {
      verificarEvento(evento, 0);
    }
  }],
  ['mayúsculas y espacios no cambian la clasificación', () => {
    for (const evento of ['asistencia','cierre','perdido','seguimiento']) verificarEvento(' \t'+evento.toUpperCase()+' \n', 1);
    for (const evento of ['agenda','reserva','cash collect','','evento futuro inventado','no asiste','cancelada']) {
      verificarEvento(' \t'+evento.toUpperCase()+' \n', 0);
    }
  }],
  ['reuniones sin deduplicar, denominador confirmado y tasas visibles', () => {
    const eventos = ['asistencia','seguimiento','agenda','reserva','cash collect'];
    const s = calcular(eventos, ['Confirmado','Confirmado','Confirmado','Cancelado','Descalificado','confirmado','']);
    // El criterio anterior incluía las cinco filas frente a tres confirmaciones.
    const anteriores = eventos.filter(e => !['no asiste','no show','cancelada','cancelado'].includes(e)).length;
    assert.ok(c.pct(anteriores, s.totAg) > 100);
    assert.equal(s.totAg, 3);
    assert.equal(s.byCloser.Ana.ag, 3);
    assert.equal(s.totAs, 2, 'Dos reuniones del mismo lead cuentan dos veces');
    assert.equal(s.byCloser.Ana.as, 2, 'Tampoco se deduplica por closer');
    assert.ok(c.pct(s.totAs, s.totAg) <= 100);
    c.RAW_V = [{Closer:'Ana', 'Fecha Cierre':'2026-01-12', Cliente:'L1', Tipo:'Nuevo', Venta:10, Cobrado:10, Pendiente:0}];
    c.renderKPIs(c.computeStats());
    assert.equal(elements['k-show'].textContent, '67%');
    assert.equal(elements['k-show-sub'].textContent, '2/3 asist. / conf.');
    assert.equal(elements['k-close'].textContent, '50%');
    c.RAW_V = [];
    const repetidas = calcular(['asistencia','asistencia'], ['Confirmado','Confirmado']);
    assert.equal(repetidas.totAs, 2, 'Incluso dos eventos iguales del mismo lead cuentan');
    assert.equal(repetidas.byCloser.Ana.as, 2);
  }],
  ['tooltip derivado de CONFIG y actualizado al ampliar la lista', () => {
    const lista = Array.from(vm.runInContext('EVENTOS_ASISTENCIA', c));
    c.renderKPIs(calcular(['asistencia']));
    const antes = elements['k-show-sub'].title;
    assert.equal(typeof antes, 'string');
    assert.ok(antes.includes(lista.join(', ')), 'El tooltip enumera la lista completa');
    const nuevo = 'reunión de prueba añadida';
    c.nuevo = nuevo;
    vm.runInContext('EVENTOS_ASISTENCIA.push(nuevo)', c);
    c.renderKPIs(calcular([nuevo]));
    const despues = elements['k-show-sub'].title;
    assert.ok(despues.includes([...lista, nuevo].join(', ')), 'El tooltip refleja el evento añadido');
    assert.notEqual(despues, antes);
    verificarEvento(nuevo, 1);
    vm.runInContext('EVENTOS_ASISTENCIA.pop()', c);
  }]
];
for (const [name, run] of scenarios) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack}`); process.exitCode = 1; }
}
