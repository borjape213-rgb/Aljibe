"""Pruebas de seguridad de los datos: arranque, restauración de copias e importes con símbolo de moneda.

Uso (con el servidor en marcha: python3 -m http.server 8765 -d dist):
    python3 e2e_data.py [http://localhost:8765]

Cada escenario usa un contexto de navegador nuevo (IndexedDB propio) y termina con un resumen de FALLOS.
"""
import json, re, sys
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765').rstrip('/')
U = BASE + '/index.html'
fails, errs = [], []


def check(name, cond):
    print(('OK  ' if cond else 'FALLA'), name)
    if not cond:
        fails.append(name)


# Hace que las N primeras llamadas a indexedDB.open de cada carga fallen (N en sessionStorage.failIDB):
# un fallo transitorio, como el que deja la lectura sin resolver mientras la escritura sí funcionaría.
FAIL_IDB = """(() => {
  const orig = indexedDB.open.bind(indexedDB);
  let left = 0; try { left = Number(sessionStorage.getItem('failIDB') || 0); } catch {}
  indexedDB.open = (...a) => {
    if (left <= 0) return orig(...a);
    left--;
    const req = {};
    setTimeout(() => { req.error = new DOMException('simulado', 'UnknownError'); if (req.onerror) req.onerror(new Event('error')); }, 0);
    return req;
  };
})()"""

READ = """() => new Promise((res, rej) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result ?? null); g.onerror = () => rej(g.error); }; r.onerror = () => rej(r.error); })"""
WRITE = """(s) => new Promise((res, rej) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(s, 'state'); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); })"""


def new_page(b):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='es-ES', timezone_id='Europe/Madrid', accept_downloads=True)
    ctx.add_init_script(FAIL_IDB)
    pg = ctx.new_page()
    pg.set_default_timeout(5000)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return pg


def seed_demo(pg):
    pg.goto(U + '?demo=1')
    pg.wait_for_selector('.topbar')
    pg.wait_for_timeout(700)  # deja que se guarde (el guardado se agrupa 150 ms)
    st = pg.evaluate(READ)
    return st


def visible(pg, text, **kw):
    return pg.get_by_text(text, **kw).first.is_visible()


def scenario(name):
    def deco(fn):
        def run(b):
            print(f'\n# {name}')
            try:
                fn(b)
            except Exception as e:  # un escenario roto no tapa a los demás
                check(f'{name}: abortado ({type(e).__name__}: {str(e).splitlines()[0][:110]})', False)
        return run
    return deco


@scenario('1. Un fallo de lectura de IndexedDB no borra los datos')
def s1(b):
    pg = new_page(b)
    st = seed_demo(pg)
    n_tx, n_acc = len(st['transactions']), len(st['accounts'])
    check('hay datos de partida', n_tx > 50 and n_acc > 3)
    # marcador propio: los datos de ejemplo son siempre idénticos, así que un estado "pisado" por otra copia del ejemplo pasaría por intacto
    st['settings']['holder'] = 'Titular Marcador'
    pg.evaluate(WRITE, st)
    pg.evaluate("sessionStorage.setItem('failIDB','1')")  # solo falla la primera apertura: la lectura
    pg.reload(); pg.wait_for_timeout(900)
    check('avisa de que no pudo leer', visible(pg, 'No he podido leer tus datos guardados'))
    pg.evaluate("sessionStorage.removeItem('failIDB')")
    now = pg.evaluate(READ)
    check('lo guardado sigue intacto', now is not None and len(now['transactions']) == n_tx and len(now['accounts']) == n_acc and now['settings'].get('holder') == 'Titular Marcador')
    pg.get_by_role('button', name='Reintentar').click(); pg.wait_for_selector('.topbar'); pg.wait_for_timeout(500)
    check('al reintentar vuelve todo', pg.get_by_text('Patrimonio neto').first.is_visible())
    again = pg.evaluate(READ)
    check('y sigue guardado', len(again['transactions']) == n_tx and again['settings'].get('holder') == 'Titular Marcador')


