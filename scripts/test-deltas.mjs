import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
// Evaluar fechas, agregados y tarjetas sin arrancar el dashboard ni usar la red.
function extract(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `No se encontró ${start}`);
  return source.slice(from, to);
}
const code = extract('const META_MENSUAL_USD', '//  RAW DATA')
  + extract('const esAsistencia =', '//  COMPUTE STATS')
  + extract('function pct(', '// ═════════')
  + extract('function renderKPIs(', '// ═════════')
  + extract('function renderOverview(', '  // ── Ranking de closers') + '\n}'
  + extract('function toDate(s)', 'function toN(')
  + extract('    function toDateAS(', '    RAW_MD =');
function harness() {
  const elements = {};
  const context = vm.createContext({
    Date, RAW_MD: [], RAW_CC: [], RAW_CL: [], RAW_V: [], RAW_C: [], RAW_ES: [], RAW_MDIA: [],
    DATA_FLOOR: '2026-01-01', DATA_CEIL: '2026-12-31',
    dateFrom: '2026-10-01', dateTo: '2026-10-31',
    document: { getElementById: id => elements[id] ||= {} },
    weeklySeries: () => [], sparklineSVG: () => '', fmtMoney: String,
    weekOf: d => d
  });
  vm.runInContext(code, context);
  return { context, elements };
}
function neutral(html) {
  assert.match(html, /class="(?:ov-)?kpi-delta flat"/);
  assert.doesNotMatch(html, /▲|▼|nuevo|class="[^"]* up/);
}
function windowIs(from, to, pFrom, pTo) {
  const { context: c } = harness();
  c.dateFrom = from; c.dateTo = to;
  c.DATA_FLOOR = '2020-01-01'; c.DATA_CEIL = '2035-12-31';
  let predicate;
  c.computeCoreStats = fn => { predicate = fn; return {}; };
  assert.notEqual(c.computePrevStats(), null);
  const shift = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0,10);
  assert.equal(predicate(pFrom), true);
  assert.equal(predicate(pTo), true);
  assert.equal(predicate(shift(pFrom, -1)), false);
  assert.equal(predicate(shift(pTo, 1)), false);
  assert.equal(Boolean(predicate('')), false);
}
const scenarios = [
  ['cobertura completa y tarjetas neutras sin período previo', () => {
    const { context: c, elements } = harness();
    c.dateFrom = '2026-02-01'; c.dateTo = '2026-02-28';
    c.DATA_FLOOR = '2026-01-02';
    c.RAW_V = [{ 'Fecha Cierre': '2026-01-15', Venta: 2, Tipo: '', Cliente: 'A' }];
    assert.equal(c.computePrevStats(), null);
    const s = c.computeCoreStats(() => true);
    c.renderOverview(s); c.renderKPIs(s);
    assert.equal((elements['ov-kpis'].innerHTML.match(/sin período previo/g) || []).length, 4);
    neutral(elements['ov-kpis'].innerHTML);
    assert.doesNotMatch(elements['ov-kpis'].innerHTML, /vs\. período anterior/);
    for (const key of ['ventas', 'renov', 'agendas', 'show', 'close']) {
      neutral(elements[`k-${key}-delta`].innerHTML);
      assert.match(elements[`k-${key}-delta`].innerHTML, /sin período previo/);
    }
    c.DATA_FLOOR = '2026-01-01';
    assert.equal(c.computePrevStats().totVenta, 2);
    c.DATA_CEIL = '2026-01-30';
    assert.equal(c.computePrevStats(), null);
    c.DATA_CEIL = '2026-01-31';
    assert.equal(c.computePrevStats().totVenta, 2);
    c.DATA_FLOOR = '';
    assert.equal(c.computePrevStats(), null);
  }],
  ['mes calendario: octubre, mayo, enero y año bisiesto', () => {
    windowIs('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30');
    windowIs('2026-05-01', '2026-05-31', '2026-04-01', '2026-04-30');
    windowIs('2027-01-01', '2027-01-31', '2026-12-01', '2026-12-31');
    windowIs('2028-03-01', '2028-03-31', '2028-02-01', '2028-02-29');
  }],
  ['rangos parciales conservan ventana deslizante inclusiva', () => {
    windowIs('2026-10-02', '2026-10-05', '2026-09-28', '2026-10-01');
    windowIs('2026-10-01', '2026-10-30', '2026-09-01', '2026-09-30');
    windowIs('2026-10-05', '2026-10-05', '2026-10-04', '2026-10-04');
  }],
  ['bases cero, redondeo, porcentajes y clases compartidas', () => {
    const { context: c } = harness();
    for (const [css, suffix] of [['kpi-delta', false], ['ov-kpi-delta', true]]) {
      const d = (curr, prev) => c.delta(curr, prev, css, suffix);
      assert.match(d(2, 0), /up"[^>]*>▲ nuevo/);
      for (const html of [d(0, 0), d(100.1, 100), d(99.9, 100)]) {
        neutral(html); assert.match(html, /sin cambio/);
      }
      neutral(d(0, null)); neutral(d(2, null));
      assert.match(d(3, 2), /▲ 50%/); assert.match(d(1, 2), /▼ 50%/);
      for (const html of [d(2, 0), d(0, 0), d(100.1, 100), d(99.9, 100), d(3, 2), d(72, 100)]) {
        assert.equal(html.includes('<span class="vs">vs. período anterior</span>'), suffix);
      }
      for (const html of [d(0, null), d(2, null), c.deltaP(50, null, css, suffix)]) {
        assert.doesNotMatch(html, /vs\. período anterior/);
      }
      neutral(c.deltaP(50, 50, css, suffix));
      neutral(c.deltaP(50, null, css, suffix));
      assert.match(c.deltaP(52, 50, css, suffix), /▲ 2pp/);
    }
  }],
  ['deltas extremos: múltiplo y porcentaje exacto auditable', () => {
    const { context: c } = harness();
    assert.match(c.delta(11, 1), /▲ >10×/);
    assert.match(c.delta(11, 1), /title="1000%"/);
    assert.match(c.delta(22.5, 2), /title="1025%"/);
    assert.match(c.delta(22.5, 2), /▲ >10×/);
    assert.match(c.delta(-10, 1), /▼ >11×/);
    assert.match(c.delta(-10, 1), /title="-1100%"/);
    assert.match(c.delta(10, 1), /▲ 900%/);
  }],
  ['serial numérico, Date y string conservan su fecha', () => {
    const { context: c } = harness();
    assert.equal(c.toDateAS(46073), '2026-02-20');
    assert.equal(c.toDateAS(new Date(2026, 1, 20, 12)), '2026-02-20');
    assert.equal(c.toDateAS('2026-02-20'), '2026-02-20');
  }],
  ['cobertura incluye las siete hojas y excluye fechas implausibles', () => {
    const { context: c } = harness();
    const coverage = extract('    const allDates=', '    // Si el usuario no fijó');
    for (const sheet of ['RAW_MD', 'RAW_CC', 'RAW_CL', 'RAW_V', 'RAW_C', 'RAW_ES', 'RAW_MDIA']) {
      for (const name of ['RAW_MD', 'RAW_CC', 'RAW_CL', 'RAW_V', 'RAW_C', 'RAW_ES', 'RAW_MDIA']) c[name] = [];
      const key = sheet === 'RAW_V' ? 'Fecha Cierre' : sheet === 'RAW_ES' ? 'inicio' : 'Fecha';
      c[sheet] = ['2019-12-31', '2020-01-01', '2035-12-31', '2036-01-01', '+046073-01-01', null].map(d => ({ [key]: d }));
      vm.runInContext(`{${coverage}}`, c);
      assert.equal(c.DATA_FLOOR, '2020-01-01');
      assert.equal(c.DATA_CEIL, '2035-12-31');
      c[sheet] = [];
      vm.runInContext(`{${coverage}}`, c);
      assert.equal(c.DATA_FLOOR, ''); assert.equal(c.DATA_CEIL, '');
    }
  }]
];
for (const [name, run] of scenarios) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
