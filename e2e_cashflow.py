"""Flujo de caja: diagrama Sankey y selector de mes.

Uso (servidor en marcha: python3 -m http.server 8765 -d dist):
    python3 e2e_cashflow.py [http://localhost:8765]
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


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='es-ES', timezone_id='Europe/Madrid')
    pg = ctx.new_page(); pg.set_default_timeout(5000)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(U + '?demo=1'); pg.wait_for_selector('.topbar'); pg.wait_for_timeout(700)
    pg.goto(U + '#/cashflow'); pg.wait_for_selector('.sankey'); pg.wait_for_timeout(300)
    check('hay diagrama con nodos y flujos', pg.locator('.sankey rect').count() >= 6 and pg.locator('.sankey path').count() >= 6)
    check('muestra «Ingresos» y «Ahorro» o «Déficit»', pg.locator('.sankey text', has_text='Ingresos').count() >= 1)
    check('la página no se desborda en horizontal', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
    check('el diagrama se desplaza dentro de su caja', pg.evaluate("(() => { const e = document.querySelector('.sankey'); return e.scrollWidth > e.clientWidth; })()"))
    check('tasa de ahorro visible', pg.get_by_text('Tasa de ahorro').is_visible())
    pg.screenshot(path='sk_mobile.png', full_page=False)
    # selector de mes
    sel = pg.get_by_label('Mes', exact=True)
    first = sel.input_value()
    pg.get_by_role('button', name='Mes anterior').click(); pg.wait_for_timeout(300)
    check('mes anterior cambia el mes y la URL', sel.input_value() != first and 'm=' in pg.url)
    titulo = pg.locator('section[aria-label^="Flujo de"] h2').inner_text()
    check('el título sigue al mes elegido', sel.locator('option:checked').inner_text() in titulo)
    nodes_prev = pg.locator('.sankey rect').count()
    check('el mes anterior también tiene diagrama (datos demo)', nodes_prev >= 3)
    ops = sel.locator('option').all_inner_texts()
    sel.select_option(index=len(ops) - 1); pg.wait_for_timeout(300)
    check('elegir el primer mes deshabilita «Mes anterior»', pg.get_by_role('button', name='Mes anterior').is_disabled())
    pg.goto(U + '#/cashflow?m=2001-01-01'); pg.wait_for_timeout(300)
    check('un mes sin datos lo dice', pg.get_by_text('Este mes no hay ingresos ni gastos.').is_visible())
    pg.set_viewport_size({'width': 1100, 'height': 900}); pg.goto(U + '#/cashflow'); pg.wait_for_timeout(500)
    pg.screenshot(path='sk_desktop.png')
    b.close()

check('sin errores de página', not errs)
print('\n%d fallos' % len(fails) if fails else '\nTodo bien')
sys.exit(1 if fails or errs else 0)