@scenario('2. Datos de una versión futura: no se pisan, se pueden descargar')
def s2(b):
    pg = new_page(b)
    st = seed_demo(pg)
    n_tx, n_acc = len(st['transactions']), len(st['accounts'])
    st['version'] = 2
    pg.evaluate(WRITE, st)
    pg.reload(); pg.wait_for_timeout(900)
    check('explica que no puede abrirlos', visible(pg, 'no se pueden abrir con esta versión'))
    now = pg.evaluate(READ)
    check('lo guardado no se ha tocado', now is not None and now['version'] == 2 and len(now['transactions']) == n_tx)
    with pg.expect_download() as d:
        pg.get_by_role('button', name='Descargar lo guardado').click()
    got = json.load(open(d.value.path()))
    check('se descarga tal cual', got.get('version') == 2 and len(got['transactions']) == n_tx)
    pg.get_by_role('button', name='Continuar sin guardar').click(); pg.wait_for_selector('.topbar')
    check('modo sin guardar avisa', visible(pg, 'modo sin guardar'))
    # cambio de hash, no goto: una carga completa descartaría la sesión en memoria (y volvería a mostrar el bloqueo)
    pg.evaluate("location.hash = '#/accounts'"); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='Añadir cuenta').first.click()
    pg.get_by_label('Nombre', exact=True).fill('Solo en memoria'); pg.get_by_label('Saldo actual', exact=True).fill('10')
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(700)
    check('la cuenta nueva se ve en la sesión', visible(pg, 'Solo en memoria'))
    after = pg.evaluate(READ)
    check('pero no se escribe nada en disco', after['version'] == 2 and len(after['accounts']) == n_acc)
    pg.reload(); pg.wait_for_timeout(700)
    check('al recargar vuelve a avisar', visible(pg, 'no se pueden abrir con esta versión'))


@scenario('3. Restaurar una copia: valida, confirma y deja deshacer')
def s3(b):
    pg = new_page(b)
    st = seed_demo(pg)
    n_tx, n_acc = len(st['transactions']), len(st['accounts'])
    pg.goto(U + '#/settings/data'); pg.wait_for_timeout(300)
    pick = lambda name, content, mime='application/json': pg.set_input_files('input[aria-label="Elegir copia de seguridad"]', files=[{'name': name, 'mimeType': mime, 'buffer': content}])

    pick('roto.json', b'esto no es json'); pg.wait_for_timeout(300)
    check('texto que no es JSON: rechazado', visible(pg, 'no es una copia de seguridad válida'))
    pick('malo.json', json.dumps({'version': 1, 'accounts': [], 'transactions': [{'id': 't', 'accountId': 'a', 'date': 'ayer', 'amountCents': 1, 'categoryId': 'c'}], 'categories': []}).encode()); pg.wait_for_timeout(300)
    check('movimiento con fecha mala: rechazado con el motivo', visible(pg, 'Movimiento 1: fecha no válida'))
    check('sin hoja de confirmación en un archivo malo', pg.get_by_role('dialog').count() == 0)
    check('los datos no cambian', len(pg.evaluate(READ)['transactions']) == n_tx)

    # copia a la que le faltan settings, rules, holdings, prices, securities…: antes rompía la app en cada arranque
    partial = {k: st[k] for k in ('version', 'accounts', 'transactions', 'categories', 'groups')}
    partial['accounts'] = partial['accounts'][:2]; partial['transactions'] = partial['transactions'][:20]
    pick('parcial.json', json.dumps(partial).encode()); pg.wait_for_timeout(300)
    dlg = pg.get_by_role('dialog', name='¿Restaurar esta copia?')
    check('pide confirmación', dlg.count() == 1)
    txt = dlg.inner_text() if dlg.count() else ''
    check('con recuento de lo que entra y de lo que sale', '2 cuentas' in txt and '20 movimientos' in txt and f'{n_acc} cuentas' in txt and f'{n_tx} movimientos' in txt)
    pg.get_by_role('button', name='Cancelar').click(); pg.wait_for_timeout(500)
    check('cancelar no cambia nada', len(pg.evaluate(READ)['transactions']) == n_tx)

    pick('parcial.json', json.dumps(partial).encode()); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='Restaurar', exact=True).click(); pg.wait_for_timeout(700)
    check('restaura y lo dice', visible(pg, re.compile('Copia restaurada: 2 cuentas y 20 movimientos')))
    saved = pg.evaluate(READ)
    check('guardado con los valores por defecto completados', len(saved['transactions']) == 20 and saved['settings']['currency'] == 'EUR' and saved['rules'] == [] and saved['prices'] == {})
    for r in ['#/', '#/accounts', '#/transactions', '#/cashflow', '#/budget', '#/recurring', '#/investments', '#/settings/data']:
        pg.goto(U + r); pg.wait_for_timeout(250)
        check(f'pantalla {r} sin errores tras restaurar', pg.locator('.topbar').count() == 1 and not visible(pg, 'Algo ha fallado'))
    pg.reload(); pg.wait_for_selector('.topbar')
    check('arranca bien tras recargar', pg.locator('.topbar').count() == 1)

    pg.goto(U + '#/settings/data'); pg.wait_for_timeout(400)
    check('ofrece la copia de antes', pg.get_by_role('button', name='Recuperarla').count() == 1 and visible(pg, f'{n_acc} cuentas, {n_tx} movimientos'))
    pg.get_by_role('button', name='Recuperarla').click(); pg.wait_for_timeout(700)
    back = pg.evaluate(READ)
    check('recuperarla devuelve lo anterior', visible(pg, 'Copia anterior recuperada') and len(back['transactions']) == n_tx and len(back['accounts']) == n_acc)

    # vaciar también guarda copia
    pg.get_by_role('button', name='Vaciar todo').click(); pg.get_by_role('button', name='Vaciar', exact=True).click(); pg.wait_for_timeout(700)
    check('vaciar deja el estado vacío', len(pg.evaluate(READ)['transactions']) == 0)
    pg.get_by_role('button', name='Recuperarla').click(); pg.wait_for_timeout(700)
    check('y se puede recuperar lo vaciado', len(pg.evaluate(READ)['transactions']) == n_tx)

    # la copia previa se puede borrar del móvil, con confirmación
    key = lambda k: pg.evaluate("(k) => new Promise((res, rej) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get(k); g.onsuccess = () => res(g.result ?? null); g.onerror = () => rej(g.error); }; r.onerror = () => rej(r.error); })", k)
    check('hay copia previa guardada', key('previous') is not None)
    pg.get_by_role('button', name='Borrarla').click()
    check('pide confirmación para borrarla', pg.get_by_role('dialog', name='¿Borrar la copia anterior?').count() == 1)
    pg.get_by_role('button', name='Cancelar').click(); pg.wait_for_timeout(300)
    check('cancelar la conserva', key('previous') is not None and pg.get_by_role('button', name='Recuperarla').count() == 1)
    pg.get_by_role('button', name='Borrarla').click(); pg.get_by_role('button', name='Borrar', exact=True).click(); pg.wait_for_timeout(500)
    check('borrarla la quita del móvil', key('previous') is None and pg.get_by_role('button', name='Recuperarla').count() == 0 and visible(pg, 'Copia anterior borrada'))
    check('sin tocar los datos actuales', len(pg.evaluate(READ)['transactions']) == n_tx)


