# Panel Propio

## Spotify en el iPad

La tarjeta **Spotify** muestra la canción, artista, carátula, progreso y estado real de la aplicación de Windows. Sus botones controlan anterior, reproducir/pausar y siguiente. El audio sigue saliendo de la PC. No usa Spotify Developers, OAuth ni claves de Spotify.

Para prepararla en otra instalación, detené el servidor y ejecutá:

```powershell
npm run setup:spotify
npm run dev
```

La preparación instala dependencias PyWinRT opcionales y agrega una tarjeta 4×2 a la primera página. Conserva los elementos existentes y guarda antes un respaldo `data/before-spotify-….zip`, importable desde el editor. Si ya hay una tarjeta Spotify en esa página no agrega otra. Si no hay espacio libre, informa el problema sin cambiar la configuración. Podés agregar más tarjetas, moverlas a carpetas o eliminarlas con **Agregar tarjeta Spotify** en el editor; la vista previa no ejecuta controles. La tarjeta necesita al menos 3×2 celdas o 320×220 píxeles en modo libre.

Condiciones para probarla:

1. Windows 10 versión 1809 o posterior, o Windows 11, con Python compatible con las dependencias (la instalación actual usa Python 3.13).
2. Spotify de escritorio abierto, sesión iniciada y reproducción seleccionada en **esta PC**. Primero reproducí una canción desde Spotify.
3. Ejecutar el servidor en tu sesión normal de Windows; las sesiones multimedia no están disponibles desde ciertos servicios o entornos aislados.
4. PC e iPad en la misma red local, puerto 8765 accesible y el iPad vinculado al panel. Recargá Safari después de actualizar el proyecto.

Los datos se consultan cada dos segundos y la barra avanza cada segundo entre consultas. Una respuesta del botón confirma si Spotify aceptó el control; el cambio de pista suele reflejarse en unos dos a cuatro segundos. La carátula se obtiene desde Windows y queda en memoria, fuera de los respaldos. Si no está disponible se muestra un icono musical. Los controles no disponibles aparecen desactivados. Si se pierde la conexión, el progreso se detiene y aparece un aviso hasta reconectar.

Si la tarjeta muestra **Instalá la integración**, ejecutá nuevamente la preparación con el mismo Python usado para iniciar el servidor. Si muestra un error de Windows, reiniciá el servidor desde tu terminal normal, con Spotify abierto. Si la canción suena en otro dispositivo de Spotify Connect, elegí la PC como salida. Esta versión no incluye volumen, playlists, desplazamiento manual del progreso ni reproducción en el iPad.

Pruebas: `npm test` incluye sesiones simuladas, controles, recuperación, migración y respaldo. `node tests/browser_smoke.mjs` usa Spotify simulado para verificar el editor, carátulas, controles y actualización en Chrome a tamaño de iPad; nunca controla tu Spotify. La comprobación en Safari del iPad físico debe hacerse aparte siguiendo los pasos anteriores.

## Desarrollo con actualización automática

Requiere Python 3 y Node.js con npm. La primera vez ejecutá `npm install`; después iniciá el panel con:

```powershell
npm run dev
```

Nodemon reinicia Python al cambiar `server.py`, archivos de `public/` o su configuración. El panel del iPad y el editor abiertos se recargan automáticamente al reconectarse, aproximadamente cada 1,5 segundos. Si el editor tiene cambios sin guardar o está transfiriendo un respaldo, espera a que termines antes de recargar. Si aparece el aviso de código actualizado, guardá los cambios.

Los cambios en `data/` (botones, imágenes y respaldos), pruebas y dependencias no provocan reinicios. El token de vinculación se conserva; el código de seis números y los estados estimados de botones se regeneran al reiniciar el servidor. Si ya ejecutaste `python server.py`, detenelo con `Ctrl+C` antes de usar `npm run dev`, para liberar el puerto 8765. Se puede escribir `rs` en la consola de nodemon para reiniciar manualmente.

Para iniciar sin vigilancia ni recarga automática, usá `npm start` o `python server.py`.

La prueba `npm run test:dev` verifica el reinicio de Python en una instalación temporal, la persistencia del vínculo, la exclusión de `data/` y la protección de cambios sin guardar.

## Personalización y carpetas

