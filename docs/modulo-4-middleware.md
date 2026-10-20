# Módulo 4 — Middleware y componentes distribuidos

Cómo está resuelto cada tema del módulo en el proyecto, y qué decisiones
se tomaron donde la clase presenta varias opciones. El módulo es la
*vista de desarrollo* del modelo 4+1: cómo se organiza el código en
componentes, interfaces y contratos.

| Tema de la clase | En el proyecto | Dónde |
|---|---|---|
| **1. Propósito del middleware** | `servidor/comun/` es la capa de middleware: abstrae la red, la ubicación de los servicios, la invocación remota y la serialización, para que el código de cada servicio hable de vuelos y no de sockets. | §1 |
| **2. Modelos de componentes** | Servicios (los microservicios), publish/subscribe (Redis Streams) y actores (un buzón por vuelo). Objetos remotos (RMI): descartados. | §2 |
| **3. Interoperabilidad** | Contrato de interfaz en prosa + descripción de servicio en OpenAPI, versionado `/api/v1`. JSON y no protobuf, con la cuenta hecha. | §3 |
| **4. Descubrimiento de servicios** | Registro de servicios con health checks (estilo Consul), descubrimiento del lado del cliente con failover, y sondas `live`/`ready`. En Docker Compose, el del lado del servidor. | §4 |

La API formal: `docs/openapi.yaml` (también en `GET /api/v1/openapi.json`
y, interactiva, en `/api/v1/docs`). Cómo mostrarlo: sección 5.

---

## 1. Propósito del middleware

La clase lo plantea como una tensión: el código de negocio piensa en
objetos y funciones, la red sólo entiende bytes y conexiones, y alguien
tiene que traducir en cada conexión. En este proyecto ese alguien es
`servidor/comun/`, y cada archivo resuelve una de las cuatro cosas que
enumera el módulo:

| Qué abstrae | Archivo | Qué le saca de encima al servicio |
|---|---|---|
| **La red** (el servidor) | `http.js` — `crearServicio` | Enrutar, leer el cuerpo JSON, CORS, compresión gzip, códigos de error, apagado ordenado. Un servicio declara sus rutas y nada más. |
| **La invocación remota** (el cliente) | `pedir.js` | Hacer una llamada con timeout y `AbortController`, distinguir "el servicio contestó con un error" de "no contestó", propagar el `x-request-id`. |
| **La localización** | `descubrimiento.js` | Saber *dónde* está un servicio. El agregador pide `vuelos` y el middleware elige una instancia sana; no hay una URL en el código de negocio. |
| **La serialización** | `http.js` / `pedir.js` | JSON, en las dos puntas. Ver la decisión en §3. |
| Estado compartido | `redis.js`, `base.js`, `basePg.js` | Caché, circuit breaker, streams; la apertura de la base propia de cada servicio. |

Cuando el servicio de vuelos crece una ruta, no escribe nada de esto: la
declara. Cuando se agrega una capacidad transversal —el tracing por
`x-request-id`, la compresión, las sondas de salud— se escribe una vez en
`http.js` y los siete servicios la tienen.

**Tracing.** El primer servicio que recibe un pedido genera un
`x-request-id` (o respeta el que traiga); `pedir.js` lo reenvía en cada
llamada y todos lo escriben en sus logs. Una búsqueda que tocó el
agregador, vuelos y usuarios se sigue buscando una sola cadena.

## 2. Modelos de componentes

La clase presenta cuatro: objetos remotos, servicios, actores y
publish/subscribe. Cuáles se usaron y por qué:

### Servicios (el modelo base)

Cada microservicio es un componente con una interfaz HTTP y una base
propia: vuelos, hospedaje, traslado, usuarios, notificaciones, registro,
agregador, nodo de agencia. Se acoplan por el contrato, no por el código
(§3).

### Publish/subscribe

El aviso de reserva confirmada: el agregador **publica** un evento en un
stream de Redis sin saber quién lo lee; `notificaciones` está
**suscripto** con un grupo de consumidores. El que publica y el que
consume no se conocen ni tienen que estar vivos a la vez: es el
desacople por tiempo y por identidad que caracteriza al modelo.
Detalle en `docs/modulo-3-comunicacion.md` §1.

### Actores

El modelo de actores sostiene estado privado, se comunica sólo con
mensajes y procesa **uno a la vez** (Erlang/Akka). En el proyecto aparece
en el caso de concurrencia: cada vuelo es un actor con un buzón, y
dentro del buzón la lógica "leer, esperar, escribir" es segura porque nadie
más toca ese vuelo. Está implementado (`modo: "actor"`) y se compara
con el `UPDATE` atómico: **el mismo resultado con una instancia, y
una limitación que importa** —el buzón vive en la memoria de un proceso,
así que con dos instancias de vuelos la carrera volvería—. Por eso el
modo por defecto es el descuento atómico, que ordena la base y vale entre
procesos. Es la discusión de actores vs. estado compartido de la clase,
con números (`docs/modulo-3-comunicacion.md` §4).

### Objetos remotos (RMI): descartados

