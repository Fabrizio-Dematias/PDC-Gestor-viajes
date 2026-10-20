# Módulo 3 — Comunicación y sincronización

Cómo está resuelto en el proyecto cada tema del módulo, con la evidencia
para volver a verlo. El módulo tiene cuatro temas; el proyecto usa de
verdad los dos primeros y una parte del cuarto, y razona por qué **no**
necesita el tercero. Cada una de esas decisiones está escrita abajo, con
las que se descartaron.

| Tema de la clase | En el proyecto | Dónde |
|---|---|---|
| **1. Modos de comunicación** | Síncrono (REST/JSON con timeout) para lo que el usuario espera ver; asíncrono (cola en Redis Streams) para el aviso de confirmación y (cola local) para la bitácora de las agencias. Orientado a flujo: no corresponde. | §1 |
| **2. Semántica de entrega** | Al menos una vez + idempotencia = efecto de una sola vez, en la reserva y en el aviso. | §2 |
| **3. Relojes lógicos y causalidad** | No hace falta ninguno: cada dato tiene un solo ordenador (una base, un stream). Se explica dónde sí harían falta. | §3 |
| **4. Coordinación y consenso** | Exclusión mutua sobre el último asiento, resuelta con una transacción de base de datos. Elección de líder y consenso: no se implementan; se dice qué sistemas los usan por nosotros y dónde está el punto único de falla. | §4 |

Detalle de la API y de los códigos de respuesta: `docs/contrato-agregador.md`
§11. Cómo mostrarlo en vivo: sección 5.

---

## 1. Modos de comunicación

### Síncrono

El emisor envía y espera. Es lo que corresponde cuando **el usuario está
mirando la pantalla** y necesita la respuesta para seguir.

- **Navegador → agregador y agregador → servicios**: REST sobre HTTP con
  JSON. El emisor corta con `AbortController` si pasa su presupuesto de
  tiempo (3 s el front, 2,5 s el agregador hacia cada vertical; con Duffel
  vuelos tiene 5,5 s — contrato §3). Cada capa se corta antes que la de
  arriba, así el que responde "no disponible" es el más informado.
- **Las llamadas a los tres verticales se hacen en paralelo**, no una
  tras otra: la latencia de una búsqueda es la del servicio más lento,
  no la suma. Es la contracara de la latencia acumulada que la clase
  marca como costo de las cadenas síncronas.
- **La reserva** (`POST /api/reservas`): el agregador llama a vuelos y
  espera el resultado (201, 200 si es un reintento, 409 sin cupo, 503 si
  vuelos no responde), porque quien reserva necesita saber *ahora* si
  consiguió el asiento.

### Asíncrono

El emisor envía y sigue; la respuesta, si la hay, llega después.

- **Aviso de reserva confirmada.** El agregador publica el evento
  `reserva_confirmada` en un stream de Redis (`reservas:eventos`, `XADD`)
  y responde al usuario sin esperar a nadie. El servicio
  `notificaciones` —un proceso aparte, puerto 4005— lo consume con un
  grupo de consumidores (`XREADGROUP`), "envía" la confirmación y recién
  entonces lo da por entregado (`XACK`). Es el patrón que la clase
  ejemplifica con colas y webhooks: el emisor no conoce al receptor ni
  espera su respuesta.
- **Bitácora de los nodos de agencia.** Cada nodo guarda las búsquedas
  en una base local y las sincroniza con el central en segundo plano,
  reintentando hasta que el central confirma. Ya estaba antes de este
  módulo.

La razón de elegir cola para el aviso, y no una llamada más: ese aviso no
puede **frenar** la reserva (el usuario ya tiene su asiento) ni
**hacerla fallar**, y el servicio que lo manda puede estar caído. Con la
cola en el medio, la reserva responde en milisegundos aunque
`notificaciones` esté apagado, y los avisos esperan en el stream hasta que
vuelva. Medido: con el consumidor caído, la reserva sigue respondiendo 201
en milisegundos.

### Orientado a flujo

