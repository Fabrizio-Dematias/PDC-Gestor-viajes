# Arquitectura multi-nodo y marca blanca

Este documento ordena lo hablado con el profesor (notas sueltas + el
diagrama de dos servidores) en una arquitectura concreta, y la conecta
con lo que ya está construido en Fases 1-2 (`docs/entrega-0-plan-de-proyecto.md`).
No reemplaza el contrato del agregador ni el plan de Entrega 0: es la
base para diseñar las etapas E3 en adelante, que hoy están descriptas
pero no con este nivel de detalle.

Diagrama: **`docs/arquitectura-multi-nodo.html`** (abrir y capturar como
`.png`, mismo flujo que `infografia.html`).

---

## 1. Lo que se planteó, ordenado

Las notas de la reunión, agrupadas por tema:

**Separación física front / API**
- Las consultas del front tienen que poder llegar a un servidor
  *distinto* del que sirve la API, para que la caída de la API no tumbe
  también la página.
- Un servidor para la app front, otro para la API de vuelos (y del
  resto de los verticales).

**Marca blanca (multi-agencia)**
- El sistema es, de fondo, una agencia. El objetivo comercial es
  ofrecerlo a *otras* agencias como producto de marca blanca: varios
  fronts, cada uno personalizado (branding, verticales habilitados),
  todos consultando los mismos datos.
- Cada agencia que contrata el servicio tiene su propio **nodo**. La
  meta es soportar varios nodos de agencia en simultáneo.
- Ese nodo podría tener una **base de datos temporal** propia, que
  después sincroniza contra la base central.

**Cantidad mínima de nodos**
- Al menos dos servidores, idealmente tres, cada uno con sus
  microservicios individualizados:
  1. **Nodo API** — el que habla con las fuentes de datos externas.
  2. **Nodo nuestro** — el que centraliza entrada y almacenamiento.
  3. **Nodo(s) de agencia** — uno por cliente de marca blanca.

**El diagrama del profesor** (dos servidores) es exactamente los nodos 1
y 2 de esa lista, con el detalle de qué microservicios va en cada uno:

| Servidor 1 — Entrada y almacenamiento | Servidor 2 — Cómputo / workers |
|---|---|
| API Gateway | Worker Vuelos |
| Auth / Users | Worker Hoteles |
| Base de datos principal (Postgres) | Worker Seguros / Otros |
| Cache / Message broker (Redis) | |

El nodo de agencias no está en el dibujo porque es el que se
multiplica (uno por cliente); el dibujo muestra la infraestructura que
todos esos nodos comparten.

**Sobre la fuente de datos:** si no hay una API externa útil y gratuita
para un vertical, se arma una ficticia — pero el *lugar* para la
conexión real tiene que existir igual. Esto ya es exactamente cómo está
armado el sistema hoy (`ProveedorDeVuelos`, `ProveedorDeHospedaje`,
ver más abajo, §6), así que no es un requisito nuevo: es una
confirmación de que el patrón ya elegido es el correcto y hay que
sostenerlo para cualquier vertical que se agregue.

---

## 2. Topología: tres tipos de nodo

```
 Nodo Agencia A      Nodo Agencia B      Nodo Agencia N
 (front + BD local)  (front + BD local)  (front + BD local)
        \                   |                   /
         \__________________|__________________/
                            |
                     Nodo Central ("nuestro")
              API Gateway · Auth/Users · Postgres · Redis
                            |
                    Nodo de Cómputo (workers)
           Worker Vuelos · Worker Hoteles · Worker Traslado
                            |
              Proveedores externos (reales o ficticios)
```

Los nodos de agencia sólo hablan con el nodo central, nunca con el de
cómputo directamente — esa es la regla que hace cumplir físicamente el
Gateway. Es la misma disciplina que ya existe hoy entre el front y los
microservicios (`src/api/cliente.js` es el único punto que sabe hablar
con el backend); acá se repite un nivel más arriba.

### Nodo 1 — Central ("nuestro" / Servidor 1)

