# Panel Propio

[English](README.md) · **Español**

Convertí un iPad viejo (o cualquier tablet o celular en tu Wi‑Fi) en un **panel de control estilo Stream Deck para tu PC con Windows**. Tocás un botón en la tablet y la PC ejecuta un atajo de teclado, abre una página web, abre una app o un juego, o controla Spotify.

- Funciona **solo en tu red local**: sin cuentas, sin nube y sin Internet.
- Está hecho para funcionar incluso en un **iPad 2 con Safari de iOS 9**, y en cualquier navegador moderno.
- Trae un **editor visual** en la PC para diseñar páginas, carpetas, botones, iconos y temas.
- El servidor es Python puro (solo biblioteca estándar). Node.js solo hace falta para desarrollar.

---

## Contenido

- [Qué puede hacer](#qué-puede-hacer)
- [Requisitos y limitaciones](#requisitos-y-limitaciones)
- [Instalación](#instalación)
- [Conectar el iPad](#conectar-el-ipad)
- [Firewall de Windows](#firewall-de-windows)
- [Usar el editor](#usar-el-editor)
- [Acciones de los botones](#acciones-de-los-botones)
- [Widget de Spotify (opcional)](#widget-de-spotify-opcional)
- [Llevarlo a otra PC / respaldos](#llevarlo-a-otra-pc--respaldos)
- [Estado de conexión en el iPad](#estado-de-conexión-en-el-ipad)
- [Problemas frecuentes](#problemas-frecuentes)
- [Seguridad](#seguridad)
- [Desarrollo](#desarrollo)
- [Créditos](#créditos)

---

## Qué puede hacer

- **Páginas** que se cambian deslizando, cada una con una cuadrícula de 6 columnas de "casillas" (o posición libre).
- **Botones** de cualquier tamaño (de 1×1 a 6×4 casillas), con nombre, color, foto, símbolo incorporado o el logo real de una app.
- **Carpetas** con forma de carpeta real que se abren como ventana en la tablet.
- **Biblioteca de apps** con ~50 logos de marcas (YouTube, Discord, Gmail, Twitch, Steam, League of Legends…) estilo icono de iOS.
- **Acciones:** atajo de teclado, abrir una página web, o abrir una app o juego instalado en la PC.
- **Widget de Spotify** con portada, canción, artista, progreso y anterior / reproducir‑pausar / siguiente (opcional).
- **Temas** para todo el panel: Clásico, Medianoche, Aurora, Carbono, Atardecer y Océano.
- **Estado visual al tocar:** un botón puede alternar texto, color o icono cada vez que se toca (por ejemplo, silenciar y activar).
- **Indicador de conexión** en vivo en la tablet.
- **Respaldo y restauración** de todo el panel en un archivo ZIP.

## Requisitos y limitaciones

Leé esto antes de descargarlo.

| | Requisito |
|---|---|
| **PC (servidor)** | **Solo Windows 10 u 11.** Los atajos, las apps y Spotify usan funciones de Windows. No funciona en macOS ni en Linux. |
| **Python** | Python **3.9 o posterior** (desarrollado con 3.13), disponible como `python` en la terminal. |
| **Tablet (panel)** | Cualquier dispositivo con navegador en la **misma red local**. Pensado para iPad en **horizontal** (1024×768). Funciona en Safari de iOS 9 (iPad 2) y en iPads nuevos, iPhones (en horizontal) y tablets Android. |
| **Red** | PC y tablet en la **misma Wi‑Fi / red local**. Las redes de invitados o los routers con "aislamiento de clientes (AP isolation)" impiden que los equipos se vean. |
| **Firewall** | Windows tiene que permitir conexiones entrantes al **puerto TCP 8765** en tu red **privada**. Ver [Firewall de Windows](#firewall-de-windows). |
| **Editor** | El editor solo se abre **en la misma PC** (`localhost`). No se puede abrir desde la tablet ni desde otra computadora. |
| **Widget de Spotify** | Opcional. Necesita la **app de escritorio** de Spotify en la misma PC, reproduciendo en esa PC, y paquetes extra de Python (PyWinRT). |
| **Node.js** | **No** hace falta para usarlo. Solo para desarrollo (recarga automática y pruebas en navegador). |

**Limitaciones conocidas**

- **Solo red local y HTTP sin cifrar.** No hay HTTPS ni acceso remoto. No expongas el puerto 8765 a Internet.
- **Un servidor por vez.** Solo puede haber una copia del servidor en el puerto 8765; una segunda copia no arranca.
- **Los atajos "se envían y listo".** En botones que alternan (como silenciar en Discord), el panel solo *estima* el estado según sus propios toques (se marca `ESTIMADO`). Si silenciás con el mouse, el indicador puede quedar desfasado.
- **Los atajos no llegan a apps abiertas como administrador**, salvo que el servidor también se ejecute como administrador. Es una regla de seguridad de Windows (UIPI).
- **Las apps de escritorio son una lista fija:** Discord, Spotify, Steam, Epic Games, Telegram, WhatsApp, Zoom, Notion, Figma, Claude, League of Legends, Counter‑Strike 2 y Fortnite. Si la app o el juego no está instalado, el botón abre su página web. Programas o enlaces arbitrarios no se pueden abrir; es a propósito, por seguridad.
- **Hardware viejo:** en un iPad 2 las animaciones son más simples y algunos efectos se reducen por velocidad. Las páginas con muchas imágenes grandes van más lentas.
- Límites: 12 páginas, 80 elementos por página, 200 imágenes (máximo 2,5 MB cada una) y respaldos de hasta 505 MB.

## Instalación

1. **Instalá Python** desde [python.org](https://www.python.org/downloads/windows/). En el instalador marcá **"Add python.exe to PATH"**.
2. **Descargá este proyecto.** Usá el botón verde **Code → Download ZIP** de GitHub y descomprimilo, o clonalo:
   ```powershell
   git clone https://github.com/BautiMandrilli/panel-propio-ipad2.git
   cd panel-propio-ipad2
   ```
3. **Iniciá el servidor** desde esa carpeta:
   ```powershell
   python server.py
   ```
   Muestra tres datos:
   ```
   Editor en la PC: http://localhost:8765/editor
   iPad: http://192.168.x.x:8765
   Código para vincular el iPad: 123456
   ```
4. La primera vez, el Firewall de Windows pregunta por Python. Elegí **Redes privadas** y tocá **Permitir** (detalles [más abajo](#firewall-de-windows)).
5. Abrí **http://localhost:8765/editor** en la PC para diseñar tu panel.

Dejá la ventana de la terminal abierta mientras usás el panel. Para detener el servidor, presioná `Ctrl+C` en esa ventana.

## Conectar el iPad

1. En el iPad, abrí **Safari** y entrá a la dirección `iPad:` que mostró el servidor (por ejemplo `http://192.168.1.20:8765`).
2. Escribí el **código de 6 números** de la ventana del servidor. El iPad queda vinculado; el código solo vuelve a hacer falta si borrás los datos de Safari.
3. **Recomendado: pantalla completa.** Tocá **Compartir → Agregar a pantalla de inicio** y abrí el panel desde ese icono. Así se abre sin la barra de direcciones ni las pestañas de Safari. Esa copia tiene su propio almacenamiento, así que ahí vas a ingresar el código una vez más.
4. **Opcional:**
   - Ajustes → General (iOS 9) o Pantalla y brillo (iOS más nuevos) → Bloqueo automático → **Nunca**, para que la pantalla no se apague.
   - Ajustes → General → Accesibilidad → **Acceso guiado**, para dejar el iPad fijo en el panel como un kiosco.

El código de vinculación **cambia cada vez que se reinicia el servidor**, pero los dispositivos ya vinculados siguen funcionando.

## Firewall de Windows

La tablet tiene que poder llegar a tu PC por el **puerto TCP 8765**.

- **Primera vez:** cuando Windows pregunte *"¿Permitir que Python se comunique en estas redes?"*, marcá **Redes privadas** y tocá **Permitir**.
- **Tu Wi‑Fi tiene que estar como "Privada".** Configuración → Red e Internet → Wi‑Fi → *(tu red)* → Tipo de perfil de red → **Privada**. Con el perfil **Público**, Windows bloquea la conexión.
- **Si tocaste "Cancelar" o la tablet no se conecta,** agregá la regla a mano. Abrí PowerShell **como administrador** y ejecutá:
  ```powershell
  New-NetFirewallRule -DisplayName "Panel Propio" -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow -Profile Private
  ```
  Para quitarla después:
  ```powershell
  Remove-NetFirewallRule -DisplayName "Panel Propio"
  ```
- Si usás un antivirus o firewall de terceros, puede necesitar la misma excepción.
- Nunca abras ni redirijas el puerto 8765 en tu router.

## Usar el editor

Abrí **http://localhost:8765/editor** en la PC. Los cambios llegan a la tablet unos segundos después de tocar **Guardar**.

- **Barra izquierda:**
  - Nombre del panel y **Tema**.
  - Páginas: agregar, ordenar y eliminar.
  - Distribución de la página elegida (cuadrícula o libre), y su color o imagen de fondo.
  - Exportar e importar respaldos.
- **Centro:** vista previa en vivo de la pantalla del iPad.
  - Arrastrá los botones para reordenarlos.
  - Arrastrá las **esquinas** de un botón para que ocupe más casillas.
  - Hacé doble clic en una carpeta para abrirla.
- **Barra del borde derecho:**
  - **Nuevo botón**
  - **Nueva carpeta**
  - **Widget de Spotify**
- **Barra inferior:** Deshacer, Rehacer, Duplicar, Mover a la izquierda o derecha, y Eliminar.
- **Barra derecha:** todo lo del botón elegido.
  - Nombre, icono o logo de app, acción, colores y foto.
  - Ubicación (en qué carpeta está) y ajustes avanzados.
  - Las secciones se pueden contraer.
- **Barras laterales:** arrastrá sus bordes para cambiar el ancho, o hacé clic en un borde para ocultar esa barra.
- **Atajos:**

  | Teclas | Acción |
  |---|---|
  | `Ctrl+S` | Guardar |
  | `Ctrl+Z` | Deshacer |
  | `Ctrl+Shift+Z` | Rehacer |
  | `Ctrl+D` | Duplicar |
  | `Supr` | Eliminar |
  | Flechas | Mover (modo libre) |
  | `Esc` | Deseleccionar |
  | `Ctrl+Alt+[` / `Ctrl+Alt+]` | Ocultar o mostrar las barras laterales |

## Acciones de los botones

| Acción | Qué hace | Notas |
|---|---|---|
| **Atajo** | Envía una combinación de teclas a Windows, por ejemplo `ctrl+shift+m`. | Llega a la app que esté en primer plano, o a apps con atajos **globales** (Discord, OBS, juegos). Configurá primero el atajo en esa app. |
| **Página web** | Abre una URL en el navegador predeterminado de la PC. | |
| **App de la PC** | Abre una app o un juego instalado y lo trae al frente. | Si no está instalado, abre su página web. El editor indica "instalada" o "no encontrada". |

Al elegir un logo de la **biblioteca de apps**, la acción se completa sola: usa la app de escritorio si está instalada y, si no, su página web.

**Ejemplo para silenciar o ensordecer en Discord:**
1. En Discord, abrí Ajustes de usuario → Atajos de teclado y creá uno, por ejemplo `Ctrl+Shift+1` para "Activar/desactivar silencio".
2. En el editor, poné como acción del botón **Atajo** con `ctrl+shift+1`.

## Widget de Spotify (opcional)

Muestra la canción, el artista, la portada y el progreso, con controles de anterior, reproducir‑pausar y siguiente. El audio sigue sonando en la PC. No hace falta cuenta de desarrollador de Spotify ni iniciar sesión.

1. Detené el servidor (`Ctrl+C`).
2. Ejecutá:
   ```powershell
   python -m pip install -r requirements-spotify.txt
   python setup_spotify.py
   ```
   (o `npm run setup:spotify` si tenés Node.js)
3. Iniciá el servidor de nuevo.
4. Abrí la **app de escritorio de Spotify**, reproducí algo y verificá que suene en **esta PC**.

La preparación agrega un widget a tu primera página y antes guarda un respaldo. Podés agregar, mover o eliminar widgets en el editor con **Widget de Spotify**.

Si el widget dice que falta instalar la integración, repetí el paso 2 con el **mismo Python** que usás para iniciar el servidor.

## Llevarlo a otra PC / respaldos

Tu panel se guarda en la carpeta `data/`. No forma parte del repositorio y nunca se sube.

- **Exportar:** Editor → *Llevar a otra PC* → **Exportar personalización**. Descarga un ZIP con tus páginas, botones e imágenes.
- **Importar:** en la PC nueva, iniciá el servidor, abrí el editor y elegí **Importar respaldo ZIP**. Revisá el resumen y confirmá.
  - Esto **reemplaza** todo el panel.
  - Antes se guarda una copia de seguridad del anterior en `data/`.
- Los respaldos nunca incluyen el token de vinculación, así que en la PC nueva tenés que volver a vincular la tablet.

## Estado de conexión en el iPad

Un indicador arriba a la derecha muestra el enlace con la PC. Tocalo para ver una explicación; tocarlo también vuelve a intentar la conexión en el momento.

| Estado | Significado |
|---|---|
| **Conectado** | Conectado y funcionando. |
| **Conectando…** | Iniciando. |
| **Reconectando…** | La PC dejó de responder por un momento. |
| **Conexión perdida** | La PC dejó de responder. El panel sigue reintentando cada pocos segundos. |
| **Servidor apagado** | No se encuentra el servidor: no está iniciado, la PC está apagada o los equipos están en redes distintas. |
| **Sin Wi‑Fi** | La tablet no tiene red. |
| **Error del servidor** | El servidor informó un error. Revisá su ventana de terminal. |
| **Sin vincular** | Falta vincular. Escribí el código de 6 números. |

## Problemas frecuentes

- **La tablet no abre la página:**
  - Revisá que los dos equipos estén en la misma Wi‑Fi.
  - Revisá que el perfil de red de Windows sea **Privado** y que exista la regla del firewall ([ver arriba](#firewall-de-windows)).
  - Revisá que la ventana del servidor siga abierta.
  - Probá abrir `http://localhost:8765` en la misma PC.
- **"Código incorrecto" con el código correcto:**
  - Asegurate de que haya un solo servidor abierto; una segunda copia no arranca.
  - Usá el código de la ventana que realmente está funcionando.
  - Después de 5 intentos fallidos, esperá 5 minutos.
- **"El puerto 8765 ya está en uso":** ya hay otra copia funcionando, quizás sin ventana visible. Buscala y detenela:
  ```powershell
  Get-NetTCPConnection -LocalPort 8765 -State Listen | % { Get-Process -Id $_.OwningProcess }
  Stop-Process -Id <PID>
  ```
- **Un atajo funciona en el teclado pero no desde el panel:**
  - Verificá que el atajo sea **global** en la app de destino.
  - Si esa app se ejecuta **como administrador**, ejecutá también el servidor como administrador.
- **Una app de escritorio abre su página web:** la app o el juego no está instalado, o no está en la lista compatible.
- **Cambié algo y la tablet no se actualizó:** esperá unos 10 segundos o recargá la página.
- **Va lento en un iPad viejo:**
  - Usá el tema **Clásico**.
  - Usá menos imágenes, y más livianas.
  - Mantené las páginas en unas 3 filas, para que entren en la pantalla sin desplazarse.

## Seguridad

- El servidor escucha solo en tu red local y por **HTTP** (sin cifrar). Usalo en tu casa o en una red de confianza.
- **Vinculación:**
  - Un dispositivo se vincula con un código de 6 números que solo aparece en la terminal de la PC.
  - Al vincularse recibe un token, guardado en `data/token.txt`. **No lo compartas**: quien tenga ese token en tu red puede tocar tus botones.
  - Los intentos fallidos de código tienen un límite.
- Editar, subir imágenes, exportar y restaurar solo funciona **desde la misma PC**, no desde la red.
- Los botones solo pueden enviar atajos, abrir enlaces http(s) o abrir apps de una lista fija. Nunca ejecutan comandos arbitrarios. Las imágenes SVG subidas se limpian.
- Para desvincular todos los dispositivos, detené el servidor, borrá `data/token.txt`, iniciá el servidor de nuevo y volvé a vincular tus dispositivos.

## Desarrollo

Requiere Node.js (22 o posterior para la prueba en navegador) y npm.

```powershell
npm ci                         # herramientas de desarrollo (nodemon)
npm run dev                    # servidor con reinicio y recarga automáticos
npm test                       # pruebas de Python y de distribución
npm run test:dev               # prueba de la recarga automática
node tests/browser_smoke.mjs   # prueba de interfaz en Chrome sin ventana (acciones simuladas; capturas en .cache/)
```

- El código que recibe la tablet es **ES5** (sin `fetch`, `let`/`const`, funciones flecha ni CSS Grid), para que funcione en iOS 9.
- Las pruebas nunca tocan tu carpeta `data/`, ni presionan teclas o abren apps reales.
- Ver [`CLAUDE.md`](CLAUDE.md) y [`HANDOVER.MD`](HANDOVER.MD) para la arquitectura y las decisiones de diseño.

## Créditos

- Los logos de apps vienen de **[Simple Icons](https://simpleicons.org/)** (CC0). Los nombres y logos de marcas pertenecen a sus dueños. Este proyecto no está afiliado ni respaldado por ninguno de ellos, incluidos Elgato, Spotify, Discord, Riot Games, Valve y Epic Games.
- "Stream Deck" es una marca de Elgato. Panel Propio es un proyecto independiente.