No se usa. Es el modo de los datos continuos —video, sensores— y este
sistema intercambia mensajes discretos (una búsqueda, una reserva, un
evento). Forzarlo sería elegir la herramienta por el módulo y no por el
problema.

## 2. Semántica de entrega

La tabla que justifica la semántica de cada punto del sistema (la misma
del contrato, §11):

| Punto del sistema | Canal | Semántica | Por qué |
|---|---|---|---|
| Búsqueda: navegador → agregador → verticales | Síncrono, en paralelo | Request/response con timeout, sin reintentos automáticos | El usuario espera resultados ya; reintentar una búsqueda lenta sólo la haría más lenta. |
| Reserva: agregador → vuelos | Síncrono | **Al menos una vez** (el cliente reintenta) + **idempotencia** (el servidor deduplica) | Con un timeout no se sabe si la reserva se hizo; reintentar con la misma clave es seguro. |
| Aviso de reserva: agregador → notificaciones | Asíncrono (Redis Streams) | **Al menos una vez** + consumidor idempotente | Perder un aviso es peor que recibirlo dos veces; el duplicado se descarta por `reserva_id`. |
| Bitácora: nodo de agencia → central | Asíncrono (cola local) | Al menos una vez (se reintenta hasta que el central confirma) | Guardar la búsqueda nunca debe demorar ni romper la pantalla. |

**Descartadas.** *Como máximo una vez* (enviar y olvidar): una reserva o
un aviso perdido son inaceptables acá; sólo sirve para datos
descartables, como una lectura de sensor. *Exactamente una vez*: no se
puede garantizar de punta a punta sólo con la red (el acuse de recibo
también se puede perder); se **aproxima** combinando "al menos una vez"
con deduplicación por un identificador explícito —que es lo que la clase
llama idempotencia, y lo que hace el sistema—.

**Cómo se logra la idempotencia.**

- En la reserva, el cliente manda una `Idempotency-Key` (el front la
  genera una vez al llegar a la pantalla de datos y la reusa en cada
  reintento; un doble clic tampoco reserva dos veces). El `reserva_id` es
  la clave primaria de la reserva: si ya existe, se devuelve la misma
  (200, `repetida: true`) sin descontar otro asiento.
- En el aviso, la tabla de notificaciones usa el `reserva_id` como clave
  primaria. Si el mismo evento llega dos veces, se cuenta la repetición y
  no se manda otro mensaje. Demostrado: una reserva repetida 8 veces
  llegó 8 veces a la cola y se envió una sola.
- Si el consumidor muere entre procesar y confirmar (`XACK`), el evento
  queda en la lista de pendientes del grupo y otro `XAUTOCLAIM` lo
  reclama tras 3 s: nunca se pierde.

**Orden.** La clase contrapone las colas *standard* (volumen, sin orden
garantizado) y *FIFO* (orden y deduplicación, a costa de rendimiento) y
dice que FIFO se usa cuando el orden importa de verdad, por ejemplo en
estados secuenciales de una misma entidad. Acá cada evento es
independiente (hay un solo estado, `reserva_confirmada`, y cada uno trata
de una reserva distinta), así que no se depende del orden y no se paga por
él. Un stream de Redis conserva igual el orden de inserción; con varios
consumidores en el grupo ese orden dejaría de valer para el
procesamiento, y está bien.

## 3. Relojes lógicos y causalidad

Los relojes de Lamport y los vectoriales sirven para **ordenar eventos
cuando no hay un reloj común ni un único árbitro**: Lamport garantiza que
si A causó B entonces C(A) < C(B); el vectorial, además, distingue eventos
concurrentes. Este sistema no los necesita, y es una consecuencia de una
decisión de diseño más que de una omisión:

- **Cada dato tiene un solo ordenador.** El cupo de un vuelo vive en un
  único archivo SQLite, y `BEGIN IMMEDIATE` serializa las escrituras: el
  orden de las reservas lo decide la base, no los relojes de los
  clientes. Los eventos tienen un único stream, y Redis les pone un
  identificador creciente al insertarlos. Con un solo árbitro por dato
  hay un orden total y no hay nada que reconstruir.