| Componente | Rol | Equivalente hoy |
|---|---|---|
| **API Gateway** | Único punto de entrada para todos los nodos de agencia. Resuelve de qué agencia viene la request (subdominio, header o API key), valida auth, y reparte el pedido a los workers en paralelo con timeout y circuit breaker | `servidor/agregador/` |
| **Auth / Users** | Login, roles, preferencias — y ahora también identidad de agencia (a qué tenant pertenece cada usuario) | `servidor/usuarios/` |
| **Postgres (BD principal)** | Fuente de verdad para lo que es compartido entre agencias y verticales: usuarios, agencias, config de admin, auditoría, log agregado de búsquedas | Hoy son tres SQLite separadas (`usuarios.db`, y el resto por servicio) |
| **Redis (cache / message broker)** | Dos usos: caché de "última respuesta buena" por vertical (Etapa 5 del plan, ya prevista) ahora compartida entre instancias del Gateway; y cola para sincronizar de forma asíncrona lo que cada nodo de agencia guardó en su base temporal | No existe todavía — hoy la caché de Etapa 5 iba a vivir en memoria del agregador |

El Gateway es el agregador de hoy con un trabajo más: antes sabía "a
qué vertical llamar", ahora además sabe "de qué agencia es esta
request y qué verticales tiene habilitados". La lógica de paralelismo,
timeout, tres estados y circuit breaker no cambia — se relocaliza.

**Dónde vive el Postgres.** Local en `docker-compose.central.yml` para
desarrollo, o un Postgres alojado (Supabase, por ejemplo) para no
depender de un contenedor propio en producción — es sólo cambiar
`PGHOST`/`PGUSER`/`PGPASSWORD`/`PGSSL` (`.env.example`,
`servidor/comun/basePg.js`): el código usa `pg` estándar y no sabe ni
le importa quién aloja la base. **Sólo esta base central** es candidata
a irse a un Postgres alojado — las bases propias de cada worker
(`vuelos.db`, `hospedaje.db`, `traslado.db`, más abajo) tienen que
seguir separadas y locales a cada servicio: es justo lo que hace que
apagar un worker sólo tumbe su propia sección de la pantalla. Juntarlas
todas en una base compartida —alojada o no— sería deshacer el
requisito central del proyecto.

### Nodo 2 — Cómputo / workers (Servidor 2)

| Componente | Rol | Equivalente hoy |
|---|---|---|
| **Worker Vuelos** | Disponibilidad y precios de vuelos | `servidor/vuelos/` |
| **Worker Hoteles** | Disponibilidad y precios de hospedaje | `servidor/hospedaje/` |
| **Worker Traslado** | El tercer worker del diagrama ("Seguros/Otros"); el equipo eligió traslados terrestres aeropuerto↔ciudad | `servidor/traslado/` |

Cada worker sigue con su propia base para su catálogo (aeropuertos,
alojamientos, y ahora tarifas de traslado) — eso no
cambia respecto de hoy, porque es dato de dominio del propio servicio,
no dato compartido entre agencias. Sólo migra a la Postgres central lo
que es transversal (usuarios, config, auditoría, log de búsquedas). Los
workers sólo reciben requests del Gateway, nunca de un front
directamente — así el "servidor con la API de vuelos" del que hablaba
el profesor queda físicamente separado del servidor que atienden los
fronts.

### Nodo 3 — Agencias (N nodos, uno por cliente)

| Componente | Rol |
|---|---|
| **Front de marca blanca** | Mismo código de `src/` hoy, parametrizado por `agencia_id`: logo, colores, nombre y qué verticales mostrar salen de un endpoint de config del Gateway, no están hardcodeados |
| **BD temporal (opcional)** | No guarda catálogo (eso siempre viene en vivo del Gateway). Guarda lo que se genera en el borde: búsquedas recientes para que la página no quede en blanco si el central tarda, o algo que el usuario empezó a completar y todavía no se confirmó contra el central. Se sincroniza contra Postgres de forma asíncrona (vía la cola de Redis) |

