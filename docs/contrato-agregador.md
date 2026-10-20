# Contrato del Agregador

Versión 5 — ciudades y escalas, reservas con cola, API versionada y
descripción OpenAPI. Definido **antes** de escribir el backend, para que
front y back puedan avanzar en paralelo sin bloquearse (Módulo 4:
contratos entre componentes).

Hoy lo cumplen dos implementaciones: el agregador real
(`servidor/agregador/`) y un servidor simulado en memoria
(`src/api/mock/servidor.js`) que permite correr el front solo. El front
elige con la variable `VITE_API_URL` y no cambia nada más.

La descripción **formal** de esta API —la que una máquina puede leer y
validar— es `docs/openapi.yaml` (generada desde
`servidor/agregador/openapi.js`) y se sirve en `/api/v1/openapi.json`;
documentación interactiva en `/api/v1/docs`. Este documento explica el
*porqué* de cada decisión; el YAML dice el *qué*, con precisión.

**Cambios respecto de la versión 4**, anotados acá para que el
documento no mienta. Ninguno rompe a un cliente de la versión 4:

- Toda la API pasa a vivir bajo **`/api/v1`**; las rutas sin versión
  siguen respondiendo, como alias deprecados (§12).
- `origen` y `destino` aceptan un código de **ciudad** además del de
  aeropuerto (`BUE` busca en Ezeiza y Aeroparque), y el catálogo
  (`GET /api/v1/lugares`) pasa a ser de ciudades con sus aeropuertos
  (§13). La forma anterior sigue en `/api/lugares` (deprecada).
- Los vuelos pueden traer **escalas**: un itinerario con `segmentos`,
  armado con rutas reales de hasta dos escalas, horas con el huso de cada
  aeropuerto y, si hace falta, un cambio de aeropuerto dentro de la
  ciudad (§2, §13).
- `GET /api/v1/buscar/:vertical` suma un **400** (`mismo_lugar`,
  `lugar_desconocido`, `solicitud_invalida`) para una búsqueda que no
  tiene sentido: no es un servicio caído y no cuenta para el circuit
  breaker (§1).
- Nuevo: **reservas** de vuelos (`POST /api/v1/reservas`, con
  `Idempotency-Key`) y el aviso de confirmación por una cola (§11).
- Nuevo: `motivo: sin_instancias` (§5), `/salud/live` y `/salud/ready`,
  `GET /api/v1/sistema/servicios` y el registro de servicios (§14).
- `GET /api/v1/tenant/config` informa además cuánto espera el agregador
  a cada vertical (`presupuestos_ms`, §3).

**Cambios respecto de la versión 3**, anotados acá para que el
documento no mienta:

- El vertical **`seguros`** se da de baja y se reemplaza por
  **`traslado`** (§2): mismo lugar en el contrato, dominio distinto
  (combi/auto privado aeropuerto↔ciudad en vez de pólizas de viaje). No
  fue una decisión técnica — el profesor pidió reorientar ese tercer
  vertical hacia traslados terrestres.
- Login real por email (con verificación) o, para administradores, por
  usuario y contraseña — reemplaza a la cabecera `x-usuario-id`
  mandada por el cliente sin verificar (§10).
- El buscador pasa a diferenciar campos por vertical: una búsqueda
  puede no traer todos los datos que un vertical necesita (por
  ejemplo, vuelos sin `origen`), y ese vertical directamente no se pide
  — no es un fallo, es una decisión del front (§4).

**Cambios respecto de la versión 2**, hechos al aplicar la arquitectura
multi-nodo de `docs/arquitectura-multi-nodo.md` y anotados acá para que
el documento no mienta:

- Nuevo vertical **`seguros`** (§2). Mismo contrato que los otros dos,
  sin `origen` ni `destino` relevantes.
- Todas las rutas aceptan la cabecera `x-agencia-id` (§8), con el mismo
  criterio de confianza que ya tenía `x-usuario-id`: si no viene, se
  asume `ag-demo` y el sistema se comporta exactamente igual que antes
  de sumar marca blanca.
- Nuevo `GET /api/tenant/config` (§8) para que el front resuelva
  branding y verticales habilitados de su agencia.
- El "cuarto caso" que el contrato ya describía en §5 (caché de última
  respuesta buena) queda implementado: una respuesta puede traer
  `cacheado: true` y `edad_ms` (§9).
- `motivo: circuito_abierto` (ya estaba en el enum de §5) pasa a
  dispararse de verdad: hay un circuit breaker en el agregador, con
  estado en Redis (§9).

**Cambios respecto de la versión 1**, todos hechos al implementar el
backend y anotados acá para que el documento no mienta:

- `PUT /api/perfil/preferencias` pasó a ser `PUT /api/perfil` con
  actualización parcial: el front también edita nombre y rol, y tener
  dos rutas para escribir el mismo recurso no se justificaba.
- Se agregaron `GET /salud` en los cuatro servicios y
  `GET /api/admin/auditoria`.
- Se agregó `PUT /api/demo/salud/:vertical` (§6), que es código de
  demostración y no forma parte del sistema.
- Se documentó qué pasa si el servicio de usuarios se cae (§7).

---

## 1. Endpoints

Todas las rutas de este documento se escriben sin versión por brevedad
(`/api/buscar/:vertical`); la ruta vigente es la misma con `/v1`
(`/api/v1/buscar/:vertical`). Ver §12.

### `GET /api/buscar/:vertical`

Búsqueda de **un solo** vertical. Es el que usa el front.

Verticales válidos: `vuelos`, `hospedaje`, `traslado`.
(Extensión futura: `autos`, `cruceros`.)

**Query params**

| Param       | Tipo   | Req. | Ejemplo      |
|-------------|--------|------|--------------|
| `origen`    | lugar² | sí¹  | `BUE`        |
| `destino`   | lugar² | sí   | `MAD`        |
| `ida`       | ISO    | sí   | `2026-10-12` |
| `vuelta`    | ISO    | no   | `2026-10-22` |
| `pasajeros` | int    | no   | `2`          |

¹ `origen` no aplica a `hospedaje`; se ignora si viene.

² Un **lugar** es un código de tres letras que puede ser el de un
aeropuerto (`EZE`) o el de una ciudad (`BUE`, que busca en todos sus
aeropuertos). Ver §13.