- **No se compara ninguna hora entre máquinas.** Las horas que se
  muestran (los horarios de los vuelos) son datos, no un mecanismo de
  orden. Las marcas de tiempo de los registros (`creada_en`) son
  informativas.

Dónde harían falta: si el cupo se replicara en varios nodos que aceptan
escrituras a la vez (multi-master), dos reservas "concurrentes" en nodos
distintos habría que detectarlas como tales —un reloj vectorial las
distingue de las causalmente ordenadas— y resolver el conflicto; o si un
consumidor tuviera que ordenar eventos de varios productores
independientes. Lo que sí hay, y se parece a la causalidad, es el
**`x-request-id`**: lo genera el primer servicio que recibe un pedido y se
reenvía a cada servicio al que éste llama, así una búsqueda que tocó el
agregador, vuelos y usuarios se sigue de punta a punta en los logs. No
ordena, pero reconstruye "esto causó aquello".

## 4. Coordinación y consenso

### Exclusión mutua: el último asiento

El ejemplo de la clase es éste: dos personas compiten por la última
entrada de un recital; un lock distribuido (en Redis o en una transacción
de base de datos) asegura que sólo una compra se confirme. Es exactamente
el caso de concurrencia del proyecto.

**El invariante:** en cada vuelo, los asientos vendidos nunca superan la
capacidad.

**El defecto, demostrable.** Un pedido hace lo "obvio": lee cuántos
asientos quedan, ve que alcanza, espera la confirmación del proveedor
(simulada, 15 ms) y escribe el valor que calculó. Con varios pedidos a la
vez todos leen "queda 1" antes de que ninguno escriba: una
*actualización perdida*. Se puede activar a propósito (modo `ingenuo`):
20 pedidos por 1 asiento terminan con las 20 confirmadas y el vuelo
sobrevendido en 19.

**La solución.**

- **Descuento atómico**: comprobar y escribir son una sola sentencia,
  `UPDATE cupos SET ocupados = ocupados + :n WHERE vuelo_id = :id AND
  ocupados + :n <= capacidad`, dentro de `BEGIN IMMEDIATE`. Si no
  actualiza ninguna fila, no había lugar → 409. Es la "transacción de base
  de datos" del ejemplo de la clase, en lugar de un lock en Redis: el
  lock y el dato viven en el mismo lugar, así que no hay un segundo
  sistema que pueda quedar desincronizado. La espera del proveedor queda
  *fuera* de la sección crítica: nunca se retiene un bloqueo mientras se
  espera la red.
- **Defensa en profundidad**: `CHECK (ocupados <= capacidad)`. Aunque
  falle la lógica de la aplicación, la base rechaza la sobreventa.
- **Varios tramos, todo o nada**: una reserva de ida y vuelta descuenta
  el cupo de cada tramo en la misma transacción; si uno falla, se deshace
  todo.

**Resultados medidos** disparando los pedidos a la vez contra el sistema real:

| Escenario | Resultado |
|---|---|
| 20 pedidos por 1 asiento, **sin** control | 20 confirmadas, sobreventa de 19 |
| 20 pedidos por 1 asiento, con control | exactamente 1 confirmada, 19 × 409 |
| 40 pedidos por 5 asientos | exactamente 5 |
| 6 pedidos de 3 pasajeros por 10 asientos | caben 3 (9 ocupados) |
| 8 pedidos con la misma `Idempotency-Key` | 1 creada, 7 repeticiones, un solo descuento |
| **60 pedidos por 5 asientos entre dos procesos de vuelos sobre el mismo archivo** | exactamente 5, sin sobreventa |

La última fila responde una limitación que declaraba la entrega
original ("no se probó con varios procesos de vuelos"): `BEGIN IMMEDIATE`
toma el bloqueo de escritura de la base, así que protege también entre
procesos; se verificó con dos instancias de vuelos sobre el mismo archivo.

### Otra solución: el modelo de actores

