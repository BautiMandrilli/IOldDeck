# Handover — Panel Propio para iPad 2

Actualizado el **12 de noviembre de 2026**, zona America/Buenos_Aires.

## 1. Punto de entrega

- Repositorio: <https://github.com/BautiMandrilli/panel-propio-ipad2>.
- Rama de trabajo: `main`.
- Los cambios funcionales se guardaron y subieron **antes de crear este archivo**, según lo solicitado por el usuario.
- Commit funcional: `1d548308c7c3388dc1805056fcdab84deb57fd12` — `feat: simplify panel customization and add local Spotify controls`.
- Se verificó que `HEAD` y `origin/main` apuntaban a ese commit después del push. Este documento se agrega por separado.
- Workspace utilizado: `D:\panel-propio-ipad2`, PowerShell, Windows 11, Python 3.13.4 y Node 22.17.1.

Estado local observado al preparar este handover: el servidor responde en el puerto 8765; la configuración tiene formato 3, una página en modo libre y seis elementos, incluida una tarjeta Spotify. Esto describe esta instalación, no los valores predeterminados de un clon nuevo. El proceso se inició con `npm run dev`; comprobar que siga activo antes de iniciar otro.

## 2. Qué quiere el usuario y qué se implementó

El proyecto convierte un iPad 2 en un panel de control local para una PC Windows, parecido a un Stream Deck. Se edita desde la computadora y se usa desde Safari del iPad. El usuario prefiere instrucciones en español, una edición sencilla y estética Apple oscura.

La personalización no llegó al cambiar de computadora porque `data/` está excluida de Git. Se mantuvo esa separación y se agregó exportación/importación para trasladar todos los datos personales sin subirlos al repositorio.

Decisiones de producto acordadas e implementadas:

- Cuadrícula predeterminada para páginas nuevas, con opción de diseño libre por página.
- Las páginas antiguas conservan su distribución libre. Alternar modos no sobrescribe sus coordenadas ni tamaños libres.
- Botones que ocupan varias celdas, reordenamiento por arrastre y crecimiento vertical automático en cuadrícula.
- Controles simples de nombre, color, foto e icono; ajustes detallados en «Avanzado».
- Presentación «Solo nombre», «Solo icono» o «Icono y nombre», con 16 símbolos SVG propios de líneas y posibilidad de subir imágenes.
- Carpetas de **un solo nivel**, con botones y tarjetas dentro; nunca subcarpetas.
- Carpetas superpuestas en el panel, con cierre por botón, fondo exterior o Escape. Ejecutar una acción no las cierra.
- Exportación/importación ZIP con revisión previa y copia recuperable antes de restaurar.
- Nodemon y recarga automática del navegador, protegiendo la edición sin guardar.
- Tarjeta Spotify **siempre visible en la primera página**, elegida por el usuario en lugar de un botón que abra un reproductor.

El panel ya tenía atajos de Windows, apertura de URLs y feedback visual alternable para Discord. Se conservaron. El estado de Discord continúa siendo **estimado por los toques del panel**, no una lectura real de Discord.

## 3. Arquitectura y mapa del código

No hay framework frontend, compilación de assets ni aplicación nativa instalada en el iPad. Node se usa para herramientas de desarrollo y pruebas; el servidor de producción es Python.

| Componente | Responsabilidad |
| --- | --- |
| `server.py` | Servidor HTTP con biblioteca estándar, autenticación, vinculación, validación y persistencia de configuración, imágenes, respaldos, acciones y endpoints Spotify. |
| `public/index.html` y `public/app.js` | Panel táctil, páginas, carpetas, ejecución de botones y sincronización de estados. |
| `public/editor.html` y `public/designer.js` | Editor visual de PC, cambios pendientes, arrastre, tamaño, personalización y transferencia de respaldos. |
| `public/layout.js` | Distribución compartida entre panel/editor, símbolos SVG y construcción de botones y tarjetas Spotify. |
| `public/spotify.js` | Consulta del estado Spotify, controles, actualización parcial de tarjetas, progreso y carátulas autenticadas. |
| `public/style.css` | Apariencia Apple oscura, modos de diseño, carpetas y reproductor. |
| `spotify_bridge.py` | Integración local con sesiones multimedia de Windows mediante PyWinRT; hilo y bucle asíncrono propios. |
| `setup_spotify.py` | Agregado idempotente de la tarjeta de prueba, búsqueda de espacio y respaldo previo. |
| `requirements-spotify.txt` | Dependencias opcionales WinRT fijadas en 3.2.1 y limitadas a Windows. |
| `nodemon.json`, `package.json` y `package-lock.json` | Inicio, vigilancia, preparación y comandos de pruebas. |
| `public/dev-reload.js` | Recarga de páginas al cambiar la versión del proceso de desarrollo. |