**200 OK**

```json
{
  "vertical": "vuelos",
  "estado": "ok",
  "generado_en": "2026-09-01T14:03:22.118Z",
  "items": [ { "...": "ver §2" } ]
}
```

**503 Service Unavailable** — el vertical no respondió, falló, o el
circuit breaker está abierto.

```json
{
  "vertical": "hospedaje",
  "estado": "unavailable",
  "motivo": "timeout",
  "generado_en": "2026-09-01T14:03:24.620Z"
}
```

`motivo` ∈ `timeout` | `error` | `circuito_abierto` | `apagado_por_admin`
| `desactivado_por_usuario` | `sin_instancias`.

**400 Bad Request** — la búsqueda no tiene sentido. El servicio está sano
y respondió: **no** es un fallo, y por eso no cuenta para el circuit
breaker (tres búsquedas mal armadas no pueden dejar a todos sin vuelos
durante 30 s).

```json
{
  "vertical": "vuelos",
  "estado": "rejected",
  "motivo": "mismo_lugar",
  "error": "el origen y el destino son el mismo lugar",
  "generado_en": "2026-10-16T11:32:01.118Z"
}
```

`motivo` ∈ `mismo_lugar` | `lugar_desconocido` | `solicitud_invalida`.

> **Regla dura:** un vertical caído devuelve **503 con cuerpo JSON
> válido**, nunca un 500 sin cuerpo ni un HTML de error. El front tiene
> que poder distinguir "no disponible" de "se rompió el contrato".

---

### `GET /api/buscar`

Búsqueda combinada. No la usa el front (ver §4), pero se expone porque es
la forma canónica del agregador y sirve para probarlo desde `curl` o
Postman en la defensa.

```json
{
  "generado_en": "2026-09-01T14:03:22.118Z",
  "vuelos":    [ { "...": "" } ],
  "hospedaje": [],
  "no_disponibles": [
    { "vertical": "hospedaje", "motivo": "timeout" }
  ]
}
```

Un vertical que aparece en `no_disponibles` tiene su clave presente y en
`[]`. **Nunca se omite la clave** — el front no debería tener que
distinguir "ausente" de "vacío".

**Esta respuesta siempre es 200**, incluso si todos los verticales
fallaron. El fallo parcial no es un error de la request: es el resultado.

---

### `GET /api/perfil` · `PUT /api/perfil`

```json
{
  "id": "u-001",
  "nombre": "Fabrizio",
  "rol": "usuario",
  "preferencias": { "vuelos": true, "hospedaje": true }
}
```

El `PUT` acepta actualización parcial: se manda sólo lo que cambió
(`nombre`, `rol` o `preferencias`) y responde el perfil completo.

De quién es el perfil sale de la cabecera `x-usuario-id`. **Esto no es
autenticación**: el backend confía en lo que le mandan. Lo reemplaza un
token verificado en la Fase 3.

### `GET /api/admin/config` · `PUT /api/admin/config/:vertical`

```json
{
  "vuelos":    { "estado": "activo" },
  "hospedaje": { "estado": "inactivo", "motivo": "datos desactualizados" }
}
```

### `GET /api/admin/preferencias-agregadas`

```json
{ "total_usuarios": 128, "vuelos": 122, "hospedaje": 86 }
```

Se calcula con un `GROUP BY` sobre la base de usuarios, no es un número
fijo.

### `GET /api/admin/auditoria`

Los últimos 50 cambios de configuración: quién, cuándo, qué vertical, y
de qué estado a qué estado (Módulo 5).

### `GET /salud`

Lo exponen los cuatro servicios. El del agregador consulta a los otros
tres y devuelve el estado de todo el sistema de un vistazo — es lo que
usa el panel de fallos del front para saber qué está caído de verdad.

---

## 2. Forma de los `items`

Cada vertical tiene su propia forma. El agregador **no** las unifica: son
dominios distintos y forzar un modelo común sería acoplar por acoplar.
Lo único obligatorio y compartido es `id` (string, único dentro del
vertical) y `precio` (`{ monto: number, moneda: "ARS"|"USD"|"EUR" }`).

**`vuelos[]`**

```json
{
  "id": "IBEZEMAD-1-2026-11-20",
  "aerolinea": "Iberia Airlines",
  "codigo_aerolinea": "IB",
  "origen": "EZE",
  "destino": "MAD",
  "salida": "2026-11-20T11:45:00.000Z",
  "llegada": "2026-11-21T04:56:00.000Z",
  "duracion_min": 791,
  "escalas": 0,
  "precio": { "monto": 950000, "moneda": "ARS" }
}
```

**Las horas.** `salida` y `llegada` son la hora de *reloj* de cada
aeropuerto, escritas con `Z`: el front las muestra tal cual, sin convertir
al huso de quien mira. El ejemplo sale a las 11:45 de Buenos Aires y
llega a las 04:56 del día siguiente en Madrid (que va 4 horas adelante):
la diferencia entre las dos horas no es la duración (791 min = 13 h 11),
es la duración **más** el huso. Antes la llegada se calculaba sumando la duración sin mirar el
huso y quedaba corrida esa diferencia; y las horas que devolvía Duffel,
que no traen `Z`, el navegador las leía como hora propia y las corría por
su huso (un vuelo de las 14:42 se veía a las 17:42 en Argentina).
`duracion_min` es la duración real de punta a punta, escalas incluidas
(Duffel la manda con días cuando el viaje pasa de las 24 h, `P1DT4H15M`;
el proveedor la convierte, y si falta la calcula con los husos).

**Escalas: `segmentos` (campo opcional).** Cuando el itinerario tiene
escalas trae además un segmento por tramo:

```json
{
  "id": "ARTUCAEP-1-2026-11-20~IBEZEMAD-1-2026-11-20",
  "aerolinea": "Aerolineas Argentinas + Iberia Airlines",
  "codigo_aerolinea": "AR",
  "origen": "TUC", "destino": "MAD",
  "salida": "2026-11-20T05:30:00.000Z", "llegada": "2026-11-21T04:56:00.000Z",
  "duracion_min": 1166, "escalas": 1,
  "precio": { "monto": 932000, "moneda": "ARS" },
  "segmentos": [
    { "origen": "TUC", "destino": "AEP",
      "salida": "2026-11-20T05:30:00.000Z", "llegada": "2026-11-20T07:25:00.000Z",
      "duracion_min": 115, "aerolinea": "Aerolineas Argentinas", "codigo_aerolinea": "AR",
      "espera_min": 260, "cambio_aeropuerto": true },
    { "origen": "EZE", "destino": "MAD",
      "salida": "2026-11-20T11:45:00.000Z", "llegada": "2026-11-21T04:56:00.000Z",
      "duracion_min": 791, "aerolinea": "Iberia Airlines", "codigo_aerolinea": "IB" }
  ]
}
```

- El `id` de un itinerario con escalas junta los ids de sus tramos con
  `~`; la reserva descuenta el cupo de cada tramo (§11).
- `espera_min` es la espera en el aeropuerto de llegada hasta el
  próximo vuelo; el último tramo no lo trae.
- `cambio_aeropuerto: true` avisa que el próximo vuelo sale de **otro
  aeropuerto de la misma ciudad** (llegás a Aeroparque y salís de
  Ezeiza): es una sola escala, con al menos 4 h de espera, y el traslado
  por tierra corre por cuenta del pasajero.
- `segmentos` es un campo **agregado sin romper a nadie**: un cliente
  que no lo conoce lo ignora y sigue mostrando origen, destino, horas,
  escalas y precio. Es el ejemplo de la tabla de versionado del Módulo 4
  (§12): agregar un campo opcional no es un cambio que rompa.

**`hospedaje[]`**

```json
{
  "id": "hot-mad-014",
  "nombre": "Hotel Puerta del Sol",
  "ciudad": "Madrid",
  "estrellas": 4,
  "puntaje": 8.6,
  "opiniones": 1204,
  "servicios": ["wifi", "desayuno", "pileta"],
  "precio": { "monto": 96000, "moneda": "ARS" }
}
```

**`traslado[]`**

```json
{
  "id": "tra-privado-mad",
  "proveedor": "CityTransfer",
  "vehiculo": "Auto privado",
  "capacidad": 3,
  "precio": { "monto": 19500, "moneda": "ARS" }
}
```

No usa `origen` ni `vuelta` (se ignoran si vienen, igual que `origen` en
hospedaje): un traslado es aeropuerto → ciudad de destino, de ida; el
precio depende del destino y de la cantidad de pasajeros, no de la
fecha de vuelta. Sólo aparecen las opciones cuya `capacidad` alcanza
para los pasajeros pedidos.

Cuando entre Amadeus real, el mapeo a esta forma vive **dentro** de la
implementación `ProveedorAmadeus`. El contrato del agregador no cambia:
es exactamente el punto del patrón (Módulo 4).

---

## 3. Timeouts y presupuesto de tiempo

| Tramo                        | Base propia | Con Duffel (`PROVEEDOR=duffel`) |
|------------------------------|-------------|---------------------------------|
| Front → agregador            | 3000 ms     | 6000 ms (vuelos)                |
| Agregador → vertical         | 2500 ms     | 5500 ms (vuelos)                |
| Vertical → Amadeus / Duffel  | 1800 ms     | 5000 ms                         |

Cada capa se corta antes que la de arriba, así el que responde "no
disponible" es siempre el más informado, no el más impaciente.

**Por qué vuelos tiene su propio presupuesto.** Con la base propia una
búsqueda tarda milisegundos y 2,5 s sobran. Con Duffel la búsqueda es
síncrona contra varias aerolíneas y tarda entre 1,5 y 3,5 s (medido hoy:
1,4–2,8 s): con 2,5 s una búsqueda que iba perfecta aparecía "no
disponible por timeout". El presupuesto de vuelos se deduce de
`PROVEEDOR` (el agregador tiene que ver la misma variable que el servicio
de vuelos) y los demás verticales conservan 2,5 s. **El front no lo
adivina**: `GET /api/v1/tenant/config` informa
`presupuestos_ms: { vuelos, hospedaje, traslado }` y el front se corta
medio segundo después de cada uno, así que sigue valiendo "cada capa
antes que la de arriba" con cualquier proveedor. Mientras esa respuesta
no llega rige el default de 3 s.

El corte se hace con `AbortController`, no con `Promise.race`. La
diferencia importa: `race` deja la request colgada consumiendo un socket;
`abort` la cancela de verdad. Un servicio **colgado** (que no responde
pero tampoco cierra la conexión) es el caso que rompe los sistemas mal
hechos, y es el que vamos a demostrar.

---

## 4. Por qué el front pide vertical por vertical

El agregador expone `/api/buscar` combinado, pero el front hace **una
request por vertical, en paralelo**.

Con una sola request combinada, la pantalla no puede pintar vuelos hasta
que hospedaje termine de fallar: el usuario espera el timeout completo
para ver algo. Con una request por vertical, cada sección tiene su propio
ciclo `loading → ok | unavailable` y vuelos aparece a los 400 ms aunque
hospedaje tarde 2500 ms en darse por vencido.

El aislamiento de fallos es el requisito central del proyecto; sería
raro tirarlo en el último salto de red.

### Qué vertical se pide, según la solapa

Desde la versión 4, el buscador (`BuscadorViajes.jsx`) tiene solapas —
Vuelos, Hospedaje, Traslado— y cada una pide sólo los campos que a ese
vertical le importan: vuelos necesita `origen`; hospedaje y traslado no
lo usan y no lo piden. El front decide **antes** de mandar nada si a un
vertical le faltan campos para tener sentido (`vertical.camposBusqueda`
en `dominio/verticales.jsx`) y, si le faltan, no lo pide — se muestra
colapsado, igual que un vertical apagado por el usuario o por el admin,
pero con un motivo que **nunca sale del backend**
(`campos_insuficientes`, sólo existe en `dominio/estados.js`).

Los campos solos no alcanzan para saber qué se pidió: hospedaje y
traslado piden exactamente los mismos (`destino`, `ida`), así que una
búsqueda de Traslado también le "alcanzaría" a Hospedaje. Por eso la
solapa elegida viaja como un campo más del criterio (`vertical`) y
`Resultados.jsx` sólo muestra la que coincide — el resto queda
colapsado con otro motivo que tampoco sale del backend

