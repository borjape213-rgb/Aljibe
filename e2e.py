import re, sys, json
from playwright.sync_api import sync_playwright
errs=[]; fails=[]
def check(name, cond):
    print(('OK  ' if cond else 'FALLA'), name)
    if not cond: fails.append(name)
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},locale='es-ES',timezone_id='Europe/Madrid'); pg=ctx.new_page()
    pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: errs.append(str(e)))
    U='http://localhost:8765/index.html'
    pg.goto(U+'?demo=1'); pg.wait_for_selector('.topbar')
    # 1 alta de transacción: validación y éxito
    pg.goto(U+'#/transactions'); pg.get_by_role('button',name='Añadir transacción').click()
    pg.get_by_role('button',name='Guardar').click()
    check('validación comerciante', pg.get_by_text('Escribe un comerciante.').is_visible())
    check('validación importe', pg.get_by_text('Escribe un importe válido distinto de cero').is_visible())
    pg.get_by_label('Comerciante',exact=True).fill('Prueba Café'); pg.get_by_label('Importe',exact=True).fill('12,50')
    pg.get_by_role('button',name='Guardar').click(); pg.wait_for_timeout(300)
    check('transacción creada', pg.get_by_text('Prueba Café').first.is_visible())
    # 2 detalle + dividir
    pg.get_by_text('Prueba Café').first.click(); pg.wait_for_timeout(200)
    pg.get_by_role('link',name='Dividir').click(); pg.wait_for_timeout(200)
    pg.get_by_label('Importe').nth(0).fill('10'); pg.get_by_label('Importe').nth(1).fill('1')
    check('aviso falta repartir', pg.get_by_text('Faltan 1,50').is_visible())
    check('guardar deshabilitado', pg.get_by_role('button',name='Guardar').is_disabled())
    pg.get_by_label('Importe').nth(1).fill('2,50')
    check('suma ok', pg.get_by_text('Las partes suman el total.').is_visible())
    pg.get_by_role('button',name='Guardar').click(); pg.wait_for_timeout(300)
    check('dividida', pg.get_by_text('Dividida en 2 partes.').is_visible())
    # 3 presupuesto: editar con arrastre
    pg.goto(U+'#/budget'); pg.wait_for_timeout(300)
    pg.get_by_role('button',name=re.compile('^Supermercado:')).click()
    pg.get_by_label(re.compile('Presupuesto de')).fill('abc'); pg.get_by_role('button',name='Guardar').click()
    check('validación presupuesto', pg.get_by_text('Escribe un importe válido, por ejemplo 250,00.').is_visible())
    pg.get_by_label(re.compile('Presupuesto de')).fill('600'); pg.get_by_role('button',name='Guardar').click(); pg.wait_for_timeout(300)
    check('presupuesto actualizado', pg.get_by_text('600,00 €').first.is_visible())
    # 4 importación CSV idempotente
    pg.goto(U+'#/settings/data'); open('/tmp/imp.csv','w').write('Fecha;Concepto;Importe\n01/10/2026;Café Imp;-1,50\n01/10/2026;Café Imp;-1,50\n02/10/2026;Ingreso Imp;"1.234,56"\n31/02/2026;Mal;1\n')
    pg.set_input_files('input[aria-label="Elegir archivo CSV o Excel"]','/tmp/imp.csv'); pg.wait_for_timeout(300)
    check('vista previa 3 nuevas', pg.get_by_text(re.compile('3 nuevas, 0 ya existían')).is_visible())
    pg.get_by_role('button',name='Importar 3').click(); pg.wait_for_timeout(300)
    pg.set_input_files('input[aria-label="Elegir archivo CSV o Excel"]','/tmp/imp.csv'); pg.wait_for_timeout(300)
    check('segunda importación sin duplicados', pg.get_by_text(re.compile('0 nuevas, 3 ya existían')).is_visible())
    # 5 revisión
    pg.goto(U+'#/review'); pg.wait_for_timeout(200)
    n0=int(re.search(r'(\d+) por revisar', pg.locator('h1').inner_text()).group(1))
    pg.get_by_role('button',name='Marcar como revisada').click(); pg.wait_for_timeout(200)
    n1=int(re.search(r'(\d+) por revisar', pg.locator('h1').inner_text()).group(1))
    check('revisión baja uno', n1==n0-1)
    # 6 teclado: Tab hasta enlace del menú y abrir con Enter
    pg.goto(U+'#/accounts'); pg.keyboard.press('Tab'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    check('menú con teclado', pg.get_by_role('navigation',name='Menú').is_visible())
    pg.keyboard.press('Escape')
    # 7 cuenta: crear y borrar
    pg.goto(U+'#/accounts'); pg.get_by_role('button',name='Añadir cuenta').click()
    pg.get_by_role('button',name='Guardar').click()
    check('validación nombre cuenta', pg.get_by_text('Escribe un nombre para la cuenta.').is_visible())
    pg.get_by_label('Nombre',exact=True).fill('Cuenta nueva con un nombre muy largo para probar el recorte en la fila de la lista de cuentas'); pg.get_by_label('Saldo actual',exact=True).fill('1.250,00')
    pg.get_by_role('button',name='Guardar').click(); pg.wait_for_timeout(300)
    check('cuenta creada', pg.get_by_text('Cuenta nueva con un nombre muy largo').first.is_visible())
    # 8 persistencia tras recarga
    pg.wait_for_timeout(500); pg.reload(); pg.wait_for_selector('.topbar'); pg.goto(U+'#/accounts'); pg.wait_for_timeout(300)
    check('persiste tras recargar', pg.get_by_text('Cuenta nueva con un nombre muy largo').first.is_visible())
    # 8b importación Excel
    pg.goto(U+'#/settings/data'); pg.set_input_files('input[aria-label="Elegir archivo CSV o Excel"]','fixtures/banco.xlsx'); pg.wait_for_timeout(500)
    check('xlsx vista previa 5 nuevas', pg.get_by_text(re.compile('5 nuevas, 0 ya existían')).is_visible())
    pg.get_by_role('button',name='Importar 5').click(); pg.wait_for_timeout(300)
    pg.set_input_files('input[aria-label="Elegir archivo CSV o Excel"]','fixtures/banco.xlsx'); pg.wait_for_timeout(500)
    check('xlsx segunda vez sin duplicados', pg.get_by_text(re.compile('0 nuevas, 5 ya existían')).is_visible())
    # 8c revisión mensual
    pg.goto(U+'#/month-review'); pg.wait_for_timeout(400)
    check('revisión página 1', pg.get_by_text('Página 1 de 5').count()>=0 and pg.get_by_role('heading',name='Resumen').is_visible())
    for _ in range(4): pg.get_by_role('button',name='Siguiente',exact=True).click(); pg.wait_for_timeout(250)
    check('revisión última página', pg.get_by_text('5 de 5').is_visible())
    pg.get_by_role('button',name='Marcar el mes como revisado').click(); pg.wait_for_timeout(200)
    check('mes revisado', pg.get_by_text('Este mes ya está revisado').is_visible())
    # 8d reordenar widgets y barra
    pg.goto(U+'#/settings/display'); pg.wait_for_timeout(250)
    for _ in range(3): pg.get_by_role('button',name='Subir Recurrentes').click(); pg.wait_for_timeout(120)
    nav=[a.inner_text().strip().split('\n')[-1] for a in pg.locator('nav[aria-label="Principal"] a').all()]
    check('barra reordenada ('+','.join(nav)+')', 'Recurrentes' in nav and 'Presupuesto' not in nav)
    pg.get_by_role('button',name='Subir Presupuesto').first.click(); pg.wait_for_timeout(120)
    pg.goto(U+'#/'); pg.wait_for_timeout(300)
    titles=[h.inner_text() for h in pg.locator('main h2').all()]
    check('inicio con orden de widgets', len(titles)>3)
    # 8e aviso de copia a 30 días
    pg.evaluate("""() => new Promise((res) => { const r = indexedDB.open('aljibe'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv','readwrite'); const st = tx.objectStore('kv'); const g = st.get('state'); g.onsuccess = () => { const s = g.result; s.settings.createdAt = '2026-01-01'; delete s.settings.lastBackupAt; st.put(s,'state'); }; tx.oncomplete = () => res(); }; })""")
    pg.reload(); pg.wait_for_selector('.topbar'); pg.goto(U+'#/'); pg.wait_for_timeout(400)
    check('aviso de copia', pg.get_by_text(re.compile('copia de seguridad')).first.is_visible())
    # 9 estado vacío
    pg.goto(U+'#/settings/data'); pg.get_by_role('button',name='Vaciar todo').click(); pg.get_by_role('button',name='Vaciar',exact=True).click(); pg.wait_for_timeout(300)
    for r,t in [('#/','Aquí todavía no hay nada'),('#/accounts','Aún no tienes cuentas'),('#/transactions','Todavía no has apuntado nada'),('#/cashflow','Sin movimientos'),('#/investments','Sin posiciones')]:
        pg.goto(U+r); pg.wait_for_timeout(250); check('vacío '+r, pg.get_by_text(t).first.is_visible())
    pg.goto(U+'#/budget'); pg.wait_for_timeout(250); check('vacío presupuesto', pg.get_by_text('Este mes aún no tiene presupuesto').is_visible())
    pg.goto(U+'#/recurring'); pg.wait_for_timeout(250); check('vacío recurrentes', pg.get_by_text('Sin recurrentes').first.is_visible() or pg.get_by_text('Nada en esta lista').first.is_visible())
    pg.goto(U+'#/account/nope'); check('cuenta inexistente', pg.get_by_text('No encontramos esa cuenta').is_visible())
    pg.goto(U+'#/zzz'); check('ruta desconocida', pg.get_by_text('Esa pantalla no existe').is_visible())
    # 10 primer arranque vacío con guía (contexto nuevo, sin ?demo)
    ctx2=b.new_context(viewport={'width':390,'height':844},locale='es-ES'); p2=ctx2.new_page(); p2.on('pageerror',lambda e: errs.append(str(e)))
    p2.goto(U); p2.wait_for_selector('.topbar'); p2.wait_for_timeout(300)
    check('guía de primeros pasos', p2.get_by_role('heading',name='Aquí todavía no hay nada').is_visible() and p2.get_by_text('Tres pasos para empezar').is_visible())
    p2.get_by_role('button',name='Probar con datos de ejemplo').click(); p2.wait_for_timeout(400)
    check('ejemplo desde la guía', p2.get_by_text('Patrimonio neto').first.is_visible())
    b.close()
print('ERRORES DE CONSOLA:', errs)
print('FALLOS:', fails)