### Compatibilidad que debe preservarse

- El navegador objetivo sigue siendo **Safari de iOS 9 en iPad 2**. El frontend utiliza ES5, `XMLHttpRequest`, Flexbox con prefijos y escalado de un lienzo de 1024 px.
- No introducir en los scripts del panel `fetch`, módulos ES, arrow functions, `let`/`const`, `async`/`await`, optional chaining ni dependencias de navegador moderno.
- Evitar CSS Grid y no depender de service workers, transparencias costosas o APIs modernas para el funcionamiento básico.
- Las pruebas Node pueden usar JavaScript moderno; no confundir ese entorno con el código servido al iPad.
- La estética es inspirada en Apple; los símbolos incorporados son SVG definidos en código, sin fuentes ni servicios externos.

### Distribución y tipos de elementos

El formato normalizado actual tiene `version: 3`; `validate()` acepta configuraciones de versiones 1, 2 y 3. Al guardar o exportar se normalizan al formato actual.

- Configuración: `title` y `pages`.
- Página: `id`, `title`, `height`, `layout` (`grid` o `free`), fondo y lista `buttons`.
- La lista conserva el nombre `buttons` aunque incluya tipos `button`, `folder` y `spotify`.
- Cada elemento tiene un ID globalmente único y `folderId` vacío o referido a una carpeta de su propia página.
- `x`, `y`, `w`, `h` almacenan la geometría libre. `cols` y `rows` definen el tamaño de cuadrícula.
- `displayMode` admite `label`, `icon` y `both`; `builtinIcon` identifica un símbolo local. `icon` e `image` refieren a assets subidos.
- Los botones normales ejecutan `hotkey` o `url`. Carpetas y tarjetas no se ejecutan mediante `/api/action`.
- La cuadrícula tiene seis columnas, margen de 24 px y separación de 16 px. El cálculo compartido evita superposiciones sin modificar la geometría libre.
- Las carpetas usan cuadrícula interior incluso si su página está en modo libre.
- Spotify usa 4×2 celdas por defecto, con mínimo 3×2, o mínimo 320×220 px en modo libre.

No reconstruir toda la página para actualizar el estado de un botón o el contenido musical: se conservan los nodos y el contexto de interacción.

## 4. Persistencia, autenticación y API local

### Datos personales: importante al cambiar de PC

`data/` no se versiona. Contiene `config.json`, `token.txt`, `assets/` con su índice y respaldos ZIP locales. `.cache/`, `node_modules/`, entornos virtuales y logs también están ignorados.

- **No agregar `data/` a Git ni publicar tokens.** Un clon no contiene los botones personales ni la tarjeta agregada a esta instalación.
- Para migrar: exportar/importar desde el editor, o detener los servidores y copiar `data/` completa.
- Los respaldos ZIP del editor incluyen configuración e imágenes, pero **excluyen tokens y códigos de vinculación**. Una PC nueva requiere su propia vinculación.
- El servidor crea configuración y token al importar/iniciar si no existen. Las pruebas deben copiar el servidor a un directorio temporal para evitar tocar datos reales.
- Hay una copia `data/before-spotify-…zip` anterior al agregado de la tarjeta. Las restauraciones generan `data/before-restore-…zip`.
- Los respaldos pueden recuperarse mediante la misma opción de importación del editor.

