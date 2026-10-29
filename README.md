# Aljibe (PWA personal)

Finanzas personales con los datos en tu móvil (IndexedDB). Sin cuenta, sin servidor, sin suscripción.

## Uso

- Primer arranque: vacío, con una guía de tres pasos. Añade `?demo=1` a la dirección la primera vez para cargar datos de ejemplo (o usa el botón de la guía).
- Importar: Ajustes, Datos y copia. Acepta `.csv` y `.xlsx` (primera hoja) con encabezados de fecha, concepto e importe (o débito y crédito). Si hay fecha operativa y fecha valor, usa la operativa. Lee titular y saldo del encabezado del extracto (probado con el formato de Banc Sabadell). Importar el mismo archivo dos veces no duplica movimientos.
- Buscar movimientos: texto, cuenta, categoría y estado, y además tipo (gastos o ingresos), rango de fechas (desde/hasta, inclusivos) y rango de importe (sin signo, inclusivo). Se puede ordenar por fecha o por importe, de mayor a menor o al revés; al ordenar por importe la lista deja de agruparse por día y cada fila muestra su fecha. Todo vive en la URL, así que se puede guardar como marcador.
- Precios: Inversiones, «Actualizar precios». Solo cuando lo pides y con conexión. Usa Alpha Vantage con tu clave gratuita (se pega cada vez; nunca se guarda ni entra en las copias) y el tipo de cambio del BCE (Frankfurter) para valores en otra moneda. Cada valor lleva un símbolo (p. ej. `AIR:EPA`, o `AIR.PAR` tal cual) y su moneda, en la ficha del valor. Los valores que cotizan en otra moneda (p. ej. USD) se escriben y se ven en su moneda, con su tipo de cambio guardado (se puede traer el de hoy del BCE); los totales y la ganancia salen en euros. Se ve una vista previa antes de guardar. El plan gratuito limita las consultas (unas 25 al día y 5 por minuto).
- Copia de seguridad: descarga el JSON desde Ajustes. Hay un aviso en Inicio a los 30 días.

## Desarrollo

```
npm install
npm run build                      # genera dist/
npm test                           # lógica de dinero, presupuesto, importación y Excel
python3 -m http.server -d dist 8765
python3 e2e.py                     # pruebas de uso con Playwright (el servidor debe estar en marcha)
python3 e2e_accounts.py            # tipo de cuenta Loans
python3 e2e_positions.py           # posiciones con precio unitario
python3 e2e_fx.py                  # valores en otra moneda (USD) con cambio
python3 e2e_rules.py               # reglas con importe exacto
python3 e2e_transactions.py        # buscador de movimientos: tipo, fechas, importes y orden
python3 e2e_prices.py              # actualización de precios con el proveedor simulado
python3 e2e_data.py                # seguridad de los datos: arranque con fallos, restaurar copias, importes con símbolo
```

## Publicar en GitHub Pages

1. Crea un repositorio y sube el contenido de esta carpeta (`.github/workflows/pages.yml` va incluido).
2. En el repositorio, Settings, Pages, Source: **GitHub Actions**.
3. Cada push a `main` ejecuta las pruebas, compila y publica. La dirección será `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.
4. En Android, abre esa dirección en Chrome y elige "Instalar aplicación".

El flujo de publicación no se ha ejecutado todavía (no hay repositorio); está escrito pero sin probar.
