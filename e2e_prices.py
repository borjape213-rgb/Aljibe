"""Actualización de precios bajo demanda, con el proveedor simulado (no usa internet).

Uso (con el servidor en marcha: python3 -m http.server 8765 -d dist):
    python3 e2e_prices.py [http://localhost:8765]
"""
import datetime, json, sys
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765').rstrip('/')
U = BASE + '/index.html'
KEY = 'CLAVE-SECRETA-123'
fails, errs, reqs = [], [], []
DAY = datetime.date.today().isoformat()  # los precios de ejemplo llegan hasta hoy: un cierre más antiguo se marcaría como obsoleto

READ = """() => new Promise((res, rej) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result ?? null); g.onerror = () => rej(g.error); }; r.onerror = () => rej(r.error); })"""
WRITE = """(s) => new Promise((res, rej) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(s, 'state'); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); })"""


def check(name, cond):
    print(('OK  ' if cond else 'FALLA'), name)
    if not cond:
        fails.append(name)


def daily(close):
    return {'Meta Data': {}, 'Time Series (Daily)': {DAY: {'4. close': str(close)}, '2000-01-03': {'4. close': '1'}}}


CL = {'air': 0, 'aapl': 0}


def mock(ctx, air, aapl):
    def av(route):
        url = route.request.url; reqs.append(url)
        body = daily(CL['air']) if 'AIR.PAR' in url else daily(CL['aapl']) if 'AAPL' in url else {'Error Message': 'Invalid API call'}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(body), headers={'access-control-allow-origin': '*'})
    def fx(route):
        reqs.append(route.request.url)
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'date': '2026-10-27', 'base': 'USD', 'quote': 'EUR', 'rate': 0.9}), headers={'access-control-allow-origin': '*'})
    ctx.route('https://www.alphavantage.co/**', av)
    ctx.route('https://api.frankfurter.dev/**', fx)


def start(b, air, aapl):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='es-ES', timezone_id='Europe/Madrid')
    mock(ctx, air, aapl)
    pg = ctx.new_page(); pg.set_default_timeout(5000)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(U + '?demo=1'); pg.wait_for_selector('.topbar'); pg.wait_for_timeout(700)
    return ctx, pg


def last_price(st, sid):
    return st['prices'][sid][-1]


