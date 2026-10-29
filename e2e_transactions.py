"""Buscador de movimientos: tipo, rango de fechas, rango de importe y orden por importe.

Uso (con el servidor en marcha: python3 -m http.server 8765 -d dist):
    python3 e2e_transactions.py [http://localhost:8765]
"""
import re, sys
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765').rstrip('/')
U = BASE + '/index.html'
fails, errs = [], []


def check(name, cond):
    print(('OK  ' if cond else 'FALLA'), name)
    if not cond:
        fails.append(name)


def amounts(pg):
    """Importes visibles en la lista, como número con signo."""
    out = []
    for t in pg.locator('main .row .end').all_inner_texts():
        n = re.sub(r'[^0-9,\-−+]', '', t).replace('−', '-').replace(',', '.')
        try: out.append(float(n))
        except ValueError: pass
    return out


def open_filters(pg):
    if not pg.get_by_label('Desde el día').is_visible():
        pg.get_by_role('button', name=re.compile(r'^Filtros')).click()


def count(pg):
    return int(re.match(r'\d+', pg.locator('[aria-live=polite]').first.inner_text()).group())


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='es-ES', timezone_id='Europe/Madrid')
    pg = ctx.new_page(); pg.set_default_timeout(5000)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(U + '?demo=1'); pg.wait_for_selector('.topbar'); pg.wait_for_timeout(700)
    pg.goto(U + '#/transactions'); pg.wait_for_selector('text=transacciones'); pg.wait_for_timeout(300)
    total = count(pg)
    # tipo
    pg.goto(U + '#/transactions?type=out'); pg.wait_for_timeout(300)
    gastos = count(pg)
    check('solo gastos: todos los importes negativos', gastos > 0 and all(a < 0 for a in amounts(pg)))
    pg.goto(U + '#/transactions?type=in'); pg.wait_for_timeout(300)
    ing = count(pg)
    check('solo ingresos: todos positivos', ing > 0 and all(a > 0 for a in amounts(pg)))
    check('gastos + ingresos = total (sin cero)', gastos + ing <= total and gastos + ing >= total - 5)
    # desde la hoja de filtros
    pg.goto(U + '#/transactions'); pg.wait_for_timeout(300)
    open_filters(pg)
    pg.get_by_role('button', name='Gastos').click(); pg.wait_for_timeout(200)
    check('chip Gastos cambia la URL', 'type=out' in pg.url)
    pg.get_by_label('Importe desde (€)').fill('50'); pg.get_by_label('Importe hasta (€)').fill('200'); pg.wait_for_timeout(300)
    vals = [abs(a) for a in amounts(pg)]
    check('rango 50–200 €: todos dentro', len(vals) > 0 and all(50 <= v <= 200 for v in vals))
    pg.get_by_label('Importe hasta (€)').fill('abc'); pg.wait_for_timeout(200)
    check('importe no válido avisa', pg.get_by_text('No es un importe válido.').is_visible())
    pg.get_by_label('Importe hasta (€)').fill('')
    # fechas
    pg.goto(U + '#/transactions'); pg.wait_for_timeout(300)
    open_filters(pg)
    pg.get_by_label('Desde el día').fill('2026-10-01'); pg.get_by_label('Hasta el día').fill('2026-10-15'); pg.wait_for_timeout(300)
    n = count(pg)
    check('rango de fechas reduce los resultados', n < total)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    heads = pg.locator('main .sechead > span:first-child').all_inner_texts()
    check('los días mostrados caen en octubre 1–15', n == 0 or all(re.search(r'\b(\d{1,2})\b', h) and int(re.search(r'\b(\d{1,2})\b', h).group()) <= 15 for h in heads))
    # rango invertido
    pg.goto(U + '#/transactions?from=2026-10-20&to=2026-10-05'); pg.wait_for_timeout(300)
    open_filters(pg)
    check('rango de fechas invertido avisa', pg.get_by_text(re.compile('posterior al final')).is_visible())
    # orden por importe
    pg.goto(U + '#/transactions?type=out&sort=amount-desc'); pg.wait_for_timeout(300)
    v = [abs(a) for a in amounts(pg)]
    check('orden por importe: de mayor a menor gasto', len(v) > 5 and v == sorted(v, reverse=True))
    check('en orden por importe cada fila lleva su fecha y no hay cabeceras de día', pg.locator('main .sechead').count() == 0)
    pg.goto(U + '#/transactions?type=out&sort=amount-asc'); pg.wait_for_timeout(300)
    v = [abs(a) for a in amounts(pg)]
    check('orden por importe: de menor a mayor', len(v) > 5 and v == sorted(v))
    pg.locator('select[aria-label="Ordenar por"]').select_option('date-desc'); pg.wait_for_timeout(300)
    check('volver a fecha reagrupa por días', pg.locator('main .sechead').count() > 0 and 'sort=' not in pg.url)
    pg.screenshot(path='tx_sort.png')
    b.close()

check('sin errores de página', not errs)
print('\n%d fallos' % len(fails) if fails else '\nTodo bien')
sys.exit(1 if fails or errs else 0)
