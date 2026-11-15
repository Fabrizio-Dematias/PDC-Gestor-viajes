# Módulo 1 — Arquitectura de software (vistas 4+1)

El sistema descripto en las cuatro vistas del modelo de Kruchten, más el
escenario que las atraviesa. Es la versión actual de la propuesta de la
Entrega 1: desde entonces se sumaron el servicio de notificaciones, el
registro de servicios y las reservas.

## Problema

Un buscador de viajes depende de proveedores que no controla. Si la
pantalla espera a todos, basta con que uno quede colgado para que el
usuario no vea nada. Requisito central: **la caída de un servicio
degrada sólo su sección de la pantalla**. El sistema se ofrece a varias
agencias como marca blanca.

## Vista lógica — entidades

| Grupo | Entidades | Dónde viven |
|---|---|---|
| Catálogo de viajes | Aeropuerto, Ciudad, Itinerario de vuelo, Alojamiento, Opción de traslado | Base propia de cada vertical (SQLite) |
| Reservas | Cupo de un vuelo, Reserva (con su clave de idempotencia) | Base de vuelos |
| Agencias y usuarios | Agencia, Usuario (cliente o administrador), Preferencia, Configuración de vertical, Auditoría, Registro de búsqueda | Postgres del nodo central |
| Búsqueda | Criterios, Resultado por vertical en uno de tres estados: `loading`, `ok`, `unavailable` | Se arma en el agregador, no se guarda |
| Avisos | Notificación de reserva confirmada | Base de notificaciones |

## Vista de desarrollo — módulos

- `src/` — front React. Una sección por vertical; `src/api/cliente.js`
  es el único punto que habla con el backend.
- `servidor/agregador/` — API Gateway: búsquedas en paralelo, sesión,
  reservas, circuit breaker y caché.
- `servidor/vuelos/`, `hospedaje/`, `traslado/` — un servicio por
  vertical, con la fuente de datos detrás de `proveedor.js` (base
  propia, Duffel o Amadeus).
- `servidor/usuarios/`, `notificaciones/`, `registro/`,
  `nodo-agencia/` — el resto de los servicios.
- `servidor/comun/` — la capa compartida (HTTP, llamadas con timeout,
  descubrimiento, Redis, TLS, JWT).

Contratos: `docs/contrato-agregador.md`, `docs/openapi.yaml` y
`docs/openapi-interno.yaml`.

## Vista de procesos — concurrencia y sincronización

1. El agregador llama a los verticales **en paralelo**, cada uno con
   su timeout: la búsqueda tarda lo que el más lento, no la suma.
2. **Circuit breaker y caché** compartidos en Redis entre las
   instancias del agregador.
3. **Reserva del último asiento:** descuento de cupo atómico e
   idempotencia (`docs/modulo-3-comunicacion.md` §4).
4. **Canal asíncrono:** los avisos de reserva van por Redis Streams al
   servicio de notificaciones; la bitácora de cada nodo de agencia se
   sincroniza con el central en segundo plano.

## Vista física — nodos

| Nodo | Qué corre | Despliegue |
|---|---|---|
| Central | Agregador, usuarios, notificaciones, registro, Postgres, Redis | `docker-compose.central.yml` |
| Cómputo | Vuelos, hospedaje, traslado | `docker-compose.workers.yml` |
| Agencia (uno por cliente) | Front de marca blanca + nodo de agencia | `docker-compose.agencias.yml` |

Las agencias sólo hablan con el nodo central; el agregador es el único
que llama al nodo de cómputo. Detalle en `docs/arquitectura-multi-nodo.md`.

## Escenario (+1) — buscar un viaje con hospedaje caído

Un viajero busca vuelos, hospedaje y traslado mientras hospedaje está
apagado. Las tres secciones piden en paralelo (procesos); el agregador
no recibe respuesta de hospedaje, que está en el nodo de cómputo
(física), y devuelve esa sección en `unavailable` según el contrato
(desarrollo); vuelos y traslado llegan en `ok` con sus resultados
(lógica). La pantalla muestra todo menos hospedaje, que dice "no
disponible".