El panel y el editor usan un estilo Apple oscuro. Desde `http://localhost:8765/editor`, seleccioná un botón para cambiar su **nombre, color de fondo, foto, icono y acción**. Los ajustes de bordes, tipografía, animaciones y estados visuales están en **Avanzado**. El color y la foto del fondo de página se cambian en **Fondo y página**.

En **Mostrar en el botón**, elegí **Solo nombre**, **Solo icono** o **Icono y nombre**. Podés elegir uno de los 16 símbolos de líneas de estilo Apple (micrófono, auriculares, música, pantalla y otros) o subir una imagen propia. El nombre se conserva para identificar el botón en el editor, al pasar el mouse y con lectores de pantalla, aunque se oculte visualmente. Los botones anteriores mantienen su presentación y los iconos se incluyen en el respaldo; los símbolos incorporados funcionan sin Internet.

Cada página tiene un selector de distribución:

- **Cuadrícula**: predeterminada para páginas e instalaciones nuevas. Tiene seis columnas; cada botón puede ocupar de una a seis columnas y de una a cuatro filas. Hay accesos rápidos 1×1, 2×1 y 2×2. Arrastrá un elemento sobre otro para cambiar su orden; el panel crece verticalmente para que no se superpongan.
- **Libre**: permite mover y redimensionar botones usando las esquinas. Las páginas anteriores mantienen este modo. Cambiar de modo conserva las posiciones y tamaños libres guardados.

Usá **Crear carpeta**, seleccioná su nombre y después **Abrir carpeta** para agregar botones dentro. También podés mover un botón existente usando **Ubicación**. Hay un solo nivel de carpetas. Al borrar una carpeta con contenido, el editor ofrece conservar los botones en la página o eliminarlos también; conservarlos es la opción principal.

En el iPad, tocá la carpeta para abrir sus botones. Los atajos y enlaces funcionan igual que afuera y mantienen abierta la carpeta. Cerrala con **Cerrar**, tocando el fondo exterior o usando Escape con un teclado. Los estados visuales se siguen sincronizando mientras está abierta.

## Trasladar la personalización a otra PC

Git no incluye `data/`: clonar el repositorio en otra PC **no transfiere** la personalización. Si todavía tenés la PC anterior, abrí allí el editor y exportá el respaldo. También podés detener ambos servidores y copiar la carpeta `data` completa a la nueva instalación para recuperar los datos anteriores.

Para usar el respaldo desde el editor:

1. Guardá los cambios y elegí **Exportar personalización**. Se descarga `mi-panel.zip` con las páginas, carpetas, botones e imágenes guardadas.
2. En la nueva PC, iniciá el servidor y abrí el editor mediante `localhost`.
3. Elegí **Importar respaldo ZIP**, revisá el nombre y las cantidades y pulsá **Reemplazar con este respaldo**. La importación reemplaza el panel completo.

Antes de reemplazar los datos se guarda un ZIP recuperable en `data/before-restore-…zip`. Para volver al panel anterior, importá ese archivo desde el mismo editor. Un archivo inválido o un fallo de restauración conserva la configuración anterior. Los respaldos no incluyen tokens ni códigos de vinculación: en la nueva PC se vincula el iPad con su nuevo código.

Se admiten hasta 12 páginas, 80 elementos por página (incluidos carpetas y botones interiores), 200 imágenes de hasta 2,5 MB cada una y respaldos de hasta 505 MB. Exportación e importación requieren autenticación y acceso desde la PC local. Todo funciona sin servicios externos.

## Verificación del rediseño

```powershell
python -m unittest discover -s tests -v
node tests/test_layout.js
node tests/browser_smoke.mjs
```

La última prueba requiere Node 22 o posterior y Chrome local; permite indicar otra instalación con `CHROME` y otro Python con `PYTHON`. Usa una instalación temporal, simula las acciones de Windows y no lee ni modifica tu `data/`. Guarda capturas de PC e iPad en `.cache/`. La prueba en Chrome no sustituye la comprobación táctil y de rendimiento en Safari del iPad 2 físico.

Un panel de control independiente para Windows y Safari de iOS 9. No contiene código de LapDeck. El diseño y los botones se editan desde la computadora.

## Estado del proyecto