Este nodo es el que responde al primer punto de la reunión: "consultas
del front en otro servidor, por si se cae la API". Al no tener lógica
de negocio — sólo estáticos de la SPA y esta caché local opcional — el
nodo de agencia puede seguir sirviendo la página, con datos de la
última búsqueda buena, aunque el nodo central esté caído. Es el mismo
mecanismo de "caché de última respuesta buena" que ya está en el plan
de Etapa 5, aplicado un nivel más arriba: antes era por vertical, ahora
también por agencia.

---

## 3. Flujo de una búsqueda, de punta a punta

1. El usuario entra a `agencia-x.gestordeviajes.com` (Nodo Agencia X).
2. El front pide su configuración de marca al Gateway
   (`GET /api/tenant/config`), que resuelve `agencia_x` por subdominio
   y devuelve branding + verticales habilitados.
3. El usuario busca un viaje. El front hace **una request por
   vertical** al Gateway, igual que hoy (`docs/contrato-agregador.md`
   §4) — eso no cambia con el nodo nuevo.
4. El Gateway resuelve preferencias del usuario + config de la agencia
   (Postgres, con caché en Redis), y llama en paralelo a los workers
   habilitados en el Nodo 2, con el mismo timeout y circuit breaker que
   ya existen.
5. Cada worker consulta su proveedor (real o ficticio, según §6) y
   responde con la forma ya definida en el contrato — no cambia.
6. El Gateway arma la respuesta parcial, la deja en Redis como "última
   respuesta buena" de esa agencia+vertical, y registra la búsqueda en
   Postgres (`agencia_id`, resultado, timestamp) para analítica entre
   agencias.
7. Si el nodo central no responde, el Nodo Agencia X puede mostrar la
   última respuesta que tenga en su base temporal, con el aviso de
   antigüedad que el sistema ya usa para la caché de vertical.

---

## 4. Tolerancia a fallos: se hereda, no se reinventa

Los cinco mecanismos de `docs/entrega-0-plan-de-proyecto.md` siguen
siendo los mismos; lo único que cambia es a qué distancia física
ocurren:

| Mecanismo | Antes | Ahora |
|---|---|---|
| Llamadas en paralelo | Agregador → 2 verticales, mismo proceso | Gateway (nodo central) → N workers (nodo de cómputo), por red entre servidores |
| Timeout con `AbortController` | Front→agregador→vertical | Se agrega un tramo: Nodo agencia→Gateway |
| Tres estados | loading/ok/unavailable por vertical | Igual, sin cambios |
| Circuit breaker | En memoria del agregador | En el Gateway, con estado en Redis para que sobreviva a un reinicio |
| Caché de última respuesta buena | En memoria, por vertical | En Redis, por agencia+vertical; y una segunda copia opcional en la BD temporal del nodo de agencia |

El punto fuerte para la defensa: ahora se puede apagar **un servidor
entero** (el de cómputo) delante del evaluador y mostrar que los fronts
de todas las agencias siguen respondiendo con la última caché buena —
la misma demostración de hoy (`docker stop` de un vertical), pero a
escala de nodo físico en vez de proceso.

---

## 5. Mapeo: sistema actual → sistema objetivo

| Hoy | Se convierte en | Cambia |
|---|---|---|
| `servidor/agregador/` | API Gateway, Nodo Central | Suma resolución de tenant y ruteo entre servidores; la lógica de paralelo/timeout/breaker se mantiene |
| `servidor/usuarios/` (`usuarios.db`) | Auth/Users, Nodo Central | Su base migra a Postgres; tablas `preferencias`, `config`, `auditoría` suman `agencia_id` |
| `servidor/vuelos/`, `servidor/hospedaje/` | Worker Vuelos, Worker Hoteles, Nodo Cómputo | Sólo reciben requests del Gateway; su base propia no cambia |
| — (no existe) | Worker Traslado, Nodo Cómputo | Vertical nuevo, mismo patrón `ProveedorDeX` que los otros dos |
| `src/` (front único) | Front de marca blanca, un Nodo Agencia por cliente | Se parametriza por `agencia_id`; los componentes (tres estados, secciones por vertical) no cambian |
| Caché de Etapa 5 (prevista en memoria) | Redis, Nodo Central | Se adelanta la decisión de tecnología, no el timing en el plan |

