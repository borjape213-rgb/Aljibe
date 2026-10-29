"""Posiciones: cantidad y precio unitario de compra (el total se calcula), y su listado con precios unitarios, valor y ganancia.

Uso (con el servidor en marcha: python3 -m http.server 8765 -d dist):
    python3 e2e_positions.py [http://localhost:8765]
"""
import re, sys
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765').rstrip('/')
U = BASE + '/index.html'
fails, errs = [], []
READ = """() => new Promise((res, rej) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result ?? null); g.onerror = () => rej(g.error); }; r.onerror = () => rej(r.error); })"""


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
    pg.goto(U + '#/investments'); pg.wait_for_selector('section[aria-label="Posiciones"]')
    first = pg.locator('section[aria-label="Posiciones"] a.row').first
    txt = first.inner_text()
    check('el listado muestra cantidad, compra y actual', re.search(r'uds · compra .*€ · actual .*€', txt) is not None)
    check('y a la derecha ganancia o pérdida con su %', re.search(r'[+−][\d.,]+\s*€', txt) is not None and re.search(r'\([+−][\d.,]+ %\)', txt) is not None)
    pg.get_by_role('button', name='Añadir posición').first.click()
    pg.get_by_label('Valor').select_option(index=0)
    pg.get_by_label('Cantidad (unidades)').fill('10')
    pg.get_by_label('Precio de compra por unidad (opcional)').fill('5,5')
    check('calcula el coste total al escribir', pg.get_by_text(re.compile(r'Coste total: 55,00')).first.is_visible())
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    st = pg.evaluate(READ)
    h = st['holdings'][-1]
    check('guarda el coste total (cantidad × precio unitario)', h['quantity'] == 10 and h['costBasisCents'] == 5500)
    pg.get_by_role('button', name='Añadir posición').first.click()
    pg.get_by_label('Cantidad (unidades)').fill('3')
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    check('sin precio de compra no hay coste', pg.evaluate(READ)['holdings'][-1]['costBasisCents'] is None)
    b.close()

print('\nERRORES DE PÁGINA:', errs)
print('FALLOS:', fails)
sys.exit(1 if fails or errs else 0)