### Multidestino: varios tramos, ningún cambio de contrato

Vuelos y traslado suman un tercer modo además de ida-y-vuelta / solo
ida: multidestino, una lista de 2 a 4 tramos independientes (cada uno
con su propio origen —si corresponde— destino y fecha), para el caso
real de un viaje que no vuelve por donde fue.

Esto se resuelve **enteramente del lado del front**, sin tocar el
contrato: `BuscadorViajes.jsx` arma un tramo por pedido y
`Resultados.jsx` dispara una `SeccionResultados` por tramo, cada una
con su propio criterio de un solo sentido (`origen`, `destino`, `ida`,
sin `vuelta`) contra el mismo `GET /api/vuelos` o `GET /api/traslado`
de siempre. El agregador y los verticales no saben que existe el modo
multidestino — para ellos son N búsquedas comunes, en paralelo, cada
una con su propio ciclo `loading → ok | unavailable`. Los tramos viajan
en la URL aplanados (`tramos=2&origen_0=…&destino_0=…&fecha_0=…&origen_1=…`,
ver `dominio/tramos.js`) porque `URLSearchParams` no anida objetos.
(`otra_pestana`): la búsqueda tenía los campos, pero no era lo que se
eligió.

No cambia nada de lo anterior: sigue siendo una request por vertical,
en paralelo, con el mismo timeout y el mismo circuit breaker para los
verticales que sí se llegan a pedir.

---

## 5. Los tres estados

Un vertical, en cualquier punto del sistema, está en exactamente uno de:

| Estado        | Significa                                   | Qué ve el usuario            |
|---------------|---------------------------------------------|------------------------------|
| `loading`     | pedido en curso, dentro del presupuesto     | skeleton de la sección       |
| `ok`          | respondió a tiempo y cumplió el contrato    | lista de resultados          |
| `unavailable` | falló, timeout, apagado o circuito abierto  | aviso dentro de la sección   |

Este enum atraviesa front y back y es el mismo en los dos lados.

`motivo` incluye `sin_instancias` (§14): el registro de servicios sabe
de este servicio y ninguna de sus instancias está lista. No se llama a
quien dijo "no estoy listo".

**Decisión de diseño:** un vertical apagado por el admin y uno caído solo
producen el mismo estado `unavailable` y el mismo componente visual. Se
distinguen únicamente por `motivo`, que cambia el texto del aviso. No son
dos features: es una sola, con un parámetro.

Cuarto caso, que **no** es un estado nuevo sino un modificador de `ok`:
el circuito de un vertical está abierto (fallos sostenidos, no uno
aislado) y hay una respuesta buena reciente en la caché del agregador
(§9). En vez de `unavailable`/`circuito_abierto`, se responde `ok` con
esos datos y dos campos de más — `cacheado: true`, `edad_ms`— para que
quede explícito que son viejos. Es transparencia de replicación
(Módulo 2) con el costo a la vista, en vez de escondido: se prefiere
mostrar datos viejos declarados como tales antes que esconder que lo
son.

Un 503 o un timeout **sueltos** siguen mostrando `unavailable` sin
más, aunque haya caché disponible: la caché es para cuando ya se dejó
de intentar de verdad (circuito abierto), no para tapar el primer
fallo — si tapara el primero, la demostración central del proyecto
(que un vertical caído se vea como tal) dejaría de poder mostrarse
apenas hubiera una búsqueda buena previa.

---

## 6. Rutas de demostración (no son parte del sistema)

`PUT /api/demo/salud/:vertical` con `{ "estado": "ok" | "lento" |
"caido" | "colgado" }` le impone a un vertical un estado de salud
simulado.

Matar el proceso ya cubre "servicio caído". Lo que no cubre es un
servicio **vivo que nunca responde**: ese es el que cuelga a los sistemas
sin timeout y el que más conviene mostrar. Por eso el interruptor vive
dentro de cada vertical y no afuera.

Se borra junto con el panel del front cuando el sistema esté en
contenedores.

## 7. Qué pasa si se cae el servicio de usuarios

El agregador necesita las preferencias del usuario y la configuración
del administrador para saber a quién llamar. Si el servicio de usuarios
no responde, **falla abierto**: asume que todos los verticales están
habilitados y busca en todos.

Es la decisión menos mala. Fallar cerrado dejaría al usuario sin
ninguna sección por una caída que no tiene nada que ver con vuelos ni con
hospedaje: convertiría el fallo de un servicio secundario en una caída
total, que es exactamente lo que este sistema existe para evitar.

El costo es real y hay que decirlo: durante esa caída, un usuario que
había ocultado un vertical lo va a volver a ver, y un vertical que el
administrador había apagado va a volver a aparecer. Se elige mostrar de
más antes que no mostrar nada. La respuesta combinada lo declara en el
campo `aviso`.

---

## 8. Marca blanca: agencias

`docs/arquitectura-multi-nodo.md` documenta el diseño completo. Acá lo
que cambia del contrato.

### La cabecera `x-agencia-id`

Igual que `x-usuario-id`: viaja en la request, el backend confía en
ella, y **no es autenticación**. Si no viene, se asume `ag-demo` — la
agencia por defecto, la que ya tenía todo el sistema antes de sumar
marca blanca. Consecuencia importante: **ninguna request que no manda
esta cabecera cambia de comportamiento**, así que el contrato de las
versiones 1 y 2 sigue valiendo tal cual para quien no la use.

### `GET /api/tenant/config`

Branding y verticales habilitados de la agencia que resuelve la
cabecera. Lo pide el front al arrancar, antes de mostrar nada.

```json
{
  "id": "ag-sur",
  "nombre": "Aventura Sur Viajes",
  "color_primario": "#b45309",
  "descripcion": "Marca blanca de ejemplo: mismo sistema, otra agencia, otra configuración.",
  "verticales_habilitados": ["vuelos", "hospedaje"]
}
```

`config_verticales` (antes global) pasa a tener clave compuesta
`(agencia_id, vertical)`: cada agencia prende y apaga sus propios
verticales, con su propia auditoría. `preferencias-agregadas` y
`auditoria` quedan filtradas por la agencia de la cabecera.

### `POST /api/agencias/:id/registro`

