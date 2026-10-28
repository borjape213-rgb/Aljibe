"""Cuentas de inversión con subtipo Loans: solo saldo, sin movimientos ni posiciones.

Uso (con el servidor en marcha: python3 -m http.server 8765 -d dist):
    python3 e2e_accounts.py [http://localhost:8765]
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
    pg.goto(U + '#/accounts'); pg.wait_for_selector('text=Cuenta corriente')
    pg.get_by_role('button', name='Añadir cuenta').click() if pg.get_by_role('button', name='Añadir cuenta').count() else pg.locator('button[aria-label*="cuenta" i]').first.click()
    pg.get_by_label('Nombre').fill('Préstamos P2P')
    pg.get_by_label('Tipo', exact=True).select_option(label='Inversiones')
    check('con subtipo Fondos no pide saldo (sale de posiciones)', pg.get_by_text('sale de sus posiciones').first.is_visible())
    pg.get_by_label('Subtipo').select_option('Loans')
    check('con subtipo Loans pide el saldo', pg.get_by_label('Saldo (lo que te deben)').is_visible())
    pg.get_by_label('Saldo (lo que te deben)').fill('2.500,00')
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    st = pg.evaluate(READ)
    acc = next(a for a in st['accounts'] if a['name'] == 'Préstamos P2P')
    check('se guarda con el saldo indicado', acc['group'] == 'investments' and acc['subtype'] == 'Loans' and acc['balanceCents'] == 250000)
    pg.goto(U + '#/account/' + acc['id']); pg.wait_for_selector('text=Actualizar saldo')
    check('la ficha no muestra transacciones', pg.get_by_text('Transacciones', exact=True).count() == 0 and pg.get_by_text('Sin transacciones').count() == 0)
    check('la ficha no ofrece ver posiciones', pg.get_by_text('Ver posiciones').count() == 0)
    pg.get_by_role('button', name='Actualizar saldo').click()
    pg.get_by_label('Saldo (lo que te deben)').fill('3.000,00')
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    st = pg.evaluate(READ)
    acc = next(a for a in st['accounts'] if a['name'] == 'Préstamos P2P')
    check('el saldo se actualiza y queda en el histórico', acc['balanceCents'] == 300000 and len(acc.get('valuations', [])) >= 1 and acc['valuations'][-1]['cents'] == 300000)
    check('la ficha muestra el saldo nuevo', pg.get_by_text(re.compile(r'3\.?000,00')).first.is_visible())
    pg.goto(U + '#/investments'); pg.wait_for_selector('.topbar')
    pg.get_by_role('button', name='Añadir posición').first.click()
    opts = pg.get_by_label('Cuenta').locator('option').all_inner_texts()
    check('no se pueden añadir posiciones a una cuenta Loans', 'Préstamos P2P' not in opts and len(opts) > 0)
    b.close()

print('\nERRORES DE PÁGINA:', errs)
print('FALLOS:', fails)
sys.exit(1 if fails or errs else 0)