Funciona como panel local con vinculación por código de seis dígitos, editor visual, páginas y botones libres, imágenes y animaciones, atajos de Windows y apertura de páginas. Los botones pueden alternar texto, color e icono como feedback visual; Discord trae ejemplos para mutear y ensordecer.

Pendiente: prueba visual y de rendimiento en el iPad 2 real, panel táctil, vista de pantalla, selección del monitor donde abrir ventanas, conexión remota y lectura del estado real de Discord. El feedback actual de Discord es **estimado** y se basa en los toques hechos desde el panel.

`data/` contiene el token, la configuración y las imágenes personales. Está excluida del repositorio. El servidor la crea al iniciar por primera vez.

## Iniciar

Requiere Python 3 en Windows. En esta carpeta, ejecutar:

```powershell
python server.py
```

El servidor muestra dos direcciones: `http://localhost:8765/editor` para editar desde la PC y una dirección corta `http://<IP>:8765` para abrir desde Safari en el iPad. También muestra un **código de 6 números**. Escribilo en la pantalla del iPad una sola vez. Ambos dispositivos deben estar en la misma red Wi-Fi local; no se necesita Internet. Si Windows pregunta por el firewall, permitir el acceso en redes privadas.

La primera vez se crea `data/token.txt`. Es una clave de control que el iPad guarda automáticamente después de ingresar el código: no la publiques ni la compartas. El código cambia al reiniciar el servidor. Desde Safari se puede usar «Agregar a inicio». Los cambios se guardan en `data/config.json`.

## Funciones incluidas

- Crear y ordenar páginas desde el editor visual de la PC.
- Arrastrar botones libremente en un lienzo de 1024 px y redimensionarlos desde las esquinas inferiores.
- Ajustar posición, tamaño, color, borde, esquinas, opacidad, tamaño y alineación del texto.
- Subir PNG, JPG, SVG o GIF para un icono, una imagen de botón o el fondo de una página (máximo 2,5 MB por archivo). Las imágenes quedan guardadas en `data/assets`.
- Elegir animaciones de botón (pulso, flotar, brillo) y de fondo (movimiento o zoom).
- Activar **Cambio visual al tocar** en cualquier botón: texto, color e icono alternativos para su estado activo. Los botones de Discord lo traen activado.
- Acción **Atajo**: enviar una combinación de teclas a Windows (ej. `ctrl+shift+m`).
- Acción **Página**: abrir una URL en el navegador predeterminado de Windows.
- Comunicación HTTP local con autenticación; cada toque recibe una respuesta del servidor.

Los botones de ejemplo para Discord envían sus atajos predeterminados. Discord debe estar abierto; si no responden en segundo plano, configurar esos atajos en Discord como combinaciones globales. Por ahora, un botón de atajo *alterna* el estado: la interfaz no sabe si el micrófono quedó encendido o apagado.

El indicador de Discord se actualiza cuando el atajo se envía desde este panel y se sincroniza entre clientes conectados. Está marcado **ESTIMADO** porque no lee el estado real de Discord: si usás el mouse o un atajo directamente en Discord, el indicador puede quedar desfasado. Se reinicia al reiniciar el servidor. La lectura oficial del estado real requiere una integración aprobada con el Social SDK de Discord.

## Alcance del prototipo

Esta primera base no incluye todavía panel táctil, vista de pantalla, selección de monitor ni conexión remota. La acción Página usa el navegador predeterminado y la ventana que este decida. El siguiente módulo será la automatización de ventanas para abrir una URL en el monitor seleccionado.

Safari de iOS 9 debe probarse en el iPad físico. La interfaz evita `fetch`, `async/await`, CSS Grid y service workers. Se puede usar sin Internet cuando existe la red local entre iPad y PC. Sin enlace entre ambos, los botones no pueden ejecutar acciones en la PC.

## Pruebas

```powershell
python -m unittest discover -s tests -v
```

El servicio usa HTTP dentro de la red local. No expongas el puerto 8765 directamente a Internet.

## Actualizar una instalación anterior

Detener el servidor con `Ctrl+C`. Reemplazar `server.py` y la carpeta `public` por los archivos de esta versión; **conservar la carpeta `data`** para no perder botones ni el vínculo del iPad. Iniciar de nuevo con `python server.py`. El editor convertirá automáticamente la configuración anterior al nuevo formato al guardarla. Si el iPad tenía la página abierta, recargarla para ver el nuevo diseño.