Un objeto remoto hace que una llamada a un método de otra máquina *parezca*
local, a costa de acoplar los dos extremos al mismo lenguaje y a una
interfaz de clases. Acá el navegador es un cliente más y habla HTTP/JSON;
no hay un lenguaje común que justifique el costo.

## 3. Interoperabilidad: contratos

> *Que dos servicios usen el mismo protocolo de transporte no significa
> que puedan entenderse.* — dos servicios con HTTP y JSON se rompen igual
> si cambia el nombre de un campo.

### Contrato de interfaz y descripción de servicio

La clase insiste en separar las dos cosas, y el proyecto las tiene
separadas:

- **El contrato de interfaz** —el acuerdo conceptual: qué operaciones
  existen, qué reciben, qué devuelven, qué errores pueden ocurrir— es
  `docs/contrato-agregador.md`. Se escribió **antes** que el backend, para
  que front y back avanzaran en paralelo.
- **La descripción de servicio** —el artefacto formal y legible por
  máquina— es `docs/openapi.yaml` (OpenAPI 3). Se **genera** desde
  `servidor/agregador/openapi.js` con `npm run docs:openapi`: una única
  fuente alimenta el JSON que sirve el agregador, el YAML, la
  y la documentación interactiva.

### Mantener la descripción al día

El YAML no se edita a mano: se regenera con `npm run docs:openapi` cada
vez que cambia `openapi.js`, y el agregador sirve ese mismo documento en
`/api/v1/openapi.json`. Con eso el contrato y la descripción salen de una
sola fuente y no se desincronizan.

### Versionado

La clase da la tabla: qué cambios rompen a los consumidores y cuáles no.

| Cambio | ¿Rompe? | En el proyecto |
|---|---|---|
| Agregar un campo opcional | No | `segmentos`, `cambio_aeropuerto`, `presupuestos_ms` se sumaron sin tocar a nadie. |
| Agregar un endpoint | No | `/reservas`, `/sistema/servicios`. |
| Quitar o renombrar un campo, cambiar un tipo, volver obligatorio un campo | **Sí** | Requiere versión nueva. |

La buena práctica es versionar explícitamente ante un cambio que rompe:
toda la API pública vive bajo **`/api/v1`**. Las rutas sin versión
siguen respondiendo, como alias *deprecados* (`Deprecation: true` y
`Link: …; rel="successor-version"`, RFC 8594). El único cambio que
rompía de verdad en esta tanda —el cuerpo de `/lugares`, de aeropuertos
sueltos a ciudades— conservó la forma vieja en `/api/lugares` y puso la
nueva en `/api/v1/lugares`.

### REST + JSON, no gRPC + protobuf: la cuenta

