"""Reglas con importe exacto: crear, editar, borrar y que se apliquen al añadir un movimiento.

Uso (con el servidor en marcha: python3 -m http.server 8765 -d dist):
    python3 e2e_rules.py [http://localhost:8765]
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
    pg.goto(U + '#/settings/rules'); pg.wait_for_selector('text=Nueva regla')
    # solo importe, gasto
    pg.get_by_label(re.compile('El comerciante contiene')).fill('')
    pg.get_by_label('Importe exacto (opcional)').fill('124,75')
    check('con un importe sin signo aparece «Se aplica a»', pg.get_by_label('Se aplica a').is_visible())
    pg.get_by_label('Se aplica a').select_option('out')
    pg.get_by_role('button', name='Crear regla').click(); pg.wait_for_timeout(400)
    st = pg.evaluate(READ); r = st['rules'][-1]
    check('regla solo con importe: guardada (124,75 € solo gastos)', r['merchantContains'] == '' and r['amountCents'] == 12475 and r['amountDirection'] == 'out')
    check('se ve en la lista', pg.get_by_text(re.compile('importe 124,75')).first.is_visible())
    # texto + importe con signo
    pg.get_by_label(re.compile('El comerciante contiene')).fill('comision')
    pg.get_by_label('Importe exacto (opcional)').fill('-60')
    check('con «-» delante no pregunta la dirección', pg.get_by_label('Se aplica a').count() == 0)
    pg.get_by_role('button', name='Crear regla').click(); pg.wait_for_timeout(400)
    r2 = pg.evaluate(READ)['rules'][-1]
    check('el «-» significa solo gastos', r2['merchantContains'] == 'comision' and r2['amountCents'] == 6000 and r2['amountDirection'] == 'out')
    # sin texto ni importe no se puede
    pg.get_by_role('button', name='Crear regla').click()
    check('una regla sin condiciones se rechaza', pg.get_by_text(re.compile('Escribe el texto que debe contener')).first.is_visible())
    # importe no válido
    pg.get_by_label('Importe exacto (opcional)').fill('abc'); pg.get_by_role('button', name='Crear regla').click()
    check('un importe no válido se rechaza', pg.get_by_text(re.compile('importe válido')).first.is_visible())
    pg.get_by_label('Importe exacto (opcional)').fill('')
    # editar
    pg.get_by_role('button', name='Editar').nth(-1).click()
    check('al editar se rellena el formulario', pg.get_by_label(re.compile('El comerciante contiene')).input_value() == 'comision' and pg.get_by_label('Importe exacto (opcional)').input_value() == '-60' or pg.get_by_label('Importe exacto (opcional)').input_value() == '60')
    pg.get_by_label('Importe exacto (opcional)').fill('75,50'); pg.get_by_label('Se aplica a').select_option('in')
    pg.get_by_role('button', name='Guardar cambios').click(); pg.wait_for_timeout(400)
    rules = pg.evaluate(READ)['rules']
    check('la edición cambia la misma regla, sin duplicarla', len(rules) == len(st['rules']) + 1 and rules[-1]['amountCents'] == 7550 and rules[-1]['amountDirection'] == 'in' and rules[-1]['id'] == r2['id'])
    # se aplica al añadir un movimiento
    pg.goto(U + '#/transactions'); pg.wait_for_selector('.topbar')
    pg.locator('button[aria-label*="transacción" i], button[aria-label*="movimiento" i]').first.click()
    pg.get_by_label('Importe').fill('-124,75') if pg.get_by_label('Importe').count() else None
    pg.get_by_label(re.compile('Comerciante|Descripción')).first.fill('Cuota prestamo')
    pg.get_by_role('button', name='Guardar').click(); pg.wait_for_timeout(500)
    last = pg.evaluate(READ)['transactions'][0]
    check('la regla de importe se aplica a un movimiento nuevo (categoría puesta)', last['amountCents'] == -12475 and last['categoryId'] == next(x for x in rules if x.get('amountCents') == 12475)['setCategoryId'])
    # borrar
    pg.goto(U + '#/settings/rules'); pg.wait_for_selector('text=Nueva regla')
    n = len(pg.evaluate(READ)['rules'])
    pg.get_by_role('button', name=re.compile('Borrar regla importe 124,75')).click(); pg.wait_for_timeout(400)
    check('borrar quita la regla', len(pg.evaluate(READ)['rules']) == n - 1)
    b.close()

print('\nERRORES DE PÁGINA:', errs)
print('FALLOS:', fails)
sys.exit(1 if fails or errs else 0)
