# Gestor de viajes

Buscador estilo Booking (vuelos + hospedaje + traslado) cuyo requisito central es la
**tolerancia a fallos parciales**: si un servicio se cae, el resto del
sistema sigue funcionando y el usuario puede seguir navegando.

Proyecto final de **Programación Distribuida y Componentes**.

## Estado: Fases 1 y 2

Backend distribuido andando: cuatro microservicios, cada uno con su
propia base SQLite, coordinados por un agregador que los llama en
paralelo con timeout y devuelve resultados parciales.

El front funciona en dos modos. Sin backend habla con un servidor
simulado en memoria que cumple el mismo contrato; con backend habla con
el agregador. Los componentes son los mismos en los dos casos.

| Servicio | Puerto | Base propia | Contenido |
|---|---|---|---|
| Agregador (Gateway) | 4000 | Redis (breaker + caché) | no guarda nada propio |
| Vuelos | 4001 | `vuelos.db` | 6071 aeropuertos, ~131 000 itinerarios |
| Hospedaje | 4002 | `hospedaje.db` | ~48 500 alojamientos, uno por ciudad con aeropuerto |
| Traslado | 4004 | `traslado.db` | 4 tipos de vehículo, tarifado por ciudad |
| Usuarios | 4003 | Postgres (nodo central) | agencias, usuarios, preferencias, auditoría |
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

Consecuencia práctica para **vuelos**: el buscador sólo ofrece rutas que
existen de verdad, de las 65 647 reales entre esos 6071 aeropuertos —no
cualquier combinación de origen y destino—. **Hospedaje** y **traslado**
no tienen esa restricción: como no dependen de una ruta aérea, ofrecen
cualquier aeropuerto del catálogo como destino (docs/contrato-agregador.md §4).

Origen y destino se eligen escribiendo, no de una lista desplegable: dos
o tres letras de una ciudad, un país o un código IATA alcanzan
(`cordoba`, `Córdoba`, `esp` y `ez` funcionan igual). El catálogo lo
sirve `GET /api/lugares`.

## Arrancar

`usuarios` y `agregador` necesitan Postgres y Redis del nodo central
arriba (`docker`, sólo para esto — ver "Nodos y despliegue" más abajo).

```bash
npm install
npm run infra:up   # Postgres + Redis, en Docker

# Sistema completo (recomendado)
npm run back       # los cinco servicios del nodo central + cómputo
npm run dev:back   # front conectado, en http://localhost:5173

# Sólo el front, contra el servidor simulado
npm run dev

# Pruebas
npm test           # tolerancia a fallos en el front (no necesita backend)
npm run test:back  # aislamiento, timeout y paralelismo en el backend real
npm run build
```

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
  contrato-agregador.md      El contrato, escrito antes que el código
  proveedor-externo.md       Qué pasó con Amadeus y qué opciones quedan

servidor/                    Backend. Sólo usuarios/agregador dependen de
                             algo externo (Postgres, Redis) — el resto
                             sigue con node:http y node:sqlite nomás.
  datos-referencia/          Aeropuertos, aerolíneas y rutas reales (OpenFlights)
  comun/
    http.js                  Servidor HTTP compartido por los servicios
    base.js                  Apertura de la base SQLite propia de cada uno
    basePg.js                Pool de Postgres del nodo central
    redis.js                 Circuit breaker + caché de última respuesta buena
    pedir.js                 Llamadas entre servicios, con AbortController
    amadeus.js               OAuth2 (escrito, sin probar — ver docs)
    salud-demo.js            Interruptor de fallos por servicio
    contrasenas.js           Hash de contraseñas (node:crypto scrypt)
    jwt.js                   JWT HS256 a mano — sólo lo usa el agregador
    email.js                 ProveedorDeEmail: interfaz + ficticio
  vuelos/, hospedaje/, traslado/
    index.js                 El servicio
    proveedor.js             LA INTERFAZ + selector por variable de entorno
    proveedor-ficticio.js    Implementación contra la base propia
    proveedor-amadeus.js     Implementación contra la API real (vuelos/hospedaje)
    datos.js                 Esquema y semilla
  usuarios/                  Agencias, login (registro/verificación/credenciales),
                             preferencias, config de admin y auditoría — en
                             Postgres, por agencia
  nodo-agencia/              Bitácora local (SQLite) + sync contra el
                             central. Una instancia por agencia.
  agregador/index.js         API Gateway: tenant, paralelo, timeout,
                             circuit breaker, caché, resultados parciales
  arrancar.mjs, matar.mjs

src/
  api/
    cliente.js               ÚNICO punto que sabe hablar con el agregador.
                             AbortController + timeout viven acá.
    vuelos.js, hospedaje.js, traslado.js  Un fetcher por vertical
    perfil.js                Perfil, config de admin y gestión de administradores
    auth.js                  Registro, verificación, login (contrato §10)
    tenant.js                Branding + verticales habilitados de la agencia
  estado/
    sesion.js                useSesion() — token + usuario, en localStorage
  dominio/
    estados.js               loading / ok / unavailable + motivos
    errores.js               ServicioNoDisponible
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
  humo-backend.mjs           Backend: aislamiento, paralelismo, preferencias
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
| 4 | Proveedor externo. Amadeus Self-Service cerró en julio de 2026; ver `docs/proveedor-externo.md` |
| 5 ✓ | **Hecho.** Circuit breaker y caché en Redis (§9), `docker compose` por nodo (`docs/arquitectura-multi-nodo.md`) |
| 6 | Panel de admin: ya lee y escribe contra el backend, y ya gestiona administradores y permisos; falta mostrar la auditoría |
| 7 | Reservas con concurrencia (opcional) |

La auditoría de cambios de configuración (Módulo 5) ya está: se registra
en `usuarios.db` y se consulta en `GET /api/admin/auditoria`.