---

## 6. La fuente de datos: el patrón ya elegido alcanza

El pedido de "si no hay API útil, hacemos una ficticia pero con la
conexión lista" es literalmente `ProveedorDeVuelos` /
`ProveedorDeHospedaje` (`servidor/vuelos/proveedor.js`,
`docs/proveedor-externo.md`): una interfaz, una implementación ficticia
contra la base propia y una implementación contra API real,
intercambiables por `PROVEEDOR=ficticio|amadeus` sin tocar nada más.

El tercer worker del diagrama ("Seguros/Otros") terminó siendo
**Traslado** (aeropuerto↔ciudad), a pedido del profesor. Sigue el mismo
molde:

1. `servidor/traslado/proveedor.js` — la interfaz (`buscar(criterios) →
   Traslado[]`).
2. `servidor/traslado/proveedor-ficticio.js` — implementación contra una
   base propia con tipos de vehículo y precios generados, mismo criterio
   que vuelos/hospedaje (dato real donde exista uno público, simulado
   sólo en lo comercial).
3. Un espacio para `proveedor-<real>.js` el día que aparezca una API de
   tarifas de traslado — no hace falta tenerla ahora, sólo dejar el
   archivo y el `if` en `crearProveedor` listos, tal como quedó
   `proveedor-amadeus.js` para vuelos y hospedaje.

No hay nada que rediseñar acá: es aplicar el patrón existente una vez
más.

---

## 7. Dónde entra esto en la planificación

El plan de Entrega 0 (`docs/entrega-0-plan-de-proyecto.md`) ya reserva
Etapa 5 para circuit breaker, caché y contenedores, y Etapa 6 para el
panel de administración. Este documento le da forma concreta a esas
etapas y agrega un eje que hoy no está explícito — multi-agencia — que
conviene ubicar así:

| Etapa existente | Qué de este documento le corresponde |
|---|---|
| **E3** · Identidad y preferencias | El modelo de datos de `usuarios` suma el concepto de agencia/tenant junto con el login real |
| **E4** · Proveedor externo | Sin cambios; si se agrega Seguros/Otros, se decide ahí mismo real vs. ficticio |
| **E5** · Resiliencia y despliegue | Acá se materializa el split físico: Gateway + Postgres + Redis en un `docker compose`, workers en otro. Es el punto donde de verdad se necesitan ≥2 servidores/contenedores separados |
| **E6** · Administración | El panel de config por vertical se extiende a config por agencia (branding, verticales habilitados) |
| *(nuevo, a nombrar)* | Nodo(s) de agencia como despliegue aparte — al menos 2 instancias del front para la demo, cada una con su `agencia_id`, para poder mostrar la personalización y la caída del central sin tumbar los fronts |

**Punto a decidir con el resto del equipo/profesor:** cuántos nodos de
agencia se muestran en la demo (con 2 alcanza para probar
personalización + aislamiento) y si valen como contenedores Docker
separados o como builds del mismo front en puertos distintos — la
segunda opción es más simple y cumple igual el requisito de "nodo
separado" para una demostración académica.

---

## 8. Resumen para la próxima conversación con el profesor

- Mínimo de nodos que pide la consigna (2-3, servicios individualizados
  como microservicios): **cumplido** con Central + Cómputo + Agencia(s).
- Front en servidor separado de la API, resiliente a que la API se
  caiga: **cumplido** por diseño — el nodo de agencia no depende del
  central para seguir sirviendo la página.
- Marca blanca con varios fronts personalizables consultando una base
  centralizada: **cumplido** — un `agencia_id` transversal en Postgres
  y un front parametrizado por esa misma clave.
- BD temporal por nodo de agencia que sincroniza al central:
  **diseñada** en §2-3, pendiente de implementar en E5.
- Conexión real (o slot para ella) en la fuente de datos de cada
  vertical: **ya es así hoy** para vuelos y hospedaje, y es el mismo
  molde para cualquier vertical nuevo.