with sync_playwright() as p:
    b = p.chromium.launch()

    print('\n# 1. Flujo normal: símbolo desde la ficha, valor en dólares, vista previa y aplicar')
    ctx, pg = start(b, 150, 200)
    st = pg.evaluate(READ)
    before = last_price(st, 's-world')['price']
    CL['air'] = round(before * 1.02, 2); CL['aapl'] = round(last_price(st, 's-tech')['price'] * 1.03 / 0.9, 2)
    A_EUR = CL['air']; T_EUR = CL['aapl'] * 0.9
    pg.goto(U + '#/holding/s-world'); pg.wait_for_selector('text=Símbolo y moneda')
    pg.get_by_role('button', name='Símbolo y moneda').click()
    pg.get_by_label('Símbolo para precios online').fill('air:epa')
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(300)
    st = pg.evaluate(READ)
    sec = next(x for x in st['securities'] if x['id'] == 's-world')
    check('el símbolo se guarda en mayúsculas', sec.get('symbol') == 'AIR:EPA' and sec.get('currency') == 'EUR')
    st2 = json.loads(json.dumps(st))
    for x in st2['securities']:
        if x['id'] == 's-tech': x['symbol'] = 'AAPL'; x['currency'] = 'USD'
    pg.evaluate(WRITE, st2)
    pg.goto(U + '#/investments'); pg.reload(); pg.wait_for_selector('text=Actualizar precios')
    check('sin pulsar nada no hay peticiones a proveedores', len(reqs) == 0)
    check('al principio dice que los precios son manuales', pg.get_by_text('Precios introducidos a mano').first.is_visible())
    pg.get_by_role('button', name='Actualizar precios').click()
    check('avisa de que 2 de 4 valores tienen símbolo', pg.get_by_text('2 de 4 valores con símbolo').first.is_visible())
    pg.get_by_label('Clave de Alpha Vantage').fill(KEY)
    pg.get_by_role('button', name='Actualizar', exact=True).click()
    pg.wait_for_selector('text=Aplicar', timeout=40000)
    check('vista previa antes de guardar: nada guardado todavía', last_price(pg.evaluate(READ), 's-world')['price'] == before)
    check('muestra el cierre de AIR', pg.get_by_text(f"{A_EUR:.2f}".replace('.', ',') + ' EUR').first.is_visible())
    check('el dólar se convierte con el cambio del BCE (USD → EUR a 0,9)', pg.get_by_text(f"{T_EUR:.2f}".replace('.', ',') + ' EUR').first.is_visible() or pg.get_by_text(f"{T_EUR:.4f}".rstrip('0').replace('.', ',') + ' EUR').first.is_visible())
    pg.get_by_role('button', name='Aplicar 2').click(); pg.wait_for_timeout(600)
    st = pg.evaluate(READ)
    check('precio de AIR guardado con la fecha del cierre', last_price(st, 's-world') == {'date': DAY, 'price': A_EUR})
    check('precio en dólares guardado ya convertido a euros', abs(last_price(st, 's-tech')['price'] - T_EUR) < 1e-4 and last_price(st, 's-tech')['date'] == DAY)
    check('se anota la fecha de última actualización', all(x.get('updatedAt') for x in st['securities'] if x['id'] in ('s-world', 's-tech')) and not any(x.get('updatedAt') for x in st['securities'] if x['id'] == 's-bond'))
    check('la pantalla muestra la última actualización', pg.get_by_text('Precios actualizados el').first.is_visible())
    check('la clave solo viajó al proveedor de precios', all((KEY in u) == ('alphavantage' in u) for u in reqs) and any(KEY in u for u in reqs))
    blob = json.dumps(st)
    store = pg.evaluate("JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])")
    check('la clave no está en la base de datos ni en el almacenamiento del navegador', KEY not in blob and KEY not in store)
    pg.goto(U + '#/holding/s-world'); pg.wait_for_selector('text=precio actualizado el')
    check('la ficha muestra símbolo y fecha de actualización', pg.get_by_text('AIR:EPA (EUR)').first.is_visible())
    ctx.close()

    print('\n# 2. Salto grande sin marcar y valores sin conexión')
    reqs.clear()
    ctx, pg = start(b, 0, 0)
    st = json.loads(json.dumps(pg.evaluate(READ)))
    CL['air'] = round(last_price(st, 's-world')['price'] * 3, 2)
    for x in st['securities']:
        if x['id'] == 's-world': x['symbol'] = 'AIR:EPA'
    pg.evaluate(WRITE, st); pg.goto(U + '#/investments'); pg.reload(); pg.wait_for_selector('text=Actualizar precios')
    pg.get_by_role('button', name='Actualizar precios').click()
    pg.get_by_label('Clave de Alpha Vantage').fill(KEY)
    pg.get_by_role('button', name='Actualizar', exact=True).click()
    pg.wait_for_selector('text=Salto de más del 30 %', timeout=30000)
    check('un salto de más del 30 % llega sin marcar', pg.get_by_role('button', name='Aplicar 0').is_visible())
    pg.get_by_role('button', name='Descartar').click(); pg.wait_for_timeout(400)
    pg.get_by_role('button', name='Actualizar precios').click()
    check('la clave se recuerda solo mientras la app sigue abierta', pg.get_by_label('Clave de Alpha Vantage').input_value() == KEY)
    ctx.set_offline(True)
    pg.get_by_role('button', name='Actualizar', exact=True).click()
    check('sin conexión avisa y no consulta', pg.get_by_text('Sin conexión a internet').first.is_visible())
    ctx.close()
    b.close()

print('\nERRORES DE PÁGINA:', errs)
print('FALLOS:', fails)
sys.exit(1 if fails or errs else 0)
