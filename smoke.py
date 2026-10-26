import sys, json
from playwright.sync_api import sync_playwright
routes = {'S04':'#/','S06':'#/accounts','S08':'#/accounts','S09':'#/transactions','S13':'#/budget','S16':'#/cashflow','S17':'#/recurring','S22':'#/investments','S23':'#/investments?view=allocation','S11':'#/review','S25':'#/settings','S26':'#/settings/categories','S27':'#/settings/rules','S29':'#/settings/data','S05':'#/month-review','S25b':'#/settings/display'}
w=int(sys.argv[1]) if len(sys.argv)>1 else 390
h=844 if w<500 else 900
scheme=sys.argv[2] if len(sys.argv)>2 else 'light'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':w,'height':h},color_scheme=scheme,locale='es-ES',timezone_id='Europe/Madrid'); pg=ctx.new_page()
    pg.on('console',lambda m: errs.append((m.type,m.text)) if m.type in('error','warning') else None)
    pg.on('pageerror',lambda e: errs.append(('pageerror',str(e))))
    pg.goto('http://localhost:8765/index.html?demo=1'); pg.wait_for_selector('.topbar')
    for k,r in routes.items():
        pg.goto('http://localhost:8765/index.html'+r); pg.wait_for_timeout(350)
        suffix = '' if w<500 else '-1440'
        suffix += '' if scheme=='light' else '-dark'
        pg.screenshot(path=f'../clone-screens/{k}{suffix}.png', full_page=True)
    b.close()
print(json.dumps(errs,ensure_ascii=False,indent=1))
