# Contrato del Agregador

Versión 2 — Fase 2. Definido **antes** de escribir el backend, para que
front y back puedan avanzar en paralelo sin bloquearse (Módulo 4:
contratos entre componentes).

Hoy lo cumplen dos implementaciones: el agregador real
(`servidor/agregador/`) y un servidor simulado en memoria
(`src/api/mock/servidor.js`) que permite correr el front solo. El front
elige con la variable `VITE_API_URL` y no cambia nada más.

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

Verticales válidos: `vuelos`, `hospedaje`.
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

Cuarto caso, que **no** es un estado sino un modificador: hay datos
cacheados de una búsqueda anterior y el vertical ahora está
`unavailable`. Se muestran los datos viejos con un aviso explícito de su
antigüedad. Es transparencia de replicación (Módulo 2) con el costo a la
vista, en vez de escondido.


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