No la usa el front — la usa un nodo de agencia
(`servidor/nodo-agencia/`) para sincronizar su bitácora local de
búsquedas contra el nodo central. Cuerpo:

```json
{ "entradas": [
  { "vertical": "vuelos", "estado": "ok", "criterios": {"...":"..."}, "buscado_en": "2026-09-07T14:03:22.118Z" }
]}
```

Responde `{ "insertadas": n }`. Es *append-only* y no bloquea nada del
camino crítico del usuario: si el nodo de agencia no puede sincronizar
porque el central está caído, reintenta solo y no pierde nada
(docs/arquitectura-multi-nodo.md §4).

---

## 9. Circuit breaker y caché (Redis)

Los mecanismos 4 y 5 de la tolerancia a fallos (ver
`docs/entrega-0-plan-de-proyecto.md`), con estado en Redis en vez de en
memoria — así sobreviven a un reinicio del agregador y valen para todas
las agencias del nodo central por igual, cada una con su propio
contador.

**Circuit breaker.** Tres fallos seguidos de un vertical, para una
misma agencia, abren su circuito por 30 s: durante ese tiempo el
agregador no vuelve a llamarlo y responde directo con
`estado: "unavailable"`, `motivo: "circuito_abierto"` — sin gastar el
timeout completo en cada búsqueda mientras el servicio sigue caído. Un
éxito reinicia el contador.

**Caché de última respuesta buena.** Cada respuesta `ok` de un
vertical se guarda por agencia, con una vigencia de 10 minutos. Sólo se
consulta cuando el circuito ya está abierto: un 503 o un timeout
aislados siguen respondiendo `unavailable` sin más, y recién al tercer
fallo seguido (cuando el breaker corta) se responde con la caché en vez
de `unavailable` — ver el "cuarto caso" en §5. Si no hay caché vigente
en ese momento, se responde `unavailable`/`circuito_abierto` como
siempre.

Si Redis no está disponible, el agregador **falla abierto** con este
mecanismo también: no hay caché ni breaker, pero la búsqueda sigue
funcionando exactamente como en la versión 2 del contrato. Mismo
criterio que ya existe para la caída del servicio de usuarios (§7): un
mecanismo secundario que se cae no puede tumbar el mecanismo central.

---

## 10. Sesión (login real)

Reemplaza a `x-usuario-id` mandada sin verificar. Dos caminos para
llegar a una sesión — cliente por email, administrador por usuario y
contraseña — pero el token que resulta es el mismo tipo de JWT en los
dos casos, firmado por el agregador (nunca por `usuarios`, que sigue
sin saber qué es un token).

### Alta de cliente

```
POST /api/auth/registro        { email, password, nombre } → { ok, email, codigo_demo? }
POST /api/auth/verificar-email { email, codigo }            → { token, usuario }
POST /api/auth/reenviar-codigo { email }                    → { ok, email, codigo_demo? }
```

`codigo_demo` sólo aparece con el proveedor de email ficticio (el único
que existe hoy, ver `servidor/comun/email.js`): es el código que un
proveedor real mandaría por correo. Verificar el email loguea directo,
sin pedir la contraseña de nuevo.

### Login

```
POST /api/auth/login { identificador, password } → { token, usuario }
```

`identificador` es un email (clientes, exige `email_verificado`) o un
`username` (administradores, no lo exige). Credenciales inválidas → 401
`credenciales_invalidas`; email sin verificar → 403 `email_no_verificado`.

`usuario` es `{ id, nombre, rol, agencia_id, email?, username?, permisos }`
— nunca incluye el hash de la contraseña.

### La cabecera `Authorization`

```
Authorization: Bearer <token>
```

- **Ausente:** invitado. `/api/buscar*` y `/api/tenant/config` siguen
  funcionando igual — sin personalización, con las preferencias "todo
  activado" — porque no queremos que el sistema deje de poder usarse
  sin cuenta. `/api/perfil` y todo `/api/admin/*` responden `401`.
- **Presente y válida:** el agregador confía en lo que dice el
  token (`sub`, `rol`, `agencia_id`, `permisos`) para todo lo que
  necesita identidad — ya no en ninguna cabecera que mande el cliente.
- **Presente e inválida/vencida:** se trata como ausente (invitado), no
  como error — un token vencido no debería voltear una búsqueda.

### Permisos de administrador

`rol: 'admin'` no alcanza para todo: cada acción de gestión pide,
además, un permiso concreto en `usuario.permisos`:

| Permiso | Habilita |
|---|---|
| `gestion_verticales` | `GET/PUT /api/admin/config`, `preferencias-agregadas`, `auditoria` |
| `gestion_usuarios` | `GET/POST /api/admin/administradores`, `PUT /api/admin/administradores/:id/permisos` |

Un administrador sólo ve y crea administradores **de su propia
agencia** — `agencia_id` sale del token, no del cuerpo de la request.

---

## 11. Reservas (Módulo 3: comunicación síncrona y asíncrona)

Reservar es el único flujo del sistema que **escribe** algo con valor
(asientos) y el que obliga a elegir, punto por punto, qué semántica de
comunicación corresponde. La descripción formal está en
`docs/openapi.yaml`; acá el razonamiento.

### `POST /api/reservas`

```
Idempotency-Key: 0b9c6a52-…                 ← obligatoria
{ "vuelos": ["AREZEMAD-1-2026-11-20", "IBMADEZE-0-2026-11-30"],
  "pasajeros": 2,
  "contacto": { "email": "viajero@demo.test" },
  "nombres": ["Ana García", "Luis Pérez"] }
```

Un vuelo por tramo (ida y vuelta, multidestino). Sólo viajan la cantidad
de pasajeros, sus nombres y el email de contacto; los documentos y fechas
de nacimiento se piden en pantalla pero se quedan en el navegador.

| Código | Cuándo | Cuerpo |
|---|---|---|
| **201** | reserva creada | `Reserva` + `evento_encolado` |
| **200** | la misma `Idempotency-Key` ya existía | la misma `Reserva`, con `repetida: true` |
| **400** | falta la `Idempotency-Key`, o el pedido es inválido | `{ error, motivo }` |
| **404** | el vuelo no existe o no se puede reservar acá (las ofertas de Duffel no tienen cupo local) | `motivo: vuelo_desconocido` |
| **409** | no quedan asientos suficientes | `motivo: sin_cupo`, `vuelo_id`, `libres` |
| **422** | la clave se usó para otro pedido, o el vuelo ya salió | `motivo: clave_reutilizada` \| `vuelo_pasado` |
| **503** | vuelos no respondió | `reintentable: true` |

