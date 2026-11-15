# Gestor de viajes

Buscador estilo Booking (vuelos + hospedaje + traslado) cuyo requisito central es la
**tolerancia a fallos parciales**: si un servicio se cae, el resto del
sistema sigue funcionando y el usuario puede seguir navegando.

Proyecto final de **Programación Distribuida y Componentes**.

## Estado

Backend distribuido andando: siete servicios (más un nodo por agencia),
cada uno con su propia base, coordinados por un agregador que los llama
en paralelo con timeout y devuelve resultados parciales. Sobre esa base
se sumaron los dos módulos de la materia que siguieron a la arquitectura:

- **Módulo 3, comunicación** (`docs/modulo-3-comunicacion.md`): reservas
  reales con cupo atómico e idempotencia, un canal asíncrono (Redis
  Streams) para los avisos de confirmación, y la prueba que muestra la
  carrera por el último asiento y su solución.
- **Módulo 4, middleware** (`docs/modulo-4-middleware.md`): registro de
  servicios con health checks, sondas `live`/`ready`, API versionada
  (`/api/v1`) y descrita con OpenAPI (`docs/openapi.yaml` para la API
  pública, `docs/openapi-interno.yaml` para los contratos entre servicios).
- **Módulo 5, seguridad** (`docs/informe-amenazas.md`): TLS entre
  componentes con una CA propia y TLS mutuo hacia los servicios internos
  (`TLS=on`), verificación del certificado de Postgres, límite de intentos
  de login, y la prueba de recuperación ante fallos
  (`docs/recuperacion-ante-fallos.md`).
- **Módulo 6, patrones y escalabilidad**
  (`docs/modulo-6-patrones-escalabilidad.md`): fachada, proxy y
  adaptador; circuit breaker y observador distribuido; réplicas con
  balanceo de carga y failover.

La documentación de cada módulo, con su entrega y su tag, está indexada
en `docs/README.md`.

El front funciona en dos modos. Sin backend habla con un servidor
simulado en memoria que cumple el mismo contrato; con backend habla con
el agregador. Los componentes son los mismos en los dos casos.

| Servicio | Puerto | Base propia | Contenido |
|---|---|---|---|
| Agregador (Gateway) | 4000 | Redis (breaker + caché) | no guarda nada propio; publica los eventos de reservas |
| Vuelos | 4001 | `vuelos.db` | 6071 aeropuertos, ~131 000 itinerarios, cupos y reservas |
| Hospedaje | 4002 | `hospedaje.db` | ~48 500 alojamientos (8 por aeropuerto; se aloja uno en la ciudad) |
| Traslado | 4004 | `traslado.db` | 4 tipos de vehículo, tarifado por ciudad |
| Usuarios | 4003 | Postgres (nodo central) | agencias, usuarios, preferencias, auditoría |
| Notificaciones | 4005 | `notificaciones.db` + stream en Redis | consume los eventos de reservas y "envía" la confirmación |
| Registro de servicios | 4006 | memoria | quién está vivo y dónde; verifica `/salud/ready` de cada instancia |
| Nodo de agencia | 4100+ | `registro-<agencia>.db` | bitácora local, una instancia por agencia |

Nota: `usuarios` y `agregador` son los dos servicios que dejaron de ser
zero-dependency — ahora hablan con Postgres y Redis del nodo central
(`docs/arquitectura-multi-nodo.md`). Los verticales siguen igual que
siempre, cada uno con su SQLite propia.

Los verticales (`vuelos`, `hospedaje`, `traslado`) siguen sin
dependencias: usan `node:http` y el `node:sqlite` que viene con Node
22+. Las bases se crean y se siembran solas la primera vez que arranca
cada servicio.

### De dónde salen los datos

