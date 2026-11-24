// La asistencia se prueba, no se infiere del silencio: CALL_CONFIRMER_LOG y
// CLOSER_LOG se complementan porque las dos fallan por omisión, nunca inventando.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
  + extract('const esAsistencia =', '//  RENDER ALL'), c);

const F = '2026-11-18';
const cita = (o = {}) => ({Fecha: F, Confirmer: 'CRM', Estado: 'Confirmado',
  Closer: 'Karim', Mail: 'noelia@x.cl', Nombre: 'Noelia', Notas: '', ...o});
const log = (o = {}) => ({Fecha: F, Closer: 'Karim', Evento: 'asistencia',
  Mail: 'noelia@x.cl', Nombre: 'Noelia', ...o});
function calcular(citas, logs) {
  c.RAW_CC = citas; c.RAW_CL = logs;
  return c.computeStats();
}
const totales = (citas, logs) => {
  const s = calcular(citas, logs);
  return [s.totAs, s.totAg, s.byCloser.Karim ? s.byCloser.Karim.as : 0];
};

const scenarios = [
  ['una cita asistida que el log no tiene se cuenta igual', () => {
    assert.deepEqual(totales([cita()], []), [1, 1, 1]);
  }],

  ['la nota de no-show descuenta la asistencia pero no la cita', () => {
    for (const nota of ['No asistió', 'no asistio', 'NO ASISTIÓ', '  no   asistió ', 'No asistio al final']) {
      assert.deepEqual(totales([cita({Notas: nota})], []), [0, 1, 0], `nota: ${nota}`);
    }
  }],

  ['una nota ajena no se confunde con un no-show', () => {
    for (const nota of ['Santiago', 'No contesta', 'Medellín', 'asistió tarde']) {
      assert.deepEqual(totales([cita({Notas: nota})], []), [1, 1, 1], `nota: ${nota}`);
    }
  }],

  ['la cita cancelada no cuenta ni en asistencias ni en el denominador', () => {
    assert.deepEqual(totales([cita({Estado: 'Cancelado'}), cita({Estado: 'En proceso'})], []), [0, 0, 0]);
  }],

  ['en las filas humanas no se infiere asistencia de una nota vacía', () => {
    for (const quien of ['Claudia', 'Karim', '']) {
      assert.deepEqual(totales([cita({Confirmer: quien})], []), [0, 1, 0], `confirmer: ${quien}`);
    }
    // Pero si el log las respalda, cuentan.
    assert.deepEqual(totales([cita({Confirmer: 'Claudia'})], [log()]), [1, 1, 1]);
  }],

  ['la misma reunión en las dos fuentes se cuenta una vez', () => {
    assert.deepEqual(totales([cita()], [log()]), [1, 1, 1]);
    // El cruce es por mail, insensible a mayúsculas y espacios.
    assert.deepEqual(totales([cita({Mail: '  NOELIA@X.CL '})], [log()]), [1, 1, 1]);
  }],

  ['una cita sin mail no suma donde el log sí escribió ese día', () => {
    // Caso real del 5/11: el confirmer guardó "Danitza" sin mail y el log la trae
    // como danitzanavarreteivaca@gmail.com. El nombre no cruza ("Danitza" contra
    // "Danitza Navarrete"), así que sumarla duplicaba una reunión que ya estaba.
    const [as] = totales([cita({Mail: '', Nombre: 'Danitza'})],
                         [log({Mail: 'danitza.navarrete@x.cl', Nombre: 'Danitza Navarrete'})]);
    assert.equal(as, 1);
    // El log escribió ese día aunque la fila sea un no-show: igual manda.
    assert.equal(totales([cita({Mail: '', Nombre: 'Danitza'})],
                         [log({Mail: 'otro@x.cl', Evento: 'no asiste'})])[0], 0);
  }],

  ['una cita sin mail sí suma donde el log no escribió nada', () => {
    // Es el agujero que esta unión viene a tapar: sin log no hay qué duplicar.
    assert.equal(totales([cita({Mail: '', Nombre: 'Danitza'})], [])[0], 1);
    assert.equal(totales([cita({Mail: '', Nombre: 'Danitza'})],
                         [log({Fecha: '2026-11-17'})])[0], 2);
  }],

  ['un día de corrimiento entre las hojas es la misma reunión', () => {
    // Caso real: el confirmer agendó a Diego el 9/11 y el log, que toma la fecha
    // de la transcripción, lo anotó el 10/11. Son una reunión, no dos.
    assert.equal(totales([cita()], [log({Fecha: '2026-11-19'})])[0], 1);
    assert.equal(totales([cita()], [log({Fecha: '2026-11-17'})])[0], 1);
    // Dos días ya no: ahí son reuniones distintas y las dos cuentan.
    assert.equal(totales([cita()], [log({Fecha: '2026-11-20'})])[0], 2);
    assert.equal(totales([cita()], [log({Fecha: '2026-11-16'})])[0], 2);
    // La tolerancia cruza por mail, no por cercanía a secas.
    assert.equal(totales([cita()], [log({Fecha: '2026-11-19', Mail: 'otro@x.cl'})])[0], 2);
  }],

  ['dos leads con el mismo nombre y distinto mail no se fusionan', () => {
    // Caso real: el 14/11 la hoja trae dos "Aurora" con mails distintos.
    const a = {Mail: 'carbajalaurora@gmail.com', Nombre: 'Aurora'};
    const b = {Mail: 'carbajalcabello@gmail.com', Nombre: 'Aurora'};
    assert.deepEqual(totales([cita(a), cita(b)], []), [2, 2, 2]);
    // Y si el log solo tiene una, la otra la aporta la hoja sin duplicar.
    assert.deepEqual(totales([cita(a), cita(b)], [log(a)]), [2, 2, 2]);
  }],

  ['el log le gana a la nota: si hay transcripción, la reunión ocurrió', () => {
    assert.deepEqual(totales([cita({Notas: 'No asistió'})], [log()]), [1, 1, 1]);
  }],

  ['dos reuniones del mismo lead el mismo día siguen siendo dos', () => {
    assert.deepEqual(totales([cita()], [log(), log({Evento: 'seguimiento'})]), [2, 1, 2]);
  }],

  ['con el log sano el total es el de antes: la hoja no infla', () => {
    const logs = [log(), log({Mail: 'b@x.cl'}), log({Mail: 'c@x.cl', Evento: 'cierre'})];
    const citas = logs.map(r => cita({Mail: r.Mail}));
    c.lista = logs;
    const soloLog = vm.runInContext('lista.filter(esAsistencia).length', c);
    assert.equal(calcular(citas, logs).totAs, soloLog, 'La unión no agrega nada si el log ya las tiene');
  }],

  ['la semana del 16/11: 6 citas, 3 en pie, 1 asistió', () => {
    const semana = [
      cita({Fecha: '2026-11-17', Mail: 'aurora@x.cl',  Estado: 'Cancelado'}),
      cita({Fecha: '2026-11-18', Mail: 'noelia@x.cl'}),
      cita({Fecha: '2026-11-19', Mail: 'stefany@x.cl', Estado: 'Cancelado'}),
      cita({Fecha: '2026-11-20', Mail: 'sanni@x.cl',   Notas: 'No asistió'}),
      cita({Fecha: '2026-11-21', Mail: 'sara@x.cl',    Estado: 'Cancelado'}),
      cita({Fecha: '2026-11-21', Mail: 'jose@x.cl',    Notas: 'No asistió'}),
    ];
    const s = calcular(semana, []);   // CLOSER_LOG caído, como de verdad
    assert.equal(s.totAg, 3, 'Tres citas siguieron en pie');
    assert.equal(s.totAs, 1, 'Solo Noelia asistió');
    assert.equal(c.pct(s.totAs, s.totAg), 33, 'Show rate 1 de 3');
  }],
];
for (const [name, run] of scenarios) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack}`); process.exitCode = 1; }
}
