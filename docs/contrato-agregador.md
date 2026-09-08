# Contrato del Agregador

Versión 4 — login real y búsqueda diferenciada por vertical. Definido
**antes** de escribir el backend, para que front y back puedan avanzar
en paralelo sin bloquearse (Módulo 4: contratos entre componentes).

Hoy lo cumplen dos implementaciones: el agregador real
(`servidor/agregador/`) y un servidor simulado en memoria
(`src/api/mock/servidor.js`) que permite correr el front solo. El front
elige con la variable `VITE_API_URL` y no cambia nada más.

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

### `GET /api/buscar/:vertical`

Búsqueda de **un solo** vertical. Es el que usa el front.

Verticales válidos: `vuelos`, `hospedaje`, `traslado`.
(Extensión futura: `autos`, `cruceros`.)

**Query params**

| Param       | Tipo   | Req. | Ejemplo      |
|-------------|--------|------|--------------|
| `origen`    | IATA   | sí¹  | `EZE`        |
| `destino`   | IATA   | sí   | `MAD`        |
| `ida`       | ISO    | sí   | `2026-10-12` |
| `vuelta`    | ISO    | no   | `2026-10-22` |
| `pasajeros` | int    | no   | `2`          |

¹ `origen` no aplica a `hospedaje`; se ignora si viene.

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
| `desactivado_por_usuario`.

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
  "id": "AR1132-20261012",
  "aerolinea": "Aerolíneas Argentinas",
  "codigo_aerolinea": "AR",
  "origen": "EZE",
  "destino": "MAD",
  "salida": "2026-10-12T23:55:00Z",
  "llegada": "2026-10-13T16:30:00Z",
  "duracion_min": 755,
  "escalas": 0,
  "precio": { "monto": 1284000, "moneda": "ARS" }
}
```

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

| Tramo                        | Presupuesto |
|------------------------------|-------------|
| Front → agregador            | 3000 ms     |
| Agregador → vertical         | 2500 ms     |
| Vertical → Amadeus           | 1800 ms     |

Cada capa se corta antes que la de arriba, así el que responde "no
disponible" es siempre el más informado, no el más impaciente.

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