`GET /api/reservas/:id` devuelve la reserva y el estado de su aviso:
`notificacion.estado` ∈ `enviada` | `pendiente` | `no_disponible`.

### Qué es síncrono y por qué

**La reserva.** El usuario está mirando la pantalla y necesita saber *en
ese momento* si consiguió el asiento. El agregador llama a vuelos y
espera, con timeout de 2,5 s cortado por `AbortController`.

Con un timeout **no se sabe si la reserva se hizo**: puede que vuelos la
haya confirmado y la respuesta se haya perdido. Por eso el cliente manda
siempre una `Idempotency-Key` y, ante un 503, **reintenta con la misma
clave**: si ya existía se devuelve esa reserva (200) sin descontar otro
asiento. "Al menos una vez" desde el cliente + idempotencia en el
servidor = efecto de una sola vez. El front genera la clave una vez al
llegar a la pantalla de datos y la reusa en cada reintento (un doble clic
tampoco reserva dos veces).

### Qué es asíncrono y por qué

**El aviso de confirmación.** No tiene que frenar la reserva ni hacerla
fallar, y el servicio que lo manda puede estar caído. El agregador
publica el evento `reserva_confirmada` en un **stream de Redis**
(`reservas:eventos`, XADD) y responde **sin esperar a nadie**: lo único
que aguarda es que Redis lo haya recibido. El servicio `notificaciones`
—un proceso aparte, puerto 4005— lo consume con un grupo de consumidores
(XREADGROUP), "envía" la confirmación y recién entonces lo da por
entregado (XACK).

| Punto del sistema | Canal | Semántica de entrega | Por qué |
|---|---|---|---|
| Búsqueda: navegador → agregador → verticales | síncrono, en paralelo | request/response con timeout, sin reintentos automáticos | El usuario espera resultados ya; al llamar en paralelo la latencia es la del más lento y no la suma. |
| Reserva: agregador → vuelos | síncrono | al menos una vez (cliente) + idempotencia (servidor) | Necesita saber si consiguió el asiento; ante un timeout, reintentar con la misma clave es seguro. |
| Aviso de reserva: agregador → notificaciones | asíncrono (Redis Streams) | al menos una vez + consumidor idempotente | El aviso no debe frenar ni hacer fallar la reserva y el consumidor puede estar caído. Perder un aviso es peor que recibirlo dos veces; el duplicado se descarta por `reserva_id`. |
| Bitácora: nodo de agencia → central | asíncrono (cola local + sincronización) | al menos una vez (se reintenta hasta que el central confirma) | Guardar la búsqueda nunca debe demorar ni romper la pantalla. |

Semánticas descartadas: *como máximo una vez* (una reserva o un aviso
perdido son inaceptables acá: sólo sirve para datos descartables, como
la lectura de un sensor) y *exactamente una vez* (no se puede garantizar
de punta a punta sólo con la red; se aproxima combinando "al menos una
vez" con deduplicación por un identificador explícito, que es lo que
hace el sistema).

Si Redis está caído, la reserva **igual se confirma** y la respuesta lo
dice (`evento_encolado: false`): perder el aviso es mejor que perder la
reserva. Ese aviso no se reintenta solo (sí si el cliente repite el
pedido con la misma clave); una versión más robusta guardaría el evento
junto con la reserva (patrón *outbox*).

### El caso de concurrencia

**El invariante:** en cada vuelo, los asientos vendidos nunca superan la
capacidad. Dos clientes que reservan a la vez el último asiento: si cada
pedido lee "queda 1", espera la confirmación del proveedor y después
escribe, los dos creen que ganaron (actualización perdida) y el vuelo
queda sobrevendido.

- **Descuento atómico** (`servidor/vuelos/reservas.js`): comprobar y
  escribir son una sola sentencia,
  `UPDATE cupos SET ocupados = ocupados + :n WHERE vuelo_id = :id AND
  ocupados + :n <= capacidad`, dentro de `BEGIN IMMEDIATE`. Si no
  actualiza ninguna fila, no había lugar → 409. La espera del proveedor
  queda *fuera* de la sección crítica. Defensa en profundidad: la tabla
  tiene `CHECK (ocupados <= capacidad)`.
- **Idempotencia**: el `reserva_id` es la clave primaria de la reserva.
- **Consumidor idempotente**: la tabla de notificaciones usa el
  `reserva_id` como clave primaria; el mismo evento dos veces envía un
  solo mensaje.
- **Varios tramos, todo o nada**: una reserva de ida y vuelta descuenta
  el cupo de cada tramo en la misma transacción; si uno falla, vuelve
  atrás el resto.

Medido disparando los pedidos a la vez contra el sistema real: primero
el defecto (20 pedidos por 1 asiento terminan con 20 confirmadas y el
vuelo sobrevendido) y después la solución (exactamente 1 de 20). Medido
además con **dos procesos de vuelos** distintos sobre el mismo archivo: 60 pedidos repartidos entre los dos, 5 asientos → 5
confirmadas, 0 de sobreventa (`BEGIN IMMEDIATE` toma el bloqueo de
escritura de la base, así que protege entre procesos).

Alternativa de modelo de actores (Módulo 4), también medida: un
buzón por vuelo atiende los pedidos de a uno y la lógica ingenua deja de
ser peligrosa. Da el mismo resultado con una instancia, pero el buzón
vive en la memoria de un proceso: con dos instancias la carrera volvería.
Por eso el modo por defecto es el atómico.

---

## 12. Versionado y descripción formal (Módulo 4: contratos)

### `/api/v1`

Toda la API pública vive bajo `/api/v1`. Las rutas sin versión
(`/api/buscar/...`) siguen respondiendo exactamente lo mismo pero son
**alias deprecados**: traen `Deprecation: true` y `Link: <…/api/v1/…>;
rel="successor-version"` (RFC 8594), para que un cliente viejo siga
andando y uno atento sepa adónde mudarse. Las rutas operativas
(`/salud`, `/salud/live`, `/salud/ready`) no se versionan: las consulta la
infraestructura, no los clientes de la API.