Cada vuelo es un actor con un **buzón**, y los pedidos se atienden de a
uno, en orden. Dentro del buzón la lógica ingenua (leer, esperar, escribir)
es segura porque nadie más toca ese vuelo en ese momento: no hay carrera
que ganar. Existe como `PUT /demo/concurrencia {"modo":"actor"}` y da
el mismo resultado (exactamente 1 de 20).

La diferencia que importa: **el buzón vive en la memoria de un proceso.**
Con una sola instancia de vuelos equivale al `UPDATE` atómico; con dos,
cada una tendría sus propios buzones y la carrera volvería (habría que
enrutar todos los pedidos de un vuelo a la misma instancia). El `UPDATE`
condicional lo ordena la base, así que sigue valiendo con las instancias
que se quiera. Por eso el modo por defecto es el atómico y el de actores
queda como comparación.

### Elección de líder y consenso

No se implementan, y no se simulan. Dónde aparecen, de todas formas:

- **Redis y Postgres** son, cada uno, un único nodo en esta
  configuración (Postgres, el administrado de Supabase o el contenedor
  local). La replicación coherente —réplicas que convergen al estado que
  decidió el primario— es lo que ofrecerían sus versiones con réplicas, y
  no está montada acá.
- **El grupo de consumidores** de Redis Streams es coordinación hecha por
  Redis: reparte cada mensaje a *un* consumidor del grupo. No hay
  elección de líder entre consumidores ni se necesita.
- **El registro de servicios** (Módulo 4, `docs/modulo-4-middleware.md`)
  es una sola instancia: es el **punto único de falla** declarado. Consul
  y etcd lo resuelven replicándose entre 3 o 5 nodos con **Raft** (un
  líder coordina, la mayoría confirma; y para evitar el *split-brain* se
  exige quórum, porque elegir un líder nuevo no alcanza). Acá no se
  justifica: perderlo hace perder el descubrimiento dinámico, no el
  sistema (los clientes vuelven a direcciones fijas).

## 5. Cómo se demuestra

```bash
npm run infra:up          # Postgres y Redis (Docker)
npm run back              # los siete servicios
```

**Para mostrar el canal asíncrono a mano:**

```bash
npm run matar notificaciones        # se apaga sólo el consumidor
# reservar desde la pantalla (o POST /api/v1/reservas): responde 201 igual
redis-cli XINFO GROUPS reservas:eventos   # "lag": eventos esperando en la cola
npm run back:notificaciones         # al volver procesa los acumulados
curl localhost:4005/salud
```

**Para mostrar la carrera en vivo**, con el sistema levantado: poner un
vuelo con 1 asiento (`PUT :4001/demo/cupos/MIVUELO {"capacidad":1}`),
activar el modo ingenuo (`PUT :4001/demo/concurrencia {"modo":"ingenuo"}`),
disparar 20 reservas a la vez y mirar `GET :4001/api/cupos/MIVUELO`
(`sobreventa`); repetir con `{"modo":"atomico"}`. Las 20 a la vez:

```bash
for i in $(seq 20); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4000/api/v1/reservas \
    -H "idempotency-key: $(uuidgen)" -H 'content-type: application/json' \
    -d '{"vuelos":["MIVUELO"],"pasajeros":1}' &
done; wait      # modo atómico: un 201 y diecinueve 409
```

## 6. Límites conocidos

- **El aviso se pierde si Redis está caído al reservar.** La reserva
  igual se confirma y la respuesta lo dice (`evento_encolado: false`);
  ese aviso no se reintenta solo (sí si el cliente repite el pedido con la
  misma clave). La versión robusta guarda el evento junto con la reserva y
  lo publica aparte (patrón *outbox*).
- **Un solo consumidor.** El grupo permite sumar más, y Redis los
  repartiría, pero no se probó con varios.
- **Sólo se reservan vuelos del catálogo propio.** Las ofertas de Duffel
  no tienen cupo local: la reserva se rechaza con 404 `vuelo_desconocido`.
  Hospedaje y traslado no tienen reserva.
- **La confirmación del proveedor y el email están simulados.** No hay
  cobro ni servidor de correo (`servidor/comun/email.js` es un proveedor
  ficticio).
- **Los asientos son una cantidad por vuelo**, no plazas numeradas.
