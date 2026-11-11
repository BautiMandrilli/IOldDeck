# Panel Propio

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
