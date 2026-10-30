# Aljibe (PWA personal)

Finanzas personales con los datos en tu móvil (IndexedDB). Sin cuenta, sin servidor, sin suscripción.

## Uso

- Primer arranque: vacío, con una guía de tres pasos. Añade `?demo=1` a la dirección la primera vez para cargar datos de ejemplo (o usa el botón de la guía).
- Importar: Ajustes, Datos y copia. Acepta `.csv`, `.xlsx` y `.xls` (primera hoja) con encabezados de fecha, concepto e importe (o débito y crédito). Si hay fecha operativa y fecha valor, usa la operativa. Lee titular y saldo del encabezado del extracto (probado con el formato de Banc Sabadell). Importar el mismo archivo dos veces no duplica movimientos.
- Buscar movimientos: texto, cuenta, categoría y estado, y además tipo (gastos o ingresos), rango de fechas (desde/hasta, inclusivos) y rango de importe (sin signo, inclusivo). Se puede ordenar por fecha o por importe, de mayor a menor o al revés; al ordenar por importe la lista deja de agruparse por día y cada fila muestra su fecha. Todo vive en la URL, así que se puede guardar como marcador.
- Reglas: en Ajustes → Reglas y etiquetas, «Aplicar a mis movimientos» aplica todas las reglas a lo ya guardado (muestra cuántos cambian y pide confirmación; las transacciones divididas conservan sus partes).
- Recurrentes: también detecta traspasos entre tus cuentas si son del mismo importe exacto cada mes y el día no se desvía más de 2. Solo cuenta la salida (la entrada en la otra cuenta es el mismo movimiento) y no suma como gasto previsto del mes.
- Precios: Inversiones, «Actualizar precios». Solo cuando lo pides y con conexión. Usa Alpha Vantage con tu clave gratuita (se pega cada vez; nunca se guarda ni entra en las copias) y el tipo de cambio del BCE (Frankfurter) para valores en otra moneda. Cada valor lleva un símbolo (p. ej. `AIR:EPA`, o `AIR.PAR` tal cual) y su moneda, en la ficha del valor. Los valores que cotizan en otra moneda (p. ej. USD) se escriben y se ven en su moneda, con su tipo de cambio guardado (se puede traer el de hoy del BCE); los totales y la ganancia salen en euros. El % de ganancia de cada posición se corta a dos decimales, como lo enseña el broker (72,285 → 72,28), en vez de redondearse; los importes sí se redondean a céntimos. Se ve una vista previa antes de guardar. El plan gratuito limita las consultas (unas 25 al día y 5 por minuto).
- Copia de seguridad: descarga el JSON desde Ajustes. Hay un aviso en Inicio a los 30 días.

## Desarrollo

```
npm install
npm run build                      # genera dist/ (no se versiona: lo crea el build y la CI)
npm test                           # lógica de dinero, presupuesto, importación y Excel (.xlsx y .xls)
npm run typecheck                  # tipos de src/logic (las pantallas aún no se comprueban)
python3 -m http.server -d dist 8765
python3 e2e.py                     # pruebas de uso con Playwright (el servidor debe estar en marcha)
python3 e2e_accounts.py            # tipo de cuenta Loans
python3 e2e_positions.py           # posiciones con precio unitario
python3 e2e_fx.py                  # valores en otra moneda (USD) con cambio
python3 e2e_rules.py               # reglas con importe exacto
python3 e2e_transactions.py        # buscador de movimientos: tipo, fechas, importes y orden
python3 e2e_apply.py               # aplicar reglas a lo existente y traspasos recurrentes
python3 e2e_prices.py              # actualización de precios con el proveedor simulado
python3 e2e_data.py                # seguridad de los datos: arranque con fallos, restaurar copias, importes con símbolo
```

## Publicar en GitHub Pages

1. Crea un repositorio y sube el contenido de esta carpeta (`.github/workflows/pages.yml` va incluido).
2. En el repositorio, Settings, Pages, Source: **GitHub Actions**.
3. Cada push a `main` ejecuta typecheck y pruebas, compila y publica. La dirección es `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/` (la de este repositorio: https://borjape213-rgb.github.io/Aljibe/).
4. En Android, abre esa dirección en Chrome y elige "Instalar aplicación".

El flujo ya está en marcha: cada push a `main` publica en esa dirección.
