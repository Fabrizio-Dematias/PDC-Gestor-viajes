# Manual de funcionamiento

Para quien tenga que levantar el sistema, usarlo en la demo o saber qué
mirar cuando algo no anda. Los detalles de diseño están en los otros
documentos de `docs/`; acá está lo operativo.

## 1. Qué es lo que hay que tener

| Necesito | Para qué | Cómo se verifica |
|---|---|---|
| **Node 22.5 o más** (se probó con la 25) | Los servicios usan `node:http` y `node:sqlite`, que vienen con Node | `node -v` |
| **Docker** | Sólo para Postgres y Redis locales | `docker ps` |
| **Un archivo `.env`** | Dice a qué Postgres conectarse | ver 3 |
| `npm install` hecho una vez | Dependencias | existe `node_modules/` |

No hace falta instalar nada más: las bases SQLite de vuelos, hospedaje,
traslado y notificaciones se crean y se siembran solas la primera vez
que arranca cada servicio.

## 2. Qué se levanta y en qué puerto

El sistema son siete servicios del lado del servidor más el front. Cada
uno es un proceso independiente.

| Qué | Puerto | Depende de | Si se cae |
|---|---|---|---|
| **Postgres** (Docker o Supabase) | 5432 | — | `usuarios` queda "no listo"; la búsqueda sigue andando |
| **Redis** (Docker) | 6379 | — | Se pierde la caché y el aviso de reservas; se sigue buscando y reservando |
| Registro de servicios | 4006 | — | Se pierde el descubrimiento dinámico; se usan las direcciones fijas |
| Usuarios | 4003 | Postgres | No hay login ni preferencias; las búsquedas siguen |
| Vuelos | 4001 | — | La sección de vuelos queda "no disponible" |
| Hospedaje | 4002 | — | Ídem, sólo hospedaje |
| Traslado | 4004 | — | Ídem, sólo traslado |
| Notificaciones | 4005 | Redis | Las reservas siguen; los avisos esperan en la cola |
| **Agregador** (la puerta de entrada) | 4000 | los anteriores | Sin él el front no ve nada |
| **Front** (Vite) | 5173 | el agregador | — |

La idea central del proyecto es esa columna de la derecha: **si un
servicio se cae, el resto sigue andando** y la pantalla muestra sólo esa
sección como "no disponible".

## 3. Puesta en marcha, paso a paso

```bash
# 1) una sola vez
npm install
cp .env.example .env        # y completar la base, ver abajo

# 2) cada vez que se arranca
npm run infra:up            # Postgres + Redis en Docker
npm run back                # los siete servicios, en una terminal
npm run dev:back            # el front conectado, en otra: http://localhost:5173
```

**El `.env`** no se sube al repo (tiene credenciales). Con la plantilla
sin tocar el sistema usa el Postgres de Docker (`gestor/gestor`). Si el
equipo usa la base de Supabase, los valores `PG*` salen del panel del
proyecto (Project Settings → Database) y se los pasa quien administre
esa base. Con Supabase el primer arranque de `usuarios` tarda unos 10 s
en estar listo: es normal, la conexión es lenta.

Para saber si está todo arriba:

```bash
curl localhost:4000/salud               # el estado de cada servicio
curl localhost:4006/api/v1/servicios    # quién está registrado y sano
```

También en la pantalla: `/admin` (como administrador) → "Servicios del
sistema".

Para apagar: `Ctrl+C` en la terminal de `npm run back`. Un servicio
suelto: `npm run matar hospedaje`; para volver a subirlo,
`npm run back:hospedaje`.

**Sólo el front, sin nada de lo anterior:** `npm run dev`. Usa un
servidor simulado en memoria con el mismo contrato (sirve para trabajar
la pantalla sin el backend; no hay login, reservas reales ni rutas
reales).

## 4. Cuentas de prueba

Se crean solas al arrancar `usuarios` (login único en `/login`):

| Quién | Credenciales |
|---|---|
| Cliente de la agencia demo | `invitado@demo.com` / `demo1234` |
| Admin de ag-demo | `admin` / `admin1234` |
| Admin de ag-sur | `admin-sur` / `admin1234` |

Buscar y ver resultados no exige cuenta. `/registro` crea una cuenta
nueva y muestra el código de verificación en pantalla (no hay servidor
de correo real).

## 5. Cómo se usa

1. **Buscar.** En el inicio, elegir la solapa (Vuelos, Hospedaje,
   Traslado). Origen y destino se escriben: dos o tres letras de una
   ciudad, un país o un código alcanzan (`cordoba`, `esp`, `ez`). Se
   puede elegir una **ciudad** (Buenos Aires busca en Ezeiza y
   Aeroparque) o un aeropuerto concreto.
2. **Resultados.** Vuelos puede traer directos y recorridos con una o dos
   escalas; "Ver itinerario completo" muestra cada tramo, las esperas y,
   cuando hay que cambiar de aeropuerto dentro de la ciudad, un aviso.
3. **Ida y vuelta.** Se elige un vuelo por tramo y recién ahí se puede
   continuar.
4. **Reservar.** Tarifa → datos de los pasajeros → confirmar. La reserva
   es real (descuenta asientos de ese vuelo) pero no hay cobro. El código
   que se muestra es el de la reserva, y la confirmación por email llega
   unos segundos después por la cola. Es un email simulado: aparece en el
   log del servicio `notificaciones`.
5. Sólo se reservan vuelos del catálogo propio. Con Duffel las ofertas
   se ven pero no se pueden reservar.

## 6. Cómo mostrar que tolera fallos (la demo)

**Apagando un servicio de verdad:**

```bash
npm run matar hospedaje     # buscar de nuevo: vuelos anda, hospedaje "no disponible"
npm run back:hospedaje      # volver a levantarlo; se recupera solo
```

