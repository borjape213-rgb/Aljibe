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
    pg.get_by_label(re.compile('Precio de compra por unidad')).fill('5,5')
    check('calcula el coste total al escribir', pg.get_by_text(re.compile(r'Coste total: 55,00')).first.is_visible())
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    st = pg.evaluate(READ)
    h = st['holdings'][-1]
    check('guarda el coste total (cantidad × precio unitario)', h['quantity'] == 10 and h['costBasisCents'] == 5500)
    pg.get_by_role('button', name='Añadir posición').first.click()
    pg.get_by_label('Cantidad (unidades)').fill('3')
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    check('sin precio de compra no hay coste', pg.evaluate(READ)['holdings'][-1]['costBasisCents'] is None)

    # al abrir una cuenta de inversión salen primero sus posiciones, sin transacciones
    pg.goto(U + '#/accounts?tab=investments'); pg.wait_for_selector('text=Cartera de fondos')
    pg.get_by_text('Cartera de fondos').first.click(); pg.wait_for_selector('section[aria-label="Posiciones de la cuenta"]')
    sec_txt = pg.locator('section[aria-label="Posiciones de la cuenta"]').inner_text()
    check('la cuenta de inversión muestra sus posiciones con precios y ganancia', 'Fondo Mundo Índice' in sec_txt and 'compra' in sec_txt and 'actual' in sec_txt)
    check('y no muestra transacciones ni «sin transacciones»', pg.get_by_text('Transacciones', exact=True).count() == 0 and pg.get_by_text('Sin transacciones').count() == 0)
    pg.get_by_role('button', name='Añadir', exact=True).click()
    check('«Añadir» abre el formulario con esa cuenta', pg.get_by_label('Cuenta').locator('option:checked').inner_text() == 'Cartera de fondos')
    pg.get_by_role('button', name='Cancelar').click()

    # S&P 500 de la captura: 63 uds, precio actual 203, compra 117,828
    ctx.close(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='es-ES', timezone_id='Europe/Madrid'); pg = ctx.new_page(); pg.set_default_timeout(5000)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(U); pg.wait_for_selector('.topbar'); pg.wait_for_timeout(600)
    pg.goto(U + '#/accounts'); pg.wait_for_timeout(300)
    pg.locator('button[aria-label*="cuenta" i]').first.click()
    pg.get_by_label('Nombre').fill('Broker'); pg.get_by_label('Tipo', exact=True).select_option(label='Inversiones'); pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(400)
    pg.goto(U + '#/investments'); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='Añadir posición').first.click()
    pg.get_by_label('Valor').select_option('__new'); pg.get_by_label('Nombre').fill('Amundi S&P 500'); pg.get_by_label('Símbolo', exact=True).fill('SPX'); pg.get_by_label('Precio actual').fill('203')
    pg.get_by_label('Cantidad (unidades)').fill('63'); pg.get_by_label(re.compile('Precio de compra por unidad')).fill('117,828')
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    row = pg.locator('section[aria-label="Posiciones"] a.row').first.inner_text().replace('\u00a0', ' ')
    check('muestra el precio de compra exacto, tal como se escribió', '117,828 €' in row and '203,00 €' in row and '63 uds' in row)
    check('valor 12.789,00 y ganancia 5.365,84', '12.789,00' in row and '+5.365,84' in row)
    check('el % de ganancia sale (72,2x %)', re.search(r'72,2[89] %', row) is not None)
    # el valor no cambia con el precio de compra; la ganancia sí
    pg.locator('section[aria-label="Posiciones"] a.row').first.click(); pg.wait_for_selector('text=Tus posiciones')
    pg.get_by_role('button', name='Editar', exact=True).click()
    check('al editar se ven los datos actuales', pg.get_by_label('Cantidad (unidades)').input_value() == '63' and pg.get_by_label(re.compile('Precio de compra por unidad')).input_value() == '117,828')
    pg.get_by_label(re.compile('Precio de compra por unidad')).fill('150'); pg.get_by_label('Cantidad (unidades)').fill('60')
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    h = pg.evaluate(READ)['holdings'][-1]
    check('la edición guarda cantidad, precio de compra y coste total', h['quantity'] == 60 and h['unitCost'] == 150 and h['costBasisCents'] == 900000)
    pg.goto(U + '#/investments'); pg.wait_for_selector('section[aria-label="Posiciones"]')
    row = pg.locator('section[aria-label="Posiciones"] a.row').first.inner_text()
    check('tras editar: valor 60 × 203 = 12.180,00 y ganancia 3.180,00', '12.180,00' in row and '3.180,00' in row)
    b.close()

print('\nERRORES DE PÁGINA:', errs)
print('FALLOS:', fails)
sys.exit(1 if fails or errs else 0)