Los aeropuertos, las ciudades, los países, las aerolíneas y **qué
aerolínea vuela qué ruta** son reales, para el mundo entero: el
dataset completo de [OpenFlights](https://openflights.org/data.html),
generado con `servidor/datos-referencia/generar.mjs` (6071 aeropuertos,
983 aerolíneas, 65 647 rutas). Las distancias salen de las coordenadas
y las duraciones de las distancias. Detalle de qué está traducido y qué
no en `servidor/datos-referencia/FUENTE.md`.

Lo simulado son **los horarios, la disponibilidad y los precios** — que
es exactamente lo que cobra un GDS y lo que daría el proveedor externo.

Consecuencia práctica para **vuelos**: la red de rutas es la real, pero
el buscador no se limita a los vuelos directos, que cubren apenas el
0,4 % de los pares de aeropuertos. Se puede buscar de **cualquier lugar a
cualquier lugar** unidos por un recorrido de hasta dos escalas, con
horarios que cierran, el huso horario real de cada aeropuerto y, cuando
hace falta, un cambio de aeropuerto dentro de la ciudad (Tucumán →
Aeroparque → Ezeiza → Madrid). Si no existe recorrido, la respuesta es
vacía: no se inventa un vuelo. Un *lugar* es una **ciudad** (`BUE`:
Ezeiza y Aeroparque juntos) o un aeropuerto (`EZE`). **Hospedaje** y
**traslado** ofrecen cualquier ciudad del catálogo, haya o no vuelo hasta
ella. El análisis completo, con cifras y con los errores que lo
originaron, está en `docs/analisis-rutas.md`.

Origen y destino se eligen escribiendo, no de una lista desplegable: dos
o tres letras de una ciudad, un país o un código IATA alcanzan
(`cordoba`, `Córdoba`, `esp` y `ez` funcionan igual). El catálogo lo
sirve `GET /api/v1/lugares`.

## Arrancar

`usuarios` y `agregador` necesitan Postgres y Redis del nodo central
arriba (`docker`, sólo para esto — ver "Nodos y despliegue" más abajo).

```bash
npm install
npm run infra:up   # Postgres + Redis, en Docker

# Sistema completo (recomendado)
npm run back       # los siete servicios del nodo central + cómputo
npm run dev:back   # front conectado, en http://localhost:5173

# Sólo el front, contra el servidor simulado
npm run dev

# Pruebas
npm test                   # tolerancia a fallos en el front (no necesita backend)
npm run test:back          # aislamiento, timeout, rutas y login en el backend real
npm run build
```

Las pruebas de backend reservan asientos y mandan avisos: si se
corren seguido conviene levantar el sistema con `DATOS_DIR=/tmp/pruebas`
para que esas reservas no ensucien las bases de la demostración.

La API completa está descrita en `docs/openapi.yaml` y, con el sistema
levantado, en `http://localhost:4000/api/v1/docs`.

## Cuentas de prueba

Login real (contrato §10) — hace falta backend conectado. Estas
cuentas quedan sembradas solas la primera vez que arranca `usuarios`:

Un solo `/login` para los dos: el campo acepta un email (clientes) o un
username (administradores) — el backend resuelve cuál es con la misma
consulta.

| Quién | Credenciales |
|---|---|
| Cliente (ag-demo) | `invitado@demo.com` / `demo1234` |
| Admin de ag-demo | `admin` / `admin1234` |
| Admin de ag-sur | `admin-sur` / `admin1234` |

Para una cuenta nueva, `/registro` pide email + contraseña y muestra el
código de verificación en pantalla (con la etiqueta "demo"): no hay
servidor de correo real detrás, ver `servidor/comun/email.js`. Se puede
buscar y ver resultados sin ninguna cuenta — el login se ofrece, no se
exige.

## Cómo se demuestra el fallo parcial

### Apagando un servicio de verdad

```bash
npm run matar hospedaje     # equivale al docker stop de la Fase 5
```

Volvé a buscar: vuelos responde normal y hospedaje queda en "no
disponible" dentro de su sección. Para levantarlo otra vez:

```bash
npm run back:hospedaje
```

Se puede seguir apagando: con **usuarios** caído la búsqueda igual
funciona. El agregador falla abierto —asume que todos los verticales
están habilitados— porque dejar al usuario sin ninguna sección por una
caída del servicio de preferencias convertiría un fallo secundario en
una caída total.

### Con el interruptor, sin matar nada

Abrí **Simular fallos** (abajo a la derecha) y poné *Vuelos* en
**Colgado**. Con el backend conectado, el panel le manda ese estado al
servicio real; sin backend, al simulado. El panel además lee el estado
verdadero cada 5 segundos, así que si apagás un proceso desde otra
terminal se entera solo.

Hospedaje aparece a los ~600 ms. Vuelos se queda cargando hasta que el
`AbortController` lo corta y esa sección —y sólo esa— pasa a "no
disponible".

Los cuatro estados simulables:

| Estado    | Qué hace                                             |
|-----------|------------------------------------------------------|
| `OK`      | responde en 300–900 ms                               |
| `Lento`   | tarda 1,8 s: entra justo dentro del presupuesto      |
| `Caído`   | 503 inmediato, como un contenedor apagado            |
| `Colgado` | acepta la conexión y nunca responde                  |

También se puede fijar por URL, para dejar una pestaña lista por
escenario antes de la defensa:

```
/resultados?destino=MAD&ida=2026-10-12&caos=hospedaje:caido
/resultados?destino=MAD&ida=2026-10-12&caos=vuelos:colgado,hospedaje:lento
```

`Colgado` es el que importa: es el único que **no** se puede reproducir
con `docker stop`, y es el que cuelga a los sistemas que no tienen
timeout.

## Nodos y despliegue

El sistema completo son tres tipos de nodo (detalle en
`docs/arquitectura-multi-nodo.md`), cada uno con su propio
`docker-compose`:

```bash
# 1) Nodo central — Postgres, Redis, usuarios, agregador
docker compose -f docker-compose.central.yml up -d

# 2) Nodo de cómputo — vuelos, hospedaje, traslado
docker compose -f docker-compose.workers.yml up -d

# 3) Nodos de agencia — dos de ejemplo (ag-demo, ag-sur), front +
#    bitácora local de cada uno
docker compose -f docker-compose.agencias.yml up -d --build
```

Con los tres arriba: `http://localhost:5173` (agencia demo, azul) y
`http://localhost:5174` (agencia sur, ámbar) son el mismo código de
`src/`, cada uno con su marca y su config de verticales.

Para la demostración de "se cae un nodo entero" — la que `docker stop`
de un solo servicio no muestra —:

```bash
docker compose -f docker-compose.workers.yml down
```

Los dos fronts siguen respondiendo: la próxima búsqueda de cada
vertical vuelve con `cacheado: true` en vez de quedar `unavailable`
(mientras haya una búsqueda buena reciente en Redis).

## Mapa del código

```
docs/
  README.md                  Índice de la documentación por módulo
  modulo-1-arquitectura.md   El sistema en las vistas 4+1
  manual-de-funcionamiento.md Cómo levantar, usar y diagnosticar el sistema
  contrato-agregador.md      El contrato, escrito antes que el código
  openapi.yaml               El contrato en formato máquina (generado)
  openapi-interno.yaml       Los contratos entre servicios (generado)
  analisis-rutas.md          Qué rutas se pueden buscar, con cifras, y los
                             errores que se encontraron al revisar
  modulo-3-comunicacion.md   Síncrono/asíncrono, semántica de entrega,
                             concurrencia (reservas)
  modulo-4-middleware.md     Middleware, contratos, registro de servicios
  modulo-6-patrones-escalabilidad.md Patrones, réplicas, balanceo y monitorización
  informe-amenazas.md        Qué se protegió y de qué; cómo activar TLS
  recuperacion-ante-fallos.md Mecanismos de recuperación y su prueba
  arquitectura-multi-nodo.md Los tres tipos de nodo y por qué
  proveedor-externo.md       Qué pasó con Amadeus, Duffel y el resto

servidor/                    Backend. Sólo usuarios/agregador dependen de
                             algo externo (Postgres, Redis) — el resto
                             sigue con node:http y node:sqlite nomás.
  datos-referencia/          Aeropuertos, aerolíneas y rutas reales (OpenFlights)
                             y ciudades.json, que los agrupa en ciudades
  comun/                     El middleware (docs/modulo-4-middleware.md)
    http.js                  Servidor HTTP compartido por los servicios:
                             rutas, JSON, gzip, /salud/live y /salud/ready,
                             x-request-id, apagado ordenado
    base.js                  Apertura de la base SQLite propia de cada uno
    basePg.js                Pool de Postgres del nodo central
    redis.js                 Circuit breaker, caché y streams de eventos
    pedir.js                 Llamadas entre servicios, con AbortController
    descubrimiento.js        Registro, latido y descubrimiento con failover
    lugares.js               Ciudades, aeropuertos y husos horarios
    traza.js                 x-request-id a través de los servicios
    config.js                Puertos, timeouts y presupuestos por proveedor
    duffel.js, amadeus.js    Clientes de las APIs externas
    salud-demo.js            Interruptores de fallo y de readiness
    contrasenas.js           Hash de contraseñas (node:crypto scrypt)
    jwt.js                   JWT HS256 a mano — sólo lo usa el agregador
    email.js                 ProveedorDeEmail: interfaz + ficticio
  vuelos/, hospedaje/, traslado/
    index.js                 El servicio
    proveedor.js             LA INTERFAZ + selector por variable de entorno
    proveedor-ficticio.js    Implementación contra la base propia (en vuelos:
                             el motor de escalas)
    proveedor-duffel.js      Implementación contra la API real de Duffel
    proveedor-amadeus.js     Implementación contra Amadeus (escrita, sin probar)
    datos.js                 Esquema y semilla
    reservas.js              (vuelos) cupos, descuento atómico, idempotencia
  usuarios/                  Agencias, login (registro/verificación/credenciales),
                             preferencias, config de admin y auditoría — en
                             Postgres, por agencia
  nodo-agencia/              Bitácora local (SQLite) + sync contra el
                             central. Una instancia por agencia.
  notificaciones/            Consumidor de la cola de reservas (Redis Streams)
  registro/                  Registro de servicios con health checks
  agregador/index.js         API Gateway: tenant, paralelo, timeout,
                             circuit breaker, caché, resultados parciales
  agregador/reservas.js      POST /reservas: llamada síncrona a vuelos + evento
  agregador/openapi.js       La descripción OpenAPI (fuente de docs/openapi.yaml)
  arrancar.mjs, matar.mjs

src/
  api/
    cliente.js               ÚNICO punto que sabe hablar con el agregador.
                             AbortController + timeout viven acá.
    vuelos.js, hospedaje.js, traslado.js  Un fetcher por vertical
    lugares.js               Catálogo de ciudades y aeropuertos
    reservas.js              Reservar con Idempotency-Key y reintentos
    sistema.js               Estado de los servicios para el panel de admin
    perfil.js                Perfil, config de admin y gestión de administradores
    auth.js                  Registro, verificación, login (contrato §10)
    tenant.js                Branding, verticales habilitados y presupuestos
  estado/
    sesion.js                useSesion() — token + usuario, en localStorage
  dominio/
    estados.js               loading / ok / unavailable + motivos
    errores.js               ServicioNoDisponible
    lugares.js               Búsqueda de ciudades y aeropuertos mientras se escribe
    viaje.js                 Un viaje de uno o varios tramos y su total
    verticales.jsx           EL registro. Sumar un vertical = una entrada,
                             con sus propios camposBusqueda para las solapas.
  hooks/
    useBusquedaVertical.js   Donde vive el modelo de tres estados
  components/
    BuscadorLugar.jsx        Campo de lugar con sugerencias
    BuscadorViajes.jsx       Solapas por vertical (Vuelos/Hospedaje/Traslado)
    resultados/              SeccionResultados = el límite del fallo
    perfil/, admin/, demo/
  pages/                     Home, Resultados, Perfil, Admin,
                             Login, Registro, AdminLogin
pruebas/
  humo-fallos.mjs            Front: timeout, aislamiento, cancelación
  humo-backend.mjs           Backend: aislamiento, paralelismo, rutas, login
```

## Dos costuras que importan

**`src/api/cliente.js`** es el único archivo del front que sabe si hay
backend: con `VITE_API_URL` hace `fetch` contra el agregador, sin ella
usa el servidor simulado. Ningún componente se entera.

**`servidor/<vertical>/proveedor.js`** es la misma costura un nivel más
abajo: cambiar de fuente de datos es escribir un archivo nuevo y una
variable de entorno. Ver `docs/proveedor-externo.md`.

**`dominio/verticales.jsx`** es la única lista de verticales. Sumar autos
o cruceros es agregar un fetcher, un componente de lista y una entrada
ahí — resultados, preferencias, panel de admin y panel de fallos se
actualizan solos.

## Lo que falta

| Fase | Contenido |
|---|---|
| 3 ✓ | **Hecho.** Login real: email + verificación para clientes, usuario/contraseña aparte para administradores, JWT firmado por el agregador (`docs/contrato-agregador.md` §10) |
| 4 ✓ | **Hecho.** Proveedor externo: Duffel integrado y probado contra la API real (`PROVEEDOR=duffel`); Amadeus Self-Service cerró en julio de 2026. Ver `docs/proveedor-externo.md` |
| 5 ✓ | **Hecho.** Circuit breaker y caché en Redis (§9), `docker compose` por nodo (`docs/arquitectura-multi-nodo.md`) |
| 6 ✓ | **Hecho.** Panel de admin: verticales por agencia, servicios del sistema, administradores y permisos, y la auditoría a la vista |
| 7 ✓ | **Hecho.** Reservas con concurrencia y canal asíncrono (`docs/modulo-3-comunicacion.md`) |
| M4 ✓ | **Hecho.** Registro de servicios, health checks, versionado y OpenAPI (`docs/modulo-4-middleware.md`) |
| M5 ✓ | **Hecho.** TLS y TLS mutuo entre componentes, límite de intentos de login, informe de amenazas y prueba de recuperación (`docs/informe-amenazas.md`) |
| M6 ✓ | **Hecho.** Patrones y escalabilidad (`docs/modulo-6-patrones-escalabilidad.md`) |

La auditoría de cambios de configuración (Módulo 5) se registra en el
Postgres central, se consulta en `GET /api/admin/auditoria` y se ve en el
panel de administración.