**Con el interruptor, sin matar nada:** como administrador, el panel
"Simular fallos" (abajo a la derecha) pone un servicio en *Lento*,
*Caído* o *Colgado*. *Colgado* es el importante: es el que `docker stop`
no puede reproducir, y lo corta el timeout.

**El canal asíncrono:**

```bash
npm run matar notificaciones   # se apaga sólo el consumidor
# hacer una reserva: responde igual, al instante
docker exec gestor-viajes-redis-1 redis-cli XINFO GROUPS reservas:eventos   # "lag" = avisos en espera
npm run back:notificaciones    # al volver, los procesa
```

**La carrera por el último asiento y el failover entre instancias** tienen
su paso a paso en `docs/modulo-3-comunicacion.md` (sección 5) y
`docs/modulo-4-middleware.md` (sección 5).

## 7. Datos reales y simulados

Aeropuertos, ciudades, aerolíneas y **qué aerolínea vuela qué ruta** son
reales, pero de 2014 (OpenFlights). Los horarios, precios y la
disponibilidad son simulados. No hay que presentarlo como información de
vuelos vigente.

Para vuelos de una API real: en el `.env`, `PROVEEDOR=duffel` y
`DUFFEL_ACCESS_TOKEN=duffel_test_...`, y reiniciar. El token es de
prueba: no puede cobrar ni reservar. Con esto las búsquedas tardan unos
2–3 s y el agregador les da más tiempo (5,5 s).

## 8. Pruebas

| Comando | Qué comprueba | Necesita |
|---|---|---|
| `npm test` | Tolerancia a fallos en el front | nada |
| `npm run test:back` | Aislamiento, timeouts, rutas, login, circuit breaker | sistema levantado |
| `npm run lint` · `npm run build` | Estilo y compilación | nada |

**Ojo:** `test:back` crea usuarios, reservan asientos y
publican eventos. No correrlas contra la base compartida de Supabase ni
dejarlas ensuciando las bases de la demo. Se levanta el sistema aparte
con un Postgres local, otro Redis y otro directorio de datos:

```bash
DATOS_DIR=/tmp/gv-pruebas REDIS_URL=redis://localhost:6379/1 \
PGHOST=localhost PGUSER=gestor PGPASSWORD=gestor PGDATABASE=gestor_viajes PGSSL=false \
PUERTO_AGREGADOR=4200 PUERTO_VUELOS=4201 PUERTO_HOSPEDAJE=4202 PUERTO_USUARIOS=4203 \
PUERTO_TRASLADO=4204 PUERTO_NOTIFICACIONES=4205 PUERTO_REGISTRO=4206 \
URL_VUELOS=http://localhost:4201 URL_HOSPEDAJE=http://localhost:4202 \
URL_USUARIOS=http://localhost:4203 URL_TRASLADO=http://localhost:4204 \
URL_NOTIFICACIONES=http://localhost:4205 URL_REGISTRO=http://localhost:4206 \
node --disable-warning=ExperimentalWarning servidor/arrancar.mjs
```

y las pruebas con las mismas variables más
`URL_AGREGADOR=http://localhost:4200 URL_VUELOS=http://localhost:4201
URL_NOTIFICACIONES=http://localhost:4205 URL_REGISTRO=http://localhost:4206`.
Esperar a que todos los servicios respondan `/salud/ready` antes de
empezar (el agregador contesta antes que los demás).

## 9. Si algo no anda

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Las tres secciones dicen "no disponible" | El agregador anda pero los servicios no | `curl localhost:4000/salud`; revisar la terminal de `npm run back` |
| "Ninguna instancia de este servicio está lista" | El servicio está apagado o no pasa su `/salud/ready` | `npm run back:<servicio>`; mirar `/admin` |
| `usuarios` "no listo" / no se puede loguear | Postgres no contesta (Docker apagado o Supabase sin conexión) | `npm run infra:up`; revisar los `PG*` del `.env` |
| `usuarios` reintenta con `XX000` | Supabase no responde (proyecto pausado) | Usar el Postgres local sin tocar el `.env`: `PGHOST=localhost PGDATABASE=gestor_viajes PGUSER=gestor PGPASSWORD=gestor PGSSL=false npm run back` |
| Login falla con un token viejo | Sesión de otro entorno guardada en el navegador | Se descarta sola al primer 401; volver a loguearse |
| "Address already in use" | Quedó un proceso de una corrida anterior | `lsof -tiTCP:<puerto> -sTCP:LISTEN \| xargs kill` |
| La reserva dice "sin cupo" | Se agotaron los asientos de ese vuelo (hay 100–300 por vuelo) | Probar otro vuelo u otra fecha |
| Confirmación sin aviso por email | `notificaciones` caído o Redis caído | `curl localhost:4005/salud`; ver `docker ps` |
| Búsqueda con Duffel "no disponible" | Token ausente o Duffel lento (> 5,5 s) | Revisar `DUFFEL_ACCESS_TOKEN`; volver a `PROVEEDOR=ficticio` |

## 10. Dónde está cada cosa

- `README.md` — visión general y mapa del código.
- `docs/contrato-agregador.md` — el contrato de la API (el porqué).
- `docs/openapi.yaml` — el mismo contrato en formato máquina; `npm run docs:openapi` lo regenera.
- `docs/analisis-rutas.md` — qué rutas se pueden buscar y qué errores se encontraron.
- `docs/modulo-3-comunicacion.md` y `docs/modulo-4-middleware.md` — lo de cada módulo.
- `docs/arquitectura-multi-nodo.md` — los tres tipos de nodo y los `docker-compose`.
- `docs/proveedor-externo.md` — Amadeus, Duffel y el resto de las opciones.