La configuración se escribe mediante archivo temporal y reemplazo. La restauración valida el ZIP completo antes de modificar datos, instala imágenes con nombres nuevos y revierte configuración/índice ante fallos de la operación. Usa `RLock` para datos y un lock separado para acciones/estados. Las carátulas Spotify son memoria temporal y no se incorporan a assets ni respaldos.

Límites actuales: 12 páginas, 80 elementos por página, 200 imágenes de hasta 2,5 MB y ZIP de hasta 505 MB. Se rechazan rutas ajenas al formato admitido, duplicados, imágenes inválidas y referencias faltantes. Los SVG subidos se sanitizan.

### Vinculación y red

El servidor escucha en `0.0.0.0:8765` para permitir acceso desde el iPad en la LAN. El editor se abre en `http://localhost:8765/editor`; para el iPad se usa la IP que imprime el servidor. No fijar la IP observada en esta sesión: puede cambiar.

- La PC imprime un código de seis cifras que cambia con cada reinicio.
- El iPad obtiene el token mediante ese código y lo conserva en `localStorage` como `panel_token`.
- Las solicitudes autenticadas llevan `X-Panel-Token`.
- El token persistente sobrevive a los reinicios. Los estados estimados de botones se reinician.
- `/api/local-token` solo está disponible en loopback para el editor de la PC.
- Edición, subida/listado de imágenes, exportación y restauración requieren las restricciones locales correspondientes además de autenticación.
- El servicio es para red local: no exponer el puerto directamente a Internet.

| Ruta | Función |
| --- | --- |
| `POST /api/pair` | Vincular con código; incluye limitación de intentos. |
| `GET /api/config`, `POST /api/config` | Leer y guardar configuración normalizada. |
| `GET /api/state` | Estados estimados, versión y época del proceso. |
| `POST /api/action` | Ejecutar un botón normal por ID. |
| `GET /api/assets`, `POST /api/assets` | Índice y subida de imágenes desde la PC. |
| `GET /api/backup` | Descargar ZIP de la configuración guardada. |
| `POST /api/restore?preview=1` | Validar ZIP y devolver resumen sin restaurar. |
| `POST /api/restore` | Restaurar y devolver configuración y nombre del respaldo previo. |
| `GET /api/spotify/state` | Captura compartida de Spotify. |
| `GET /api/spotify/artwork?revision=…` | Carátula de la revisión actual, con autenticación. |
| `POST /api/spotify/control` | Control local: `command` y `sessionId`. |
| `GET /api/dev-version` | Versión del proceso para recarga; autenticado. |

## 5. Spotify: decisiones y detalles para continuar