La clase compara REST+OpenAPI (JSON, tipado opcional, "muy vigente en
APIs públicas"), gRPC+Protobuf (binario, tipado fuerte, "muy vigente
hacia adentro") y SOAP+WSDL (XML, mayormente legacy). La regla práctica
es REST hacia afuera y gRPC hacia adentro; esto es lo que se evaluó:

| Pregunta | Acá |
|---|---|
| ¿Quién consume la API? | El navegador, que sólo habla HTTP/JSON, y servicios propios. |
| ¿Controlamos los dos extremos? | Entre servicios, sí. |
| ¿Cuánto tráfico hay? | Una búsqueda cuesta unos 3 ms en el servicio; con decenas de pedidos por segundo, la diferencia de tamaño y velocidad entre JSON y protobuf no se mide. |
| ¿Hace falta streaming bidireccional? | No. |

Pasar a protobuf costaría un `.proto` compartido, generación de stubs y
HTTP/2 en cada servicio, a cambio de nada que se note. Se mantuvo JSON
con el contrato en OpenAPI, que sí aporta: documentación, cliente
generable, validación. Si el tráfico interno creciera, el lugar donde
cambiarlo son `pedir.js` y `http.js`: son los dos únicos archivos que
saben cómo se serializa.

## 4. Descubrimiento de servicios

Cuando los servicios aparecen, se mueven y desaparecen, una dirección
fija en el código deja de servir. La clase presenta el patrón (registro,
descubrimiento, configuración dinámica), dos variantes y dos
herramientas.

### Qué se implementó

`servidor/registro/` (puerto 4006) es un registro de servicios mínimo,
al estilo de **Consul**:

1. **Registro.** Cada servicio, al arrancar, se anota con su nombre,
   dirección e id de instancia, y repite el anuncio cada 3 s (el latido).
   Al cerrarse ordenadamente se da de baja; si muere sin avisar, el
   registro la quita al vencer el TTL (10 s).
2. **Health checks activos.** El registro pregunta cada 2 s a
   `/salud/ready` de cada instancia y la marca `pasando` o `critico`:
   "además de registrar, verifica activamente si el servicio sigue
   respondiendo", como Consul.
3. **Consulta.** El agregador baja cada 2 s la lista de instancias sanas
   de cada servicio y reparte los pedidos **por turnos**. Es el
   **descubrimiento del lado del cliente** (Netflix Eureka + Ribbon, gRPC
   con balanceo en el cliente): el cliente consulta el registro y elige él
   mismo la instancia; a favor, un salto menos; en contra, que cada
   cliente lleva esa lógica.

Y en Docker Compose rige la otra variante: el **lado del servidor**.
Dentro de la red de Compose, el nombre de un servicio (`vuelos:4001`)
resuelve a una dirección fija que reparte el propio Docker, sin ningún
código. La clase lo marca así para el proyecto: *Docker Compose y
Kubernetes resuelven el nombre del servicio de esa forma*. Los dos
mecanismos conviven: las `URL_*` de la configuración son el respaldo
cuando el registro no responde.

### Vivo no es lo mismo que listo

La clase presenta las dos sondas de Kubernetes. Cada servicio las expone:

| Sonda | Pregunta | Si falla | Depende de |
|---|---|---|---|
| `GET /salud/live` | ¿el proceso responde? | hay que **reiniciarlo** | nada externo |
| `GET /salud/ready` | ¿puede atender tráfico? | hay que **dejar de mandarle tráfico** | sus dependencias (la base, Redis) |

La liveness no depende de la base a propósito: si dependiera, una caída
de Postgres reiniciaría a todos los servicios sin sentido. Un caso real
del proyecto: `usuarios` arranca *viva pero no lista* si Postgres no
contesta (`/salud/live` 200, `/salud/ready` 503), prepara la base en
segundo plano y pasa a estar lista sola en cuanto Postgres vuelve
(medido: 5 s después). Mientras tanto, el registro la saca del reparto.

### Qué pasa en cada falla

| Situación | Qué hace el cliente |
|---|---|
| El registro responde y hay instancias sanas | Usa una, por turnos. |
| El registro responde y **ninguna** está lista | `motivo: sin_instancias`: no llama a quien dijo "no estoy listo". |
| El registro no responde, o nunca oyó hablar del servicio | Usa las direcciones fijas (`URL_*`). |
| Una instancia muere en seco | La lista tiene hasta ~4 s de antigüedad; ante un fallo de *conexión* el cliente reintenta una vez contra otra instancia y marca a la caída como sospechosa 5 s (detección pasiva de instancias defectuosas, complemento del health check activo). |

Lo último se mide: con dos instancias de vuelos y una caída en seco,
**sin** failover fallaban 4 de 8 búsquedas durante la ventana; **con**
failover, 0. El failover se aplica sólo a operaciones que se pueden
repetir sin efecto doble: las búsquedas y la reserva, que lleva su
`Idempotency-Key`. Con un *timeout* no se reintenta: ya se gastó el
presupuesto del usuario y la instancia pudo haber procesado el pedido.

### El registro es un punto único de falla

La clase lo dice: Consul y etcd replican su estado entre varios nodos con
consenso (**Raft**: un líder coordina y la mayoría confirma) para no ser
ellos mismos un punto único de falla. Acá hay una sola instancia y se
declara: **nadie depende del registro para funcionar**. Perderlo hace
perder el descubrimiento dinámico, no el sistema; al volver, los
servicios se re-anotan solos con su próximo latido. Medido: con el
registro caído, las búsquedas siguen en 200.

## 5. Cómo se demuestra

```bash
npm run infra:up && npm run back   # el registro es el servicio :4006
```

Con el sistema levantado:

```bash
# Una segunda instancia de vuelos: aparece sola en el registro
PUERTO_VUELOS=4011 INSTANCIA_ID=vuelos@4011 npm run back:vuelos
curl localhost:4006/api/v1/servicios/vuelos        # dos instancias, 'pasando'
# Buscar varias veces desde la pantalla: cada instancia imprime en su terminal
# los pedidos que recibe ([vuelos] GET /api/vuelos?…) y se reparten por turnos

# Que una deje de estar lista sin reiniciarla
curl -X PUT localhost:4011/demo/listo -H 'content-type: application/json' -d '{"listo":false}'
curl localhost:4006/api/v1/servicios/vuelos        # la 4011 pasa a 'critico'

# Matarla en seco: las búsquedas no fallan
kill -9 $(lsof -tiTCP:4011 -sTCP:LISTEN)
```

El panel de administración (`/admin`) muestra lo mismo en vivo: cada
servicio, sus instancias y cuáles están sanas
(`GET /api/v1/sistema/servicios`, sólo administradores).

## 6. Límites conocidos

- **El registro es una sola instancia** (ver arriba) y guarda todo en
  memoria: no sobrevive a un reinicio, pero se reconstruye con los latidos.
- **Es descubrimiento por sondeo**, no por notificación: un cambio tarda
  hasta ~4 s en llegar a los clientes (el failover cubre esa ventana).
- **Las instancias comparten la base SQLite de su servicio.** Está bien
  para la demostración de dos procesos del mismo servicio; con instancias
  en máquinas distintas habría que pasar a una base de red.
- **Sin gRPC.** La decisión de §3 es por la escala de la demostración;
  con otro volumen se revisa.
- **Swagger UI** (`/api/v1/docs`) carga su interfaz desde un CDN: la
  página necesita internet; el documento OpenAPI en sí, no.
