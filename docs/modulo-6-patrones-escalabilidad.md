# Módulo 6 — Patrones de diseño y escalabilidad

Qué patrones usa el sistema, dónde están en el código y cómo escala.
Todo lo que figura acá está implementado; lo que no, está en "Límites".

## 1. Patrones estructurales

| Patrón | Dónde | Qué resuelve |
|---|---|---|
| **Fachada** | El agregador (`servidor/agregador/`) | El front habla con una sola dirección. Detrás hay vuelos, hospedaje, traslado, usuarios, notificaciones y el registro, que pueden cambiar o moverse sin que el front se entere. |
| **Proxy** | `servidor/comun/pedir.js` y `descubrimiento.js` | Cada llamada a otro servicio pasa por un intermediario que agrega timeout (`AbortController`), elige instancia (descubrimiento) y reintenta en otra si la primera no responde (`conFailover`). El código que llama sólo pide "vuelos". |
| **Proxy de caché** | `servidor/comun/redis.js` | La última respuesta buena de cada vertical, por agencia, queda en Redis 10 minutos y se devuelve cuando el circuito está abierto. |
| **Proxy de protección** | `requerirSesion` / `requerirAdmin` en el agregador | Verifica el JWT, el rol y el permiso antes de dejar pasar el pedido a `usuarios`. |
| **Adaptador** | `servidor/vuelos/proveedor-duffel.js`, `proveedor-amadeus.js` | Traducen el formato de cada API externa (husos horarios, duraciones ISO 8601, precios) al contrato propio. Cambiar de proveedor es elegir otro adaptador con `PROVEEDOR`, sin tocar el resto. |

## 2. Patrones de comunicación

| Patrón | Dónde | Detalle |
|---|---|---|
| **Circuit breaker** | `servidor/comun/redis.js`, usado por el agregador | Tras 3 fallos seguidos de un vertical (en 60 s) el circuito se abre 30 s: no se lo llama y se responde con la caché o con "no disponible", sin pagar el timeout. Su estado vive en Redis, así que lo comparten todas las instancias del agregador. Valores en `servidor/comun/config.js` (`breaker`). |
| **Observador distribuido** | Redis Streams: el agregador publica `reserva_confirmada`; `servidor/notificaciones/` lo consume | El que publica no sabe quién escucha. Sumar otro interesado (facturación, estadísticas) es crear otro grupo de consumidores, sin tocar las reservas. Entrega al menos una vez, con deduplicación por `reserva_id`. |
| **Mensaje-comando** | No se usa | Ver "Límites". |

## 3. Escalabilidad

**Escalado horizontal.** Cualquier servicio se puede levantar varias
veces: cada instancia se anota sola en el registro
(`servidor/registro/`) y el agregador reparte por turnos entre las que
pasan su health check. Ejemplo con dos réplicas de vuelos:

```bash
PUERTO_VUELOS=4011 INSTANCIA_ID=vuelos@4011 URL_PROPIA=http://localhost:4011 npm run back:vuelos
```

Esto es posible porque los servicios **no guardan estado de sesión**:
la sesión viaja en el JWT y el breaker y la caché están en Redis. Dos
réplicas de vuelos comparten su base SQLite; las reservas siguen siendo
correctas porque el descuento de cupo es atómico (`BEGIN IMMEDIATE`,
`docs/modulo-3-comunicacion.md` §4).

**Balanceo de carga.** Del lado del cliente: el agregador conoce las
instancias sanas (copia del registro que refresca cada 2 s) y alterna
entre ellas (`urlServicio` en `servidor/comun/descubrimiento.js`). Una
instancia que no responde se evita y el pedido se reintenta en otra.

**Particionamiento de datos.** Funcional, no por clave: cada vertical
tiene su propia base (vuelos, hospedaje, traslado, notificaciones) y
ninguno lee la del otro. Lo compartido entre agencias está en el
Postgres central; las claves de Redis (breaker, caché) están separadas
por agencia, y cada nodo de agencia guarda su propia bitácora.

**Escalado vertical.** No hace falta para el volumen del proyecto; la
búsqueda de vuelos responde en decenas de milisegundos con 131 294
itinerarios.

## 4. Despliegue y mantenimiento

| Tema | Cómo está |
|---|---|
| **Automatización** | Un `docker compose` por nodo (`docker-compose.central.yml`, `.workers.yml`, `.agencias.yml`) con una sola imagen para todos los servicios (`Dockerfile`). Las bases se crean y se siembran solas al arrancar. En desarrollo, `npm run back` levanta todo. |
| **Monitorización** | `GET /salud` (agregador: estado de cada servicio y de la cola), `/salud/live` y `/salud/ready` en cada servicio, el panel "Servicios del sistema" del administrador y el `x-request-id` que permite seguir una búsqueda por los logs de todos los servicios (`servidor/comun/traza.js`). |
| **Pruebas de resiliencia** | `npm run matar <servicio>` apaga uno de verdad; el panel "Simular fallos" lo pone lento, caído o colgado (`servidor/comun/salud-demo.js`). `npm test` y `npm run test:back` verifican timeout, aislamiento, paralelismo y circuit breaker. |

## 5. Cómo se demuestra

```bash
npm run back && npm run dev:back

# Circuit breaker y caché: buscar una vez, poner un vertical en "Colgado"
# desde "Simular fallos" y buscar cuatro veces más. Las tres primeras
# cortan a los 2,5 s; la cuarta responde al instante con la caché
# ("datos de hace X minutos").

# Escalado horizontal y failover: levantar la segunda réplica de vuelos
# (comando de arriba), buscar varias veces (aparece en el panel del admin
# y las búsquedas se reparten) y matarla en seco:
kill -9 $(lsof -tiTCP:4011 -sTCP:LISTEN)
# las búsquedas siguen respondiendo; a los ~10 s el registro la da de baja.

# Observador: apagar el consumidor y reservar
npm run matar notificaciones   # la reserva responde igual
npm run back:notificaciones    # procesa los avisos acumulados
```

## 6. Límites

- **El agregador es un punto único de entrada.** Puede tener varias
  instancias (no guarda estado), pero no hay un balanceador delante del
  front; habría que agregar uno (Nginx) para repartir entre ellas.
- **No hay particionamiento por clave (sharding).** Cada base es única;
  las réplicas de un servicio comparten su archivo.
- **No se usa mensaje-comando.** Las órdenes (reservar) son síncronas
  porque el usuario necesita la respuesta en el momento; la cola sólo
  lleva hechos (reserva confirmada).
- **No hay pruebas de carga** (k6, JMeter); las de resiliencia son las
  descriptas en la sección 4.