@scenario('4. Importes con símbolo de moneda, paréntesis y signo final')
def s4(b):
    pg = new_page(b)
    seed_demo(pg)
    pg.goto(U + '#/settings/data'); pg.wait_for_timeout(300)
    csv = 'Fecha;Concepto;Importe\n01/10/2026;Café Imp;-1,50 €\n01/10/2026;Café Imp;-1,50 €\n02/10/2026;Nómina Imp;"1.234,56 EUR"\n03/10/2026;Recibo Imp;(45,20)\n04/10/2026;Otro Imp;45,20-\n05/10/2026;Raro Imp;abc\n'
    pg.set_input_files('input[aria-label="Elegir archivo CSV o Excel"]', files=[{'name': 'banco.csv', 'mimeType': 'text/csv', 'buffer': csv.encode()}]); pg.wait_for_timeout(400)
    check('vista previa: 5 nuevas', visible(pg, re.compile('5 nuevas, 0 ya existían')))
    check('la fila mala dice qué texto no entendió', visible(pg, re.compile('línea 7: Importe no válido \\(«abc»\\)')))
    pg.get_by_role('button', name='Importar 5').click(); pg.wait_for_timeout(600)
    txs = {t['merchant']: t['amountCents'] for t in pg.evaluate(READ)['transactions'] if t['merchant'].endswith(' Imp')}
    check('importes correctos', txs.get('Recibo Imp') == -4520 and txs.get('Otro Imp') == -4520 and txs.get('Nómina Imp') == 123456 and txs.get('Café Imp') == -150)


with sync_playwright() as p:
    b = p.chromium.launch()
    for run in (s1, s2, s3, s4):
        run(b)
    b.close()
check('sin errores de página en toda la ejecución', not errs)
print('\nERRORES DE PÁGINA:', errs)
print('FALLOS:', fails)
sys.exit(1 if fails else 0)