Qué cambia la versión y qué no, siguiendo la tabla del Módulo 4:

| Cambio | ¿Rompe a un cliente? | ¿Sube la versión? |
|---|---|---|
| Agregar un campo opcional (`segmentos`, `presupuestos_ms`, `cambio_aeropuerto`) | No: los clientes viejos lo ignoran | No |
| Agregar un endpoint (`/reservas`, `/sistema/servicios`) | No: nadie lo llamaba | No |
| Agregar un `motivo` nuevo (`sin_instancias`) | Sólo si el cliente no tiene un caso por defecto (el front lo tiene) | No |
| Cambiar la forma de un cuerpo ya publicado | Sí | **Sí** |
| Quitar o renombrar un campo, cambiar un tipo, volver obligatorio algo opcional | Sí | **Sí** |

El único cambio de este tipo de la versión 5 es el cuerpo de `/lugares`
(de aeropuertos sueltos a ciudades con aeropuertos): por eso la forma
anterior queda en `/api/lugares` —sin versión, deprecada— y la nueva en
`/api/v1/lugares`.

### OpenAPI

`servidor/agregador/openapi.js` es la **única fuente de verdad** de la
descripción de la API. De ahí salen:

- `GET /api/v1/openapi.json` — el documento.
- `GET /api/v1/docs` — documentación interactiva (Swagger UI; carga la
  interfaz desde un CDN, así que la página necesita internet; el
  documento en sí no).
- `docs/openapi.yaml` — el mismo documento en YAML, generado con
  `npm run docs:openapi`.

Contrato de interfaz (el acuerdo, en prosa: este documento) y
descripción de servicio (el acuerdo en un formato verificable: el YAML)
son dos cosas distintas pero relacionadas; confundirlas es lo que
produce integraciones frágiles.

### JSON hacia afuera, ¿y hacia adentro?

Todo viaja como JSON sobre HTTP, también entre los servicios. La regla
práctica del Módulo 4 es *REST/JSON hacia afuera, gRPC/protobuf hacia
adentro*, y esta es la cuenta para decidir si corresponde:

| Pregunta | Acá |
|---|---|
| ¿Quién consume la API? | El navegador (que sólo habla JSON/HTTP) y servicios propios. |
| ¿Controlamos los dos extremos? | Sí, entre servicios. |
| ¿Cuánto tráfico hay? | Decenas de pedidos por segundo en una demo: la diferencia de tamaño y velocidad entre JSON y protobuf no se nota. |
| ¿Hace falta streaming bidireccional? | No. |

Con poco volumen "la diferencia de performance no justifica la
complejidad extra": un `.proto` compartido, generación de stubs y
HTTP/2 en cada servicio a cambio de nada medible. Se deja JSON, con el
contrato en OpenAPI, que es el que sí aporta algo (documentación, cliente
generable, validación). Si el tráfico interno creciera, el lugar para
cambiarlo es `servidor/comun/pedir.js` (cliente) y `servidor/comun/http.js`
(servidor): son los únicos dos archivos que saben cómo se serializa.

---

## 13. Lugares: ciudades, aeropuertos y escalas

### El problema que corrige

Buscar de Buenos Aires a Madrid no funcionaba si se elegía el aeropuerto
equivocado. El buscador mostraba dos entradas "Buenos Aires" idénticas
(Ezeiza y Aeroparque, la primera Aeroparque) y sólo dejaba elegir
destinos con **vuelo directo** desde el origen elegido, tomados de un
dataset (OpenFlights, 2014): de Aeroparque no sale ningún intercontinental,
así que Madrid directamente no aparecía y el botón de buscar quedaba
deshabilitado. Peor: ese filtro dejaba afuera el 99,6 % de los pares
posibles (36 383 pares directos de ~9,8 millones entre aeropuertos con
servicio), aunque se pudiera viajar sin problema con una escala.

Las tres causas, y qué se hizo con cada una (`docs/analisis-rutas.md` tiene
el análisis completo con números):

1. **Aeropuertos en vez de ciudades.** Ahora un *lugar* es una **ciudad**
   (`BUE`) o un aeropuerto (`EZE`); las ciudades agrupan a los
   aeropuertos de la misma localidad (mismo país, mismo nombre y a menos
   de 120 km). 5 814 ciudades de 6 071 aeropuertos; 194 con más de uno.
   Para las que tienen un código metropolitano oficial de IATA (BUE,
   LON, NYC, PAR…) se usa ése — es el que Duffel entiende, y se verificó
   contra su API real: `BUE→MAD` devuelve las ofertas de los dos aeropuertos
   en una sola búsqueda.
2. **Sólo directos.** El destino ya no se limita por el origen. El
   proveedor de la base propia arma itinerarios con **una y dos escalas**
   sobre las rutas reales, con horarios que cierran (espera mínima, y las
   esperas absurdas se descartan). Duffel ya devolvía conexiones por su
   cuenta.
3. **Cambio de aeropuerto.** Un viaje Tucumán → Madrid real es Tucumán →
   Aeroparque → *traslado* → Ezeiza → Madrid. Se modela como una escala
   con `cambio_aeropuerto` (§2), con al menos 4 h de espera.

### `GET /api/v1/lugares`

```json
{ "version": 1, "generado_en": "…",
  "ciudades": [
    { "codigo": "BUE", "nombre": "Buenos Aires", "pais": "Argentina",
      "trafico": 265, "vuelos": true,
      "aeropuertos": [
        { "iata": "EZE", "nombre": "Ezeiza",     "vuelos": true },
        { "iata": "AEP", "nombre": "Aeroparque", "vuelos": true } ] } ] }
```

~5 800 ciudades, ~900 KB; con `Accept-Encoding: gzip` (que el navegador
manda solo) viaja en ~130 KB. El agregador lo guarda en memoria una hora:
si vuelos se cae después de la primera vez, el buscador sigue pudiendo
elegir ciudades. El front filtra en el navegador mientras se escribe.

