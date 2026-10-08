import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
// Evaluar solo la red y el login, sin arrancar el dashboard ni usar datos reales.
function extract(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `No se encontró ${start}`);
  return source.slice(from, to);
}
const code = extract('async function fetchOnce(', 'async function loadData(')
  + extract('async function doLogin(', 'function logout(');
const data = { METRICAS_DIARIAS: [{ Fecha: '2026-01-01', Closer: 'Ejemplo' }] };
const ok = { ok: true, text: async () => `cb(${JSON.stringify(data)});` };
const forbidden = { ok: false, status: 403 };
const auth = { ok: true, text: async () => 'cb({"error":"Credenciales ficticias"});' };

function harness(responses) {
  let calls = 0;
  const retries = [], waits = [], timeouts = [], timers = new Set();
  const elements = {
    'login-user': { value: 'ejemplo' }, 'login-pass': { value: 'token-ficticio' },
    'login-btn': { textContent: 'Ingresar', disabled: false },
    'login-error': { textContent: '' }, 'login-gate': { style: {} }
  };
  const context = vm.createContext({
    APPS_SCRIPT_URL: 'https://example.invalid/exec',
    authUser: 'ejemplo', authToken: 'token-ficticio', AbortController,
    fetch: async () => {
      assert.ok(calls < responses.length, 'Llamada inesperada');
      return responses[calls++];
    },
    setTimeout(callback, ms) {
      const timer = {};
      if (ms === 45000) {
        timeouts.push(ms);
        timers.add(timer); // Registrar el timeout; estas respuestas son inmediatas.
      } else {
        assert.deepEqual(retries.at(-1), [calls, 3, ms / 1000]);
        waits.push(ms);
        callback(); // Sin esperas reales.
      }
      return timer;
    },
    clearTimeout: timer => assert.ok(timers.delete(timer)),
    document: { getElementById: id => elements[id] },
    sessionStorage: { setItem() {} }, saveCache() {}, ingest() {}
  });
  vm.runInContext(code, context);
  const originalFetchRemote = context.fetchRemote;
  context.fetchRemote = (options = {}) => originalFetchRemote({
    onRetry(...args) {
      retries.push(args);
      options.onRetry?.(...args);
      if (options.onRetry) {
        assert.equal(elements['login-btn'].disabled, true);
        assert.ok(elements['login-btn'].textContent.includes(`${args[0] + 1} de 3`));
      }
    }
  });
  for (const message of ['Timeout', 'HTTP 403', 'HTTP 500',
    'No se pudo cargar Apps Script', 'Respuesta inválida del Apps Script', 'Otro error']) {
    assert.equal(context.classifyError(new Error(message)), 'servicio');
  }
  assert.equal(context.classifyError(new Error('AUTH')), 'auth');
  return {
    context, elements, originalFetchRemote,
    verify(expectedCalls, expectedWaits) {
      assert.equal(calls, expectedCalls);
      assert.deepEqual(waits, expectedWaits);
      assert.deepEqual(retries, expectedWaits.map((ms, i) => [i + 1, 3, ms / 1000]));
      assert.equal(timeouts.length, expectedCalls);
      assert.equal(timers.size, 0);
    }
  };
}

const scenarios = [
  ['(a) éxito al primer intento: datos y 1 llamada', [ok], 1, []],
  ['(b) AUTH: categoría auth y 1 llamada', [auth], 1, [], 'auth'],
  ['(c) 403 en 3 intentos: servicio y esperas de 3 y 10 segundos',
    [forbidden, forbidden, forbidden], 3, [3000, 10000], 'servicio'],
  ['(d) 403, 403, éxito: datos y 3 llamadas', [forbidden, forbidden, ok], 3, [3000, 10000]]
];
for (const [name, responses, calls, waits, category] of scenarios) {
  try {
    const h = harness(responses);
    if (category) {
      await assert.rejects(h.context.fetchRemote(), e => h.context.classifyError(e) === category);
    } else {
      assert.equal(JSON.stringify(await h.context.fetchRemote()), JSON.stringify(data));
    }
    h.verify(calls, waits);
    if (!waits.length) {
      const noArgs = harness(responses);
      if (category) await assert.rejects(noArgs.originalFetchRemote(), /AUTH/);
      else assert.equal(JSON.stringify(await noArgs.originalFetchRemote()), JSON.stringify(data));
      noArgs.verify(calls, waits);
    }
    // Verificar también progreso, mensajes y restauración del botón del login.
    const login = harness(responses);
    await login.context.doLogin({ preventDefault() {} });
    login.verify(calls, waits);
    assert.equal(login.elements['login-btn'].disabled, false);
    assert.equal(login.elements['login-btn'].textContent, 'Ingresar');
    const message = login.elements['login-error'].textContent;
    if (category === 'auth') assert.equal(message, 'Usuario o contraseña incorrectos');
    else if (category === 'servicio') {
      assert.match(message, /servicio de Google/);
      assert.match(message, /temporal/);
      assert.match(message, /par de minutos/);
      assert.doesNotMatch(message, /HTTP|403|Apps Script|Timeout/);
    } else {
      assert.equal(message, '');
      assert.equal(login.elements['login-gate'].style.display, 'none');
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}
