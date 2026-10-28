# Aljibe (PWA personal)

Finanzas personales con los datos en tu móvil (IndexedDB). Sin cuenta, sin servidor, sin suscripción.

## Uso

- Primer arranque: vacío, con una guía de tres pasos. Añade `?demo=1` a la dirección la primera vez para cargar datos de ejemplo (o usa el botón de la guía).
- Importar: Ajustes, Datos y copia. Acepta `.csv` y `.xlsx` (primera hoja) con encabezados de fecha, concepto e importe (o débito y crédito). Si hay fecha operativa y fecha valor, usa la operativa. Lee titular y saldo del encabezado del extracto (probado con el formato de Banc Sabadell). Importar el mismo archivo dos veces no duplica movimientos.
- Copia de seguridad: descarga el JSON desde Ajustes. Hay un aviso en Inicio a los 30 días.

## Desarrollo

```
npm install
npm run build                      # genera dist/
npm test                           # lógica de dinero, presupuesto, importación y Excel
python3 -m http.server -d dist 8765
python3 e2e.py                     # pruebas de uso con Playwright (el servidor debe estar en marcha)
python3 e2e_data.py                # seguridad de los datos: arranque con fallos, restaurar copias, importes con símbolo
```

## Publicar en GitHub Pages

1. Crea un repositorio y sube el contenido de esta carpeta (`.github/workflows/pages.yml` va incluido).
2. En el repositorio, Settings, Pages, Source: **GitHub Actions**.
3. Cada push a `main` ejecuta las pruebas, compila y publica. La dirección será `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.
4. En Android, abre esa dirección en Chrome y elige "Instalar aplicación".

El flujo de publicación no se ha ejecutado todavía (no hay repositorio); está escrito pero sin probar.