`ciudades[].vuelos` indica si algún aeropuerto de la ciudad tiene vuelos
(la pestaña de vuelos no ofrece Torrejón ni Cuatro Vientos, que no
tienen); hospedaje y traslado ofrecen todas, porque alojarse o pedir un
traslado no depende de que haya un vuelo.

### Hospedaje y traslado: por ciudad

Se aloja uno en la ciudad, no en el aeropuerto: `destino=ROM` y
`destino=FCO` devuelven los mismos alojamientos, y `destino=TOJ`
(Torrejón, sin vuelos) resuelve a Madrid. Antes la base guardaba una
copia de los mismos 8 hoteles por cada aeropuerto (Fiumicino y Ciampino
devolvían hoteles idénticos, con ids distintos) y la ciudad aparecía
repetida en el selector. Ahora el servicio lleva cualquier código de la
ciudad (el de la ciudad o el de cualquiera de sus aeropuertos) a su
aeropuerto principal y muestra un solo conjunto.

### Qué se garantiza y qué no

- Si hay un recorrido de hasta dos escalas en la red de rutas, la
  búsqueda devuelve resultados. Entre las 100 ciudades con más tráfico, el
  **100 %** de los pares tiene resultados (37,5 % directos). Entre las
  400 más conectadas, el 99,6 %. Desde las ciudades argentinas hacia esas
  100, el 85 % (el resto necesita tres escalas o más; el detalle y las
  causas en `docs/analisis-rutas.md`).
- Si no lo hay (un recorrido que necesita tres o más escalas con las
  rutas del dataset), devuelve `items: []`: ni se inventa un vuelo ni es
  un error.
- Qué es real y qué es simulado: las rutas, los aeropuertos y las
  aerolíneas son reales (OpenFlights, ODbL); los horarios, los precios y
  las combinaciones son una simulación plausible. El dataset es de 2014:
  **no debe presentarse como información de vuelos vigente.** Con
  `PROVEEDOR=duffel` los vuelos son de una API real (en modo de prueba).

---

## 14. Salud y descubrimiento de servicios (Módulo 4)

### Vivo no es lo mismo que listo

Cada servicio expone dos sondas, con dos consecuencias distintas:

| Sonda | Pregunta | Si falla | Depende de |
|---|---|---|---|
| `GET /salud/live` | ¿el proceso responde? | hay que **reiniciarlo** | nada externo |
| `GET /salud/ready` | ¿puede atender tráfico ahora? | hay que **dejar de mandarle tráfico** (no reiniciarlo) | sus dependencias: la base, Redis |

La liveness *no* depende de la base a propósito: si dependiera, una caída
de Postgres reiniciaría a todos los servicios sin motivo. La readiness sí
la consulta, porque su consecuencia no es reiniciar sino esperar. Un
servicio puede estar vivo y no listo (el de usuarios cuando Postgres
todavía no contesta: arranca igual, atiende `/salud/live` y responde 503
en `/salud/ready` hasta que la base está). `GET /salud` sigue existiendo
con el detalle (contadores, proveedor); es lo que usa el panel de fallos.

### Registro y descubrimiento

`servidor/registro/` (puerto 4006) es un registro de servicios mínimo, al
estilo de Consul:

1. **Registro.** Cada servicio, al arrancar, se anota con nombre,
   dirección e id de instancia, y lo repite cada 3 s (`PUT`, que hace de
   latido). Al cerrarse ordenadamente se da de baja (`DELETE`); si muere
   sin avisar, el TTL (10 s) lo saca.
2. **Health checks.** El registro consulta `/salud/ready` de cada
   instancia cada 2 s y la marca `pasando` o `critico`. *Registrado* no es
   *listo*: registrarse sólo dice que existe y dónde está.
3. **Descubrimiento del lado del cliente.** El agregador baja cada 2 s la
   lista de instancias sanas y reparte por turnos entre ellas
   (`servidor/comun/descubrimiento.js`). Es *client-side discovery*, como
   Netflix Eureka; el *server-side* sería un balanceador fijo adelante, que
   es lo que hacen Docker Compose o Kubernetes con el nombre de un
   servicio.

Tres casos, y qué se hace en cada uno:

| Situación | Qué hace el cliente |
|---|---|
| El registro responde y hay instancias sanas | usa una (por turnos) |
| El registro responde y **ninguna** está lista | `motivo: sin_instancias`: no llama a quien dijo "no estoy listo" |
| El registro no responde (o nunca oyó hablar del servicio) | usa las direcciones fijas de `config.js` (`URL_*`) |

El registro es un punto único de falla (Consul y etcd lo evitan
replicándose con Raft, algo que acá no se justifica) y por eso **nadie
depende de él para funcionar**: perderlo hace perder el descubrimiento
dinámico, no el sistema; al volver, los servicios se re-anotan solos con
su próximo latido. Medido: con el registro muerto las búsquedas siguen en
200, y al levantarlo vuelven a registrarse en segundos.

**Failover.** La lista puede tener hasta ~4 s de antigüedad (el registro
tarda su ciclo en enterarse y el agregador otro en refrescar): una
instancia que acaba de morir seguiría recibiendo pedidos. Por eso, ante un
fallo de *conexión* —no ante un timeout, donde ya se gastó el presupuesto
del usuario y la instancia pudo haber procesado el pedido— el cliente
reintenta una vez contra otra instancia y marca a la caída como sospechosa
unos segundos (*outlier detection* pasivo, complemento del health check
activo). Sólo para operaciones que se pueden repetir sin efecto doble: las
búsquedas y la reserva, que lleva su `Idempotency-Key`. Medido con dos
instancias de vuelos y una caída en seco: **sin failover, 4 de 8 búsquedas
fallaban; con failover, 0.**

`GET /api/v1/sistema/servicios` (sólo administradores) devuelve lo que ve
el registro; el panel de administración lo muestra: levantar una instancia
nueva aparece sola, y una que deja de estar lista pasa a "no lista" en
segundos (medido con procesos reales: instancia extra, reparto,
viva-pero-no-lista, caída en seco, baja ordenada).

Un mensaje de cada servicio lleva además un `x-request-id` (lo genera el
primero que recibe el pedido y se reenvía a cada servicio al que llama), así
una búsqueda que tocó el agregador, vuelos y usuarios se sigue de punta a
punta buscando una sola cadena en los logs.
