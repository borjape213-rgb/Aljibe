"""Valores en otra moneda (p. ej. NVIDIA en USD): precios y coste en su moneda, totales en euros, cambio online simulado.

Uso (con el servidor en marcha: python3 -m http.server 8765 -d dist):
    python3 e2e_fx.py [http://localhost:8765]
"""
import json, re, sys
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765').rstrip('/')
U = BASE + '/index.html'
fails, errs = [], []
READ = """() => new Promise((res, rej) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result ?? null); g.onerror = () => rej(g.error); }; r.onerror = () => rej(r.error); })"""
WRITE = """(s) => new Promise((res, rej) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(s, 'state'); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); })"""


def check(name, cond):
    print(('OK  ' if cond else 'FALLA'), name)
    if not cond:
        fails.append(name)


def page(b, demo=False):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='es-ES', timezone_id='Europe/Madrid')
    ctx.route('https://api.frankfurter.dev/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'base': 'USD', 'quote': 'EUR', 'rate': 0.9}), headers={'access-control-allow-origin': '*'}))
    pg = ctx.new_page(); pg.set_default_timeout(5000)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(U + ('?demo=1' if demo else '')); pg.wait_for_selector('.topbar'); pg.wait_for_timeout(700)
    return ctx, pg


def norm(t):
    return t.replace(' ', ' ').replace(' ', ' ')


with sync_playwright() as p:
    b = p.chromium.launch()

    print('\n# 1. Alta de NVIDIA en dólares')
    ctx, pg = page(b)
    pg.goto(U + '#/accounts'); pg.wait_for_timeout(300)
    pg.locator('button[aria-label*="cuenta" i]').first.click()
    pg.get_by_label('Nombre').fill('Broker'); pg.get_by_label('Tipo', exact=True).select_option(label='Inversiones'); pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(400)
    pg.goto(U + '#/investments'); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='Añadir posición').first.click()
    pg.get_by_label('Valor').select_option('__new'); pg.get_by_label('Nombre').fill('NVIDIA'); pg.get_by_label('Símbolo', exact=True).fill('NVDA')
    pg.get_by_label('Moneda en la que cotiza').fill('usd')
    check('al elegir USD pide el cambio y lo ofrece traer online', pg.get_by_role('button', name=re.compile('Obtener el cambio de hoy')).is_visible())
    pg.get_by_role('button', name=re.compile('Obtener el cambio de hoy')).click(); pg.wait_for_timeout(500)
    check('el cambio online rellena 0,9', pg.get_by_label(re.compile('Cambio actual')).input_value() == '0,9')
    check('las etiquetas hablan de USD', pg.get_by_label('Precio actual (USD)').is_visible() and pg.get_by_label(re.compile(r'Precio de compra por unidad \(USD')).is_visible())
    pg.get_by_label('Precio actual (USD)').fill('200'); pg.get_by_label('Cantidad (unidades)').fill('10')
    pg.get_by_label(re.compile(r'Precio de compra por unidad \(USD')).fill('150')
    pg.get_by_label(re.compile('Cambio al comprar')).fill('0,92')
    check('el coste total se calcula en euros con el cambio de la compra', pg.get_by_text(re.compile(r'Coste total: 1\.380,00')).first.is_visible())
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    st = pg.evaluate(READ)
    sec = st['securities'][-1]; h = st['holdings'][-1]
    check('el precio se guarda convertido a euros (200 USD × 0,9 = 180)', abs(st['prices'][sec['id']][-1]['price'] - 180) < 1e-9 and sec['currency'] == 'USD' and sec['fxRate'] == 0.9)
    check('el coste y los datos de la compra', h['unitCost'] == 150 and h['costFx'] == 0.92 and h['costBasisCents'] == 138000)
    row = norm(pg.locator('section[aria-label="Posiciones"] a.row').first.inner_text())
    check('el listado enseña compra y actual en dólares', '150,00' in row and '200,00' in row and 'US$' in row and 'compra' in row)
    check('y el valor total y la ganancia en euros', '1.800,00 €' in row and '+420,00 €' in row)
    pg.locator('section[aria-label="Posiciones"] a.row').first.click(); pg.wait_for_selector('text=Tus posiciones')
    head = norm(pg.locator('section[aria-label="Precio"]').inner_text())
    check('la ficha muestra el precio en dólares y su equivalente en euros', '200,00' in head and 'US$' in head and '180,00 €' in head)
    pg.get_by_role('button', name='Actualizar precio').click()
    check('el precio manual se pide en dólares', pg.get_by_label('Precio por unidad (USD)').is_visible())
    pg.get_by_label('Precio por unidad (USD)').fill('210'); pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(400)
    check('y se guarda en euros (210 × 0,9 = 189)', abs(pg.evaluate(READ)['prices'][sec['id']][-1]['price'] - 189) < 1e-9)
    pg.get_by_role('button', name='Editar', exact=True).click()
    check('al editar vuelve a verse el precio de compra en dólares y su cambio', pg.get_by_label(re.compile(r'Precio de compra por unidad \(USD')).input_value() == '150' and pg.get_by_label(re.compile('Cambio al comprar')).input_value() == '0,92')
    ctx.close()

    print('\n# 2. Valor en dólares de una versión anterior (sin cambio guardado)')
    ctx, pg = page(b, demo=True)
    st = json.loads(json.dumps(pg.evaluate(READ)))
    for x in st['securities']:
        if x['id'] == 's-tech': x['currency'] = 'USD'
    old = st['prices']['s-tech'][-1]['price']
    pg.evaluate(WRITE, st); pg.goto(U + '#/investments'); pg.reload(); pg.wait_for_selector('section[aria-label="Posiciones"]')
    check('avisa de que falta el cambio', pg.get_by_text('Falta el cambio de moneda').first.is_visible())
    pg.goto(U + '#/holding/s-tech'); pg.wait_for_selector('text=Tus posiciones')
    pg.get_by_role('button', name='Símbolo y moneda').click()
    pg.get_by_label(re.compile('Cambio actual')).fill('0,5')
    check('ofrece convertir los precios ya guardados', pg.get_by_text(re.compile('convertirlos a EUR')).first.is_visible())
    pg.get_by_label(re.compile('convertirlos a EUR')).check(); pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    st2 = pg.evaluate(READ)
    check('los precios guardados se convierten con el cambio', abs(st2['prices']['s-tech'][-1]['price'] - old * 0.5) < 1e-6 and len(st2['prices']['s-tech']) == len(st['prices']['s-tech']))
    check('el cambio queda en el valor', next(x for x in st2['securities'] if x['id'] == 's-tech')['fxRate'] == 0.5)
    b.close()

print('\nERRORES DE PÁGINA:', errs)
print('FALLOS:', fails)
sys.exit(1 if fails or errs else 0)