Se revisó [OldPhoneDeck](https://github.com/GLAUCOMA82/OldPhoneDeck), especialmente su archivo `Sources/oldphonedeck/Music.swift`. Ese proyecto usa AppleScript en macOS para consultar y controlar Spotify/Music. Inspiró el enfoque local, pero **no se incorporó el backend de Mac**.

La primera propuesta contemplaba Spotify Web API y OAuth. Se eligió finalmente **Windows.Media.Control**, porque el usuario reproduce desde Spotify de escritorio en esta PC. No necesita una app en Spotify Developers ni claves. El usuario tiene Premium; la integración local no verifica la suscripción.

Referencias técnicas:

- [Sesiones multimedia de Windows](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession).
- [Ejemplo oficial de lectura/control desde otra aplicación](https://devblogs.microsoft.com/oldnewthing/20231108-00/?p=108980).
- [PyWinRT](https://pywinrt.readthedocs.io/).

### Servicio y controles

- `SpotifyService` se inicia de forma perezosa cuando se consulta el estado o se envía un control.
- Un hilo daemon contiene un bucle `asyncio` y el apartamento WinRT MTA. Los objetos Windows se consultan/controlan en ese hilo.
- Consulta cada dos segundos, publica una copia protegida por lock y comparte esa captura entre todos los clientes.
- Filtra IDs de Spotify, incluidos `Spotify.exe` y el formato de la app de Microsoft Store. Nunca selecciona el reproductor genérico activo si no es Spotify.
- Prefiere una sesión reproduciendo al seleccionar; luego conserva la selección mientras exista.
- Comandos admitidos: `playpause`, `previous`, `next`. Comprueba sesión esperada y capacidades publicadas por Windows antes de enviarlos.
- El éxito de la llamada Windows confirma aceptación, no necesariamente cambio inmediato del estado. Se agregó una espera breve para observar el cambio real de pausa/reanudación antes de refrescar; no se inventa un estado optimista.
- La carátula se cachea en memoria, se identifica mediante hash y se sirve solo para la revisión actual. Su ausencia no deshabilita la reproducción.
- Hay tiempos de espera y estados `starting`, `unavailable`, `closed`, `idle`, `ready` y `error` con mensajes de interfaz.
- Si faltan dependencias o falla WinRT, los botones normales del panel continúan disponibles.

### Frontend musical

- La tarjeta es un `div` con controles `button` independientes: no anidar botones.
- `spotify.js` consulta solo si hay tarjetas visibles y un token de vinculación.
- Actualiza metadatos y controles sobre los mismos nodos; la barra avanza cada segundo entre capturas y se detiene ante datos desactualizados.
- Carátulas mediante XHR autenticado, respuesta Blob y URL temporal; no poner el token en la URL de la imagen.
- Las respuestas de consultas iniciadas antes de un control se descartan para no sobreescribir el resultado de una acción reciente.
- En el editor los controles están desactivados y la tarjeta solo es una vista previa editable.

### Preparación de la tarjeta de prueba

`npm run setup:spotify` instala `requirements-spotify.txt` y ejecuta `setup_spotify.py`.

- Requiere detener el servidor: el script rechaza la preparación si detecta el puerto 8765 en uso.
- Es idempotente por presencia de una tarjeta Spotify en la primera página.
- Usa inicialmente X 24, Y 316, ancho 646 y alto 280; comprueba espacio y busca otra posición si hace falta, sin mover elementos.
- Puede aumentar el alto libre dentro del límite de 1400 px. Si no encuentra lugar o la página tiene 80 elementos, falla sin cambiar la configuración.
- Guarda un ZIP previo y escribe la nueva configuración atómicamente.

En esta instalación la preparación ya se ejecutó y se verificó su idempotencia. No hace falta repetirla para probar la tarjeta existente.

## 6. Cómo iniciar y probar

Desde la raíz del repositorio:

```powershell
npm ci
# Solo al preparar Spotify en una instalación nueva; servidor detenido:
npm run setup:spotify
npm run dev
```

Sin nodemon: `npm start` o `python server.py`. El servidor normal no necesita Node. Para Spotify debe usarse el mismo Python donde se instalaron sus dependencias.

Nodemon está fijado en **3.1.11**. Se eligió esa versión después de que `npm audit` señalara una dependencia vulnerable en la versión inicialmente descargada; la instalación final reportó cero vulnerabilidades en ese momento. No actualizar a ciegas: revisar auditoría y repetir la prueba de desarrollo.

Vigila `server.py`, `spotify_bridge.py`, `public/` y `nodemon.json`, y excluye datos personales, pruebas, dependencias y cachés. `PANEL_DEV=1` activa la inyección del script de recarga y una revisión distinta por proceso. El navegador comprueba cada 1,5 s; el editor espera si tiene cambios sin guardar o un respaldo en transferencia. `rs` permite reiniciar manualmente desde la consola de nodemon.

Condiciones para Spotify real:

1. Windows 10 1809 o posterior, o Windows 11. La máquina utilizada cumple.
2. Spotify de escritorio abierto, sesión iniciada y una canción reproducida en **esta PC**, no solo en otro dispositivo de Spotify Connect.
3. Servidor iniciado en la sesión normal del usuario de Windows. Un servicio del sistema o una terminal aislada puede no acceder a las sesiones multimedia.
4. iPad y PC en la misma red, puerto permitido en la red privada y panel vinculado.
5. Internet para instalar paquetes y para el contenido de Spotify que lo necesite. La comunicación iPad/PC es local.

## 7. Verificación realizada y sus límites

Comandos disponibles:

```powershell
npm test
npm run test:dev
node tests/browser_smoke.mjs
git diff --check
```

- `npm test`: **26 pruebas Python** y pruebas Node de distribución compartida. Cubren migración, validación, acciones, ZIP, rollback, autenticación Spotify, selección de sesiones, controles, carátulas, errores, timeouts, recuperación y agregado idempotente.
- `npm run test:dev`: copia temporal, reinicio real de Python por nodemon, exclusión de `data/`, token persistente, inyección de recarga y protección de cambios sin guardar.
- `tests/browser_smoke.mjs`: Chrome headless con CDP y módulos nativos de Node, sin Playwright instalado. Usa datos temporales y Spotify **simulado**; verifica editor, carpetas, tamaños, arrastre, guardado, importación, tarjeta, imagen autenticada, pausa y siguiente sin reconstruir sus nodos. No controla Spotify real.
- Ese script requiere Node 22+ y Chrome local; admite `CHROME` y `PYTHON`. Genera capturas ignoradas en `.cache/`, incluidas `spotify-ipad.png`, `spotify-editor.png` y `spotify-desktop.png`.
- Se inspeccionaron visualmente las capturas de la tarjeta y el editor.
- En Windows real se confirmó `Spotify.exe`, título, carátula y disponibilidad de los tres controles.
- Se probó pausa/reanudación real y se confirmó la vuelta al estado inicial. La prueba inicial reveló latencia en la confirmación de Windows; se ajustó la espera y la repetición pasó.
- Se verificaron además los endpoints del servidor activo: estado `ready`, una tarjeta en la primera página y carátula HTTP 200 `image/png`.
- Anterior/siguiente se comprobaron con sesiones simuladas; no afirmar que se cambiaron pistas reales desde el iPad.
- **No se realizó todavía una prueba física de Safari/iPad 2.** Chrome a tamaño de iPad no demuestra rendimiento, tacto ni compatibilidad completa en el dispositivo.

Nota del entorno de trabajo: las llamadas reales a Windows.Media.Control fallaron dentro del sandbox con «El servicio especificado no existe como servicio instalado», pero funcionaron fuera del entorno restringido. Las descargas npm/pip y los cambios en `.git` también necesitaron permisos ampliados en esta sesión. No confundir esas restricciones del agente con un requisito de ejecutar el panel como administrador en la PC del usuario.

## 8. Pendientes y precauciones para el próximo trabajo

Prioridad inmediata: abrir el panel en el iPad real, confirmar canción/carátula, pausa/reanudación, anterior/siguiente y la actualización tras cambiar de canción desde la PC. Comprobar también pérdida de Wi-Fi, regreso desde segundo plano y varias tarjetas visibles.

Fuera del alcance implementado:

- Volumen, playlists, búsqueda, seek manual y control de otros dispositivos Spotify Connect.
- Reproducir audio directamente en el iPad.
- Estado real de Discord.
- Panel táctil remoto, vista de pantalla, selección del monitor al abrir ventanas y conexión remota fuera de la LAN.
- Carpetas anidadas y sincronización automática de personalización por nube.

Antes de continuar:

- Leer este archivo y `README.md`, comprobar `git status` y verificar si el servidor ya ocupa el puerto.
- Conservar `data/`; no restablecer configuración ni reinstalar la tarjeta innecesariamente.
- No iniciar dos servidores en el mismo puerto ni detener procesos ajenos para liberarlo.
- Usar fixtures temporales para pruebas y evitar controles reales de Spotify salvo que el trabajo los requiera. Al probar pausa/reanudación, esperar la confirmación y devolver el estado inicial.
- Si cambia el formato de configuración, actualizar validación, editor, render compartido, respaldo/restauración y sus resúmenes; la lista `buttons` también contiene carpetas y tarjetas.
- Si cambia el servicio Spotify, mantener acotadas las esperas y no trasladar objetos WinRT a los hilos de solicitudes HTTP.
- Mantener los límites de compatibilidad con iOS 9 y documentar siempre qué se probó de forma simulada, en Windows real y en el iPad físico.
