# Recuperación ante fallos

Qué mecanismos tiene el sistema para seguir andando cuando un componente
falla, y la prueba que lo demuestra.

## Mecanismos

| Falla | Detección | Recuperación |
|---|---|---|
| Se cae una instancia de un servicio | **Latidos**: cada servicio se anuncia al registro cada 3 s; sin latido durante 10 s, se lo da de baja. **Health checks**: el registro consulta `/salud/ready` de cada instancia cada 2 s. | **Réplicas**: se pueden levantar varias instancias del mismo servicio; el agregador reparte entre las sanas. **Failover**: ante un error de conexión, el agregador reintenta una vez contra otra instancia y marca a la caída como sospechosa. |
| Un servicio no responde (colgado o lento) | Timeout de cada llamada (`servidor/comun/pedir.js`). | Ese vertical sale como "no disponible" y el resto de la búsqueda sigue. Tras tres fallos seguidos, el circuit breaker deja de llamarlo y se muestra la última respuesta buena (caché en Redis). |
| La base de un servicio no responde | `/salud/ready` da 503. | El servicio sigue vivo pero sale del reparto; cuando la base vuelve, se declara listo solo, sin reiniciarlo. |
| Se cae el consumidor de la cola de avisos | El mensaje queda pendiente en Redis Streams (sin `XACK`). | Al volver, lo procesa; un mensaje leído y no confirmado se reclama y se reintenta. La reserva no espera al aviso. |
| Se cae el registro de servicios | El cliente no puede bajar la lista. | Se usan las direcciones fijas de configuración (`URL_*`); al volver, los servicios se reanotan solos con su próximo latido. |
| Se corta la red de una agencia | — | El nodo de agencia guarda la bitácora en su base local y la sincroniza con el central cuando hay conexión. |
| Se pierde un pedido de reserva y el cliente reintenta | — | La `Idempotency-Key` hace que el reintento devuelva la misma reserva sin descontar otro asiento. |

## Prueba: caída de una réplica de vuelos

Se corrió el 01/11/2026 con `TLS=on`, es decir, con todas las llamadas
entre servicios por TLS mutuo.

### Pasos

```bash
npm run tls:certs && npm run back                  # con TLS=on en .env

# Segunda instancia de vuelos: se anota sola en el registro
PUERTO_VUELOS=4011 INSTANCIA_ID=vuelos@4011 URL_PROPIA=https://localhost:4011 npm run back:vuelos

# Las dos aparecen como sanas
curl --cacert certs/ca.crt --cert certs/agregador.crt --key certs/agregador.key \
  https://localhost:4006/api/v1/servicios/vuelos

# Varias búsquedas: se reparten entre las dos (cada terminal muestra las suyas)
curl --cacert certs/ca.crt "https://localhost:4000/api/v1/buscar/vuelos?origen=BUE&destino=MAD&ida=2026-12-01&pasajeros=1"

# Matar una en seco, sin baja ordenada, y seguir buscando
kill -9 $(lsof -tiTCP:4011 -sTCP:LISTEN)
```

### Resultado

| Momento | Qué pasó |
|---|---|
| Con las dos réplicas | 6 búsquedas, 6 respuestas 200, repartidas entre las dos instancias. |
| Inmediatamente después del `kill -9` | 8 búsquedas, **8 respuestas 200**. El agregador detectó el error de conexión y reintentó en la otra: `[descubrimiento] vuelos: https://localhost:4211 no responde, se reintenta en https://localhost:4201`. |
| 12 s después | El registro ya había dado de baja a la instancia muerta: sólo queda `vuelos@4201 pasando`. |

Sin el reintento, mientras el registro todavía no se enteró de la caída
(hasta ~4 s), fallaban 4 de cada 8 búsquedas (medido en el Módulo 4).

### Prueba complementaria: servicio colgado

Con el interruptor de fallos, vuelos acepta la conexión y nunca
responde:

```bash
curl --cacert certs/ca.crt -X PUT -H 'content-type: application/json' \
  -d '{"estado":"colgado"}' https://localhost:4000/api/v1/demo/salud/vuelos
```

La búsqueda de vuelos responde a los **2,5 s** con
`{"estado":"unavailable","motivo":"timeout"}`, en vez de quedarse
esperando para siempre; hospedaje y traslado siguen respondiendo
normalmente.

## Límites

- **Las réplicas de un servicio comparten su base.** La redundancia es de
  procesos, no de datos: las bases SQLite de cada servicio no se
  replican. Los datos centrales (usuarios, agencias) viven en un único
  Postgres alojado en Supabase, sin una réplica propia.
- **El registro es una sola instancia**, en memoria. Si se cae, el
  sistema sigue con las direcciones fijas; no se replica con consenso.
