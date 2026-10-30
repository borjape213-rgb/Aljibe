"""Aplicar reglas a los movimientos existentes y traspasos en recurrentes.

Uso (servidor en marcha: python3 -m http.server 8765 -d dist):
    python3 e2e_apply.py [http://localhost:8765]
"""
import re, sys
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765').rstrip('/')
U = BASE + '/index.html'
fails, errs = [], []
READ = """() => new Promise((res, rej) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); }; r.onerror = () => rej(r.error); })"""


def check(name, cond):
    print(('OK  ' if cond else 'FALLA'), name)
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='es-ES', timezone_id='Europe/Madrid')
    pg = ctx.new_page(); pg.set_default_timeout(5000)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(U + '?demo=1'); pg.wait_for_selector('.topbar'); pg.wait_for_timeout(700)
    st = pg.evaluate(READ)
    # un comercio que ya existe y una categoría distinta de la que tiene
    t0 = next(t for t in st['transactions'] if t['amountCents'] < 0 and not t['splits'] and t['categoryId'] not in ('c-transfer', 'c-none') and t['merchant'].strip())
    word = t0['merchant'].split()[0]
    afectados = [t for t in st['transactions'] if word.lower() in t['merchant'].lower()]
    target = 'c-fun' if t0['categoryId'] != 'c-fun' else 'c-shopping'
    pg.goto(U + '#/settings/rules'); pg.wait_for_selector('text=Nueva regla')
    check('sin reglas no hay botón de aplicar', pg.get_by_role('button', name=re.compile('Aplicar a mis movimientos')).count() == 0)
    pg.get_by_label(re.compile('El comerciante contiene')).fill(word)
    pg.locator('select[aria-label="Categoría"]').select_option(target)
    pg.get_by_role('button', name='Crear regla').click(); pg.wait_for_timeout(400)
    btn = pg.get_by_role('button', name=re.compile('Aplicar a mis movimientos'))
    check('aparece el botón con el recuento', btn.is_visible())
    n = int(re.search(r'\((\d+)\)', btn.inner_text()).group(1))
    esperado = len([t for t in afectados if t['categoryId'] != target and not t['splits']])
    check('el recuento son los movimientos que cambian (%d)' % esperado, n == esperado and n > 0)
    btn.click()
    check('pide confirmación antes de cambiar', pg.get_by_text(re.compile('también de los que categorizaste a mano')).is_visible())
    pg.get_by_role('button', name='Cancelar').first.click(); pg.wait_for_timeout(200)
    st = pg.evaluate(READ)
    check('cancelar no cambia nada', all(t['categoryId'] != target for t in st['transactions'] if t['id'] == t0['id']))
    pg.get_by_role('button', name=re.compile('Aplicar a mis movimientos')).click(); pg.get_by_role('button', name='Aplicar ahora').click(); pg.wait_for_timeout(500)
    st = pg.evaluate(READ)
    ok = [t for t in st['transactions'] if word.lower() in t['merchant'].lower() and not t['splits']]
    check('todos los movimientos con «%s» tienen la categoría de la regla' % word, len(ok) > 0 and all(t['categoryId'] == target for t in ok))
    check('ahora dice que ya cumplen las reglas', pg.get_by_text('Tus movimientos ya cumplen todas las reglas.').is_visible())
    pg.screenshot(path='apply.png')
    # recurrentes con un traspaso mensual de 800 €
    st = pg.evaluate(READ)
    acc = [a['id'] for a in st['accounts']][:2]
    today = __import__('datetime').date(2026, 10, 30)
    txs = []
    for i, (y, m, d) in enumerate([(2026, 5, 15), (2026, 6, 15), (2026, 7, 17), (2026, 8, 14), (2026, 9, 15), (2026, 10, 15)]):
        date = '%d-%02d-%02d' % (y, m, d)
        txs.append({'id': 'tr-o%d' % i, 'date': date, 'amountCents': -80000, 'merchant': 'Traspaso mensual ahorro', 'notes': '', 'accountId': acc[0], 'categoryId': 'c-transfer', 'splits': []})
        txs.append({'id': 'tr-i%d' % i, 'date': date, 'amountCents': 80000, 'merchant': 'Traspaso desde corriente', 'notes': '', 'accountId': acc[1], 'categoryId': 'c-transfer', 'splits': []})
    st['transactions'] += txs
    st['rules'] = [{k: v for k, v in r.items() if v is not None} for r in st['rules']]  # Playwright convierte undefined en null
    pg.evaluate("""(s) => new Promise((res, rej) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(s, 'state'); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }; })""", st)
    pg.goto(U + '#/recurring'); pg.reload(); pg.wait_for_timeout(1500); pg.screenshot(path='rec.png'); pg.wait_for_selector('.topbar')
    check('el traspaso de 800 € aparece entre los detectados', pg.get_by_text('Traspaso mensual ahorro').first.is_visible())
    check('y se marca como traspaso', pg.get_by_text(re.compile('día 15 · traspaso')).first.is_visible())
    check('la entrada en la otra cuenta no sale duplicada', pg.get_by_text('Traspaso desde corriente').count() == 0)
    b.close()

check('sin errores de página', not errs)
print('\n%d fallos' % len(fails) if fails else '\nTodo bien')
sys.exit(1 if fails or errs else 0)
