# Entrega 0 — Plan de proyecto

Contenido para volcar en la plantilla de certificación. Cada título de
acá abajo corresponde a un campo de la plantilla, en el mismo orden.

> **⟨…⟩ = dato que falta y no puedo completar yo.** Son cinco: número de
> grupo, entidad asociada y los datos de los integrantes (no tengo
> forma de saber si este es un proyecto individual o en equipo, ni
> quiénes lo integran).

**Imágenes adjuntas** (en `docs/`): `infografia.png` · `gantt.png`.
Las capturas de `docs/capturas/` son de antes del rediseño de interfaz
(shadcn/ui) y del login real — quedaron desactualizadas visualmente;
conviene tomar unas nuevas antes de la entrega final si se quiere
evidencia en pantalla, la funcionalidad que muestran sigue vigente.

---

## Datos generales

| Campo | Valor |
|---|---|
| **Grupo N°** | ⟨completar⟩ |
| **Tag / Release de esta entrega** | `v0-plan-del-proyecto` |
| **Fecha de entrega** | 08/09/2026 |

---

## Proyecto

**Área:** Turismo — comercio electrónico de servicios de viaje, con
arquitectura de marca blanca multi-agencia.

**Empresa o entidad asociada:** ⟨ninguna: proyecto académico / completar
si corresponde⟩

**Título:** Gestor de viajes — buscador multivertical con tolerancia a
fallos parciales y arquitectura distribuida en tres nodos.

**Dominio:** Búsqueda y consulta de disponibilidad de servicios de viaje
(vuelos, hospedaje y traslados), ofrecido como plataforma de marca
blanca a varias agencias desde un mismo sistema, con datos provistos
por una interfaz intercambiable entre una API externa de la industria y
una base propia de respaldo.

### Breve descripción (1 párrafo)

Un buscador de viajes estilo Booking.com — vuelos, hospedaje y
traslados — que consulta los tres verticales en paralelo y muestra los
resultados en una sola pantalla, diferenciados según qué buscó el
usuario. Lo que distingue al proyecto no es el buscador sino su
comportamiento ante fallos: el sistema está construido como
microservicios independientes, repartidos en tres nodos físicos
(central, de cómputo y uno por agencia contratante), coordinados por un
agregador que aplica timeouts, circuit breaker y caché de última
respuesta buena, de modo que la caída de cualquier servicio degrada
únicamente su propia sección de la pantalla y deja el resto
funcionando. Tiene login real con roles y permisos, y cada vertical
obtiene sus datos a través de una interfaz con dos implementaciones
intercambiables —la API real de Amadeus y una base propia con datos
reales de referencia (aeropuertos, aerolíneas y rutas del mundo
entero)— seleccionables por configuración, lo que permite demostrar el
sistema sin depender de la red ni de la cuota del proveedor externo.

---

## Infografía

→ **`docs/infografia.png`** (adjunto)

Muestra la arquitectura completa en el escenario de fallo: navegador con
una sección por vertical, agregador, los tres microservicios de
cómputo, el nodo central (Postgres + Redis), la interfaz de proveedor
con sus dos implementaciones y las fuentes de datos. Incluye los tres
estados, el presupuesto de tiempo por capa (incluido el nuevo tramo
hacia el nodo central) y el guion de la demostración.

---

## Descripción

### El problema

Un buscador de viajes depende de varias fuentes de datos que no controla:
proveedores de vuelos, de hospedaje, de traslados. En la mayoría de las
implementaciones ingenuas, la pantalla espera a que **todas** respondan
antes de mostrar algo. Alcanza con que una sola se caiga —o peor, que
quede colgada sin responder— para que el usuario vea una pantalla en
blanco, un error genérico o una espera indefinida, aunque el 80 % de la
información que pidió ya esté disponible.

El proyecto toma ese problema como requisito central de diseño, no como
un detalle de manejo de errores a resolver al final.

### Qué hace el sistema

El usuario puede buscar sin cuenta: elige una solapa —Vuelos, Hospedaje
o Traslado—, cada una le pide sólo los campos que a ese servicio le
importan (vuelos necesita origen; los otros dos no), y el sistema
devuelve, en una misma pantalla, la sección correspondiente a lo que
pidió; el resto queda colapsado con el motivo, no oculto sin rastro. Si
inicia sesión —ofrecida, nunca forzada— puede indicar en su perfil qué
verticales le interesan, y un administrador puede habilitar o
deshabilitar verticales para toda su agencia y gestionar permisos de
otros administradores.

El sistema es además **multi-agencia (marca blanca)**: el mismo backend
sirve a varias agencias contratantes (`ag-demo`, `ag-sur` en la
semilla), cada una con su propio branding, su propia configuración de
verticales y su propio nodo de agencia, todas leyendo y escribiendo del
mismo nodo central.

### Arquitectura: tres nodos físicos

**Nodo central** — entrada y almacenamiento compartido entre todas las
agencias:
- **Agregador** (API Gateway) — recibe la búsqueda, decide a qué
  verticales llamar según la solapa elegida, las preferencias del
  usuario y la configuración del administrador, los llama **en
  paralelo**, arma la respuesta con lo que haya llegado a tiempo, y es
  quien emite y verifica la sesión (JWT).
- **Usuarios** — autenticación, roles, permisos, preferencias y
  auditoría. Única base **realmente centralizada** del sistema
  (agencias, usuarios, preferencias, config por agencia, auditoría,
  bitácora sincronizada desde cada nodo de agencia), en Postgres
  alojado en Supabase.
- **Redis** — caché de última respuesta buena y estado del circuit
  breaker. Deliberadamente **no** centralizado junto con Postgres: es
  estado por nodo, no una fuente de verdad compartida.

**Nodo de cómputo** — un microservicio por vertical, cada uno con su
propia base SQLite, sin acceso a la de los otros:
- **Vuelos** — 6071 aeropuertos y 131 294 itinerarios.
- **Hospedaje** — 48 568 alojamientos.
- **Traslado** — combi, auto privado, van o taxi entre el aeropuerto y
  el destino; 6071 ciudades con tarifa.

**Nodo de agencia** — una instancia por agencia contratante: su propio
front de marca blanca más un servicio `nodo-agencia` que guarda una
bitácora local de cada búsqueda y la sincroniza al nodo central.

El cliente es una SPA en React (shadcn/ui) que renderiza una sección
por vertical; cada sección hace su propio pedido al agregador, de
manera que su ciclo de vida es independiente del de las demás.

### Cómo se consigue la tolerancia a fallos

Cinco mecanismos, todos implementados y verificados:

1. **Llamadas en paralelo.** El agregador nunca consulta los verticales
   en serie. El tiempo total de una búsqueda es el del vertical más
   lento, no la suma de todos (medido: 2065 ms con dos verticales lentos
   en paralelo, contra lo que tardarían en serie).

2. **Timeout por tramo con `AbortController`.** 3000 ms entre el front y
   el agregador, 2500 ms entre el agregador y cada vertical, 1200 ms
   entre el agregador y usuarios (3000 ms si Postgres está alojado, como
   hoy con Supabase — el round-trip de red por sí solo puede superar el
   valor pensado para un Postgres local), 1800 ms entre un vertical y
   Amadeus. Cada capa se corta antes que la de arriba. El corte se hace
   con `AbortController` y no con `Promise.race`: `race` deja la
   conexión abierta consumiendo un socket, `abort` la cancela de
   verdad. Sin esto, un servicio *colgado* deja la búsqueda esperando
   indefinidamente, que es peor que un error limpio.

3. **Modelo de tres estados.** Cada vertical está siempre en exactamente
   uno de `loading`, `ok` o `unavailable`. El enum es el mismo en el
   front y en el back. La sección `unavailable` muestra un aviso dentro
   de su propia caja, con el motivo (timeout, error, circuito abierto,
   apagado por el admin, desactivado por el usuario, o —motivo nuevo,
   sólo del front— que la búsqueda fue para otra solapa).

4. **Circuit breaker.** Si un vertical falla 3 veces seguidas, el
   agregador deja de esperarlo durante 30 s y responde directamente sin
   él. Evita pagar el timeout completo en cada búsqueda mientras el
   servicio está caído. Verificado con una prueba automatizada: al
   cuarto fallo el circuito ya está abierto y no hay llamada de red.

5. **Caché de la última respuesta buena.** Si el circuito está abierto y
   hay resultados de una búsqueda reciente (10 minutos), se muestran en
   vez de nada. Corregido durante el desarrollo un bug real: la caché
   sólo debe entrar en juego cuando el circuito está abierto, no en
   cualquier fallo aislado —si no, esconde exactamente la clase de
   falla que el proyecto tiene que demostrar—.

### Búsqueda diferenciada y catálogo global

El buscador tiene solapas (Vuelos / Hospedaje / Traslado); cada una pide
sólo los campos que le hacen falta y la pantalla de resultados muestra
únicamente la sección que se pidió — el resto queda colapsado con el
motivo, no desaparece sin rastro. El catálogo de lugares es el dataset
completo de [OpenFlights](https://openflights.org/data.html) (licencia
ODbL): 6071 aeropuertos, 983 aerolíneas activas y 65 647 rutas reales,
de todo el mundo — no un recorte. El buscador de lugares sugiere por
ciudad, país o código IATA, sin depender de acentos, y para vuelos sólo
ofrece como destino los aeropuertos con ruta real desde el origen
elegido.

### Login real y permisos

Igual que un sitio comercial: se puede navegar y buscar sin cuenta —
ofrecida, nunca forzada—, pero perfil y administración exigen sesión.
Contraseñas con `scrypt` (`node:crypto`, sin dependencias externas),
sesión con JWT armado a mano (HS256, `node:crypto`, sin librería de
auth), verificación de email simulada (el código sale en la respuesta,
con etiqueta "modo demo"). Los administradores tienen permisos
granulares (`gestion_verticales`, `gestion_usuarios`) y pueden crear
otros administradores de su misma agencia; cada cambio de configuración
queda en una tabla de auditoría consultable por API.

### Preferencias en dos capas

**Capa del usuario.** En su perfil indica qué verticales le interesan.
El agregador no consulta los que el usuario no quiere ver.

**Capa del administrador.** Un panel muestra las preferencias agregadas
de todos los usuarios de su agencia y permite forzar el apagado de un
vertical para toda la agencia. El agregador consulta esa configuración
antes de llamar a cada servicio.

Decisión de diseño que se mantiene desde el plan original: la sección
"no disponible" que ve un usuario cuando un servicio se cae solo, la
que ve cuando el administrador lo apagó a mano, y la que ve cuando
buscó desde otra solapa, son **el mismo componente**. Cambia el motivo,
no la pantalla.

### Fuente de datos

Cada vertical con proveedor externo (vuelos, hospedaje) define una
interfaz propia —`ProveedorDeVuelos`, `ProveedorDeHospedaje`— con dos
implementaciones intercambiables por variable de entorno: una que lee
de la base propia del servicio y otra que consume la API real de
Amadeus. Traslado no tiene proveedor externo: no existe un GDS de
traslados terrestres que tenga sentido para el proyecto.

**Nota sobre Amadeus.** El plan original usaba su tier Self-Service
gratuito. Ese portal fue dado de baja el **17 de julio de 2026**, a
mitad de camino del proyecto: las claves existentes quedaron
deshabilitadas y no se admiten registros nuevos. Lo que queda en pie es
Amadeus Enterprise, un contrato comercial fuera del alcance de un
proyecto de cátedra.

El sistema no se vio afectado, y ese es el argumento más fuerte a favor
del diseño: nunca dependió de Amadeus, sino de una interfaz. El
proveedor externo desapareció en medio del proyecto y no hubo que tocar
el agregador, ni el front, ni el contrato, ni las bases. La
implementación contra Amadeus (OAuth2, timeouts, mapeo al contrato)
sigue completa y sin usar en el repositorio, como segunda
implementación de la interfaz.

**Qué se hizo en su lugar.** Las bases propias se siembran con el
dataset **completo** de OpenFlights, no un recorte: 6071 aeropuertos,
983 aerolíneas activas y 65 647 rutas reales, de todo el mundo. Las
distancias se calculan de las coordenadas y las duraciones de las
distancias. Lo que se simula son los horarios, la disponibilidad y los
precios — que es precisamente el dato que un GDS cobra por dar.

Las alternativas vigentes con capa gratuita están evaluadas en
`docs/proveedor-externo.md` (Duffel, Travelpayouts), con la
recomendación de no integrarlas: es trabajo de plomería, no de
tolerancia a fallos, que es el eje de la materia.

### Cómo se demuestra

El escenario de aceptación es una demostración en vivo:

1. Se lanza una búsqueda normal. Los verticales responden en paralelo
   en menos de un segundo.
2. Se apaga el nodo de cómputo entero delante del evaluador
   (`docker compose -f docker-compose.workers.yml down`) y se repite la
   búsqueda.
3. La sección afectada pasa a "no disponible" **dentro de su sección**
   al vencer el timeout. Ningún otro elemento de la pantalla cambia.
4. Se vuelve a levantar y la sección se recupera sola en la búsqueda
   siguiente — o antes, si el circuito seguía abierto, se ve la caché
   con su antigüedad declarada.

Un caso adicional, el servicio *colgado* (acepta la conexión y nunca
contesta, el que voltea a los sistemas sin timeout), se simula desde el
panel de fallos incluido en la aplicación.

### Alcance

**Dentro:** vuelos, hospedaje, traslado, login real con roles y
permisos, agregador con circuit breaker y caché, preferencias en dos
capas, panel de administración con auditoría, arquitectura de tres
nodos con marca blanca multi-agencia, y despliegue en contenedores.

**Fuera del núcleo:** autos y cruceros. No se descartan por dificultad
sino por tiempo: el vertical está armado como un patrón —una interfaz,
un fetcher y una entrada en un registro— así que sumarlos después es
agregar código nuevo, no rehacer el existente.

**Condicionado al tiempo disponible:** el módulo de reservas con
concurrencia real (dos usuarios compitiendo por el último asiento o la
última habitación). Es la única etapa que sigue pendiente del plan
original.

### Mapeo a los módulos de la materia

| Módulo | Cómo lo cubre este proyecto |
|---|---|
| **1** · Vistas 4+1 de Kruchten | El sistema documentado en las cuatro vistas, validadas con un único escenario: *"el usuario busca un viaje mientras el servicio de hospedaje está caído"*. Ese caso atraviesa la vista lógica (los tres estados), la de desarrollo (interfaz y contrato), la de procesos (llamadas en paralelo con timeout) y la física (tres nodos, cada uno en su propio contenedor). |
| **2** · Arquitectura de infraestructura | Microservicios con base propia por servicio, repartidos en tres nodos físicos simulados con `docker compose` (central / cómputo / uno por agencia); Postgres central migrado a un proveedor alojado (Supabase); fallos parciales como requisito central; caché como transparencia de replicación con su costo visible. |
| **3** · Comunicación y sincronización | Llamadas del agregador en paralelo con timeout y cancelación; bitácora de cada nodo de agencia sincronizada de forma asincrónica al nodo central. Si se llega a la Etapa 7, concurrencia real sobre el último recurso disponible. |
| **4** · Componentes y contratos | Interfaces `ProveedorDeVuelos` / `ProveedorDeHospedaje` con dos implementaciones intercambiables por variable de entorno. Contrato JSON del agregador definido por escrito **antes** de programar front o back. La baja de Amadeus a mitad de camino terminó siendo la prueba en vivo de que la abstracción servía. |
| **5** · Seguridad | Login real con contraseñas `scrypt` y sesión JWT propios (sin librerías de auth); roles y permisos granulares validados del lado del servidor; verificación de email simulada; credenciales del proveedor externo y de la base alojada como secretos de servidor, nunca en el front ni en el repositorio (`.env` gitignoreado). Auditoría de qué administrador modificó qué configuración y cuándo, consultable por API. |
| **6** · Patrones y escalabilidad | Circuit breaker y caché de última respuesta buena, implementados y verificados con pruebas automatizadas; idempotencia en reservas si se llega a esa etapa. |

### Estado al momento de esta entrega

**El núcleo completo (Etapas 1 a 6) está implementado y el sistema es
ejecutable de punta a punta**, bastante antes de lo que preveía el plan
original.

*Backend distribuido en tres nodos:* seis servicios independientes
—agregador, usuarios, vuelos, hospedaje, traslado y nodo-agencia—, cada
uno en su propio proceso y puerto. Los tres verticales de cómputo
siguen sin ninguna dependencia externa (`node:http` + `node:sqlite`,
los dos incluidos en Node). El nodo central sí depende de Postgres
(alojado en Supabase) y Redis. El agregador llama a los verticales en
paralelo, corta con `AbortController` según el presupuesto de cada
tramo, aplica circuit breaker y caché, y devuelve resultados parciales.

*Autenticación:* registro con verificación de email simulada, login
real con JWT, roles y permisos granulares de administrador, auditoría
de cambios de configuración. Búsqueda sin cuenta sigue funcionando
igual de bien — el login se ofrece, nunca se exige.

*Multi-agencia (marca blanca):* dos agencias sembradas (`ag-demo`,
`ag-sur`), cada una con su branding, su configuración de verticales y
su nodo de agencia propio, sincronizando a la misma base central.

*Frontend:* aplicación React sobre shadcn/ui, con buscador por solapas,
resultados diferenciados por lo que se pidió, perfil, panel de
administración y panel de simulación de fallos. Funciona conectado al
backend o solo, contra un servidor simulado que cumple el mismo
contrato.

*Contrato:* escrito antes que el código, con los cambios que impuso la
implementación anotados (`docs/contrato-agregador.md`).

*Contenedores:* `docker-compose.central.yml`, `docker-compose.workers.yml`
y `docker-compose.agencias.yml` simulan los tres nodos como servidores
físicamente separados, con una red compartida entre ellos.

*Pruebas automatizadas:* `npm test` verifica timeout, aislamiento y
cancelación en el front. `npm run test:back` corre contra el sistema
real — hoy contra Postgres en Supabase — y verifica, entre otras cosas,
el circuit breaker completo (3 fallos seguidos abren el circuito, el
cuarto no genera llamada de red), el flujo de login real de punta a
punta (registro → código → verificación → sesión), el aislamiento
multi-agencia, y que las llamadas en paralelo efectivamente ahorran
tiempo (2065 ms con dos verticales lentos, contra la suma que tardarían
en serie). Todas las pruebas están en verde.

Lo único que queda del plan original sin encarar es la **Etapa 7,
reservas con concurrencia real** — opcional, condicionada al tiempo que
quede tras cerrar la documentación y el ensayo de la defensa.

---

## Planificación

→ **`docs/gantt.png`** (adjunto)

| Etapa | Módulos | Previsto | Estado | Entregable |
|---|---|---|---|---|
| **E0** · Plan del proyecto | — | 01/09 – 07/09 | ✅ Hecho | Este documento + tag `v0-plan-del-proyecto` |
| **E1** · Cimientos y contrato | 1, 4 | 01/09 – 06/09 | ✅ Hecho | Contrato del agregador y front ejecutable |
| **E2** · Backend distribuido | 2, 3 | 01/09 – 06/09 | ✅ Hecho | Microservicios con base propia + agregador en paralelo |
| **E3** · Identidad y preferencias | 3, 5 | 07/09 – 27/09 | ✅ Hecho | Login real, roles, permisos, auditoría |
| **E4** · Proveedor externo | 4, 5 | 28/09 – 11/10 | ✅ Hecho | Interfaz con dos implementaciones (Amadeus cerró su portal a mitad de camino, sin impacto) |
| **E5** · Resiliencia y despliegue | 2, 6 | 12/10 – 15/11 | ✅ Hecho | Circuit breaker, caché, tres nodos con `docker compose` |
| **E6** · Administración | 6 | 16/11 – 29/11 | ✅ Hecho | Panel de admin con auditoría a la vista |
| | | **Núcleo** | **✅ Completo al 08/09** | **Sistema completo y defendible** |
| **E7** · Reservas *(opcional)* | 3, 6 | 30/11 – 20/12 | ⏳ Pendiente | Reservas con concurrencia real e idempotencia |

**Criterio de corte:** cada etapa deja algo demostrable por sí solo.
Como el núcleo cerró en la primera semana en vez de las trece
previstas, no hubo que recortar nada.

**Replanificación real:** el tiempo liberado por terminar E1–E6 tan
adelantados no se dejó ocioso — se reinvirtió en profundizar el núcleo
más allá de lo planeado en esta versión del documento: arquitectura de
tres nodos con marca blanca multi-agencia (no estaba en el alcance
original, que preveía un solo nodo), catálogo global de aeropuertos
(6071, dataset completo de OpenFlights, en vez del recorte inicial de
70), un vertical nuevo (Traslado, en vez de Seguros), búsqueda
diferenciada por solapa, migración del Postgres central a un proveedor
alojado (Supabase), y rediseño completo de interfaz sobre shadcn/ui.
Ese tiempo extra queda disponible para E7 o para profundizar la
documentación y el ensayo de la defensa.

---

## Actividades

| Etapa / Épica | Sprint | Estado | Tareas principales |
|---|---|---|---|
| **E0** · Plan del proyecto | **S0** · Arranque | ✅ | Definición de alcance, arquitectura e infografía. Armado del repositorio y del plan. |
| **E1** · Cimientos y contrato | **S1** · Cascarón | ✅ | Contrato JSON del agregador. Front con las pantallas y el modelo de tres estados. Panel de simulación de fallos. Prueba de humo de timeout y aislamiento. |
| **E2** · Backend distribuido | **S2** · Microservicios | ✅ | Servicios de vuelos, hospedaje y usuarios, cada uno con su base y su semilla. Interfaz de proveedor con dos implementaciones. Agregador con llamadas en paralelo, timeouts y respuesta parcial. |
| **E3** · Identidad y preferencias | **S3** · Sesión y perfil | ✅ | Registro y login real con JWT y `scrypt`. Verificación de email simulada. Roles y permisos granulares de administrador validados en el servidor. Auditoría de configuración. |
| **E4** · Proveedor externo | **S4** · Proveedor | ✅ | Implementación contra Amadeus (OAuth2, mapeo al contrato) detrás de la interfaz existente. Evaluación de alternativas tras el cierre del portal de Amadeus. Catálogo global de referencia (OpenFlights completo). |
| **E5** · Resiliencia y despliegue | **S5** · Breaker y caché | ✅ | Circuit breaker en el agregador. Caché de la última respuesta buena, gateada al circuito abierto (no a cualquier fallo aislado). |
| | **S6** · Contenedores y multi-nodo | ✅ | `docker compose` por nodo (central / cómputo / agencia). Migración del Postgres central a Supabase. Nodo de agencia con bitácora local y sync al central. Vertical Traslado. Búsqueda diferenciada por solapa. |
| **E6** · Administración | **S7** · Panel de admin | ✅ | Tablero de preferencias agregadas, gestión de administradores y sus permisos, registro de auditoría a la vista. Rediseño de interfaz sobre shadcn/ui. |
| **E7** · Reservas *(opcional)* | **S8** · Reservas | ⏳ | Reserva de asiento o habitación con control de concurrencia e idempotencia. |

---

## Participación

### Integrantes

| | Nombre y apellido | Legajo | Correo |
|---|---|---|---|
| **A** | ⟨completar⟩ | ⟨completar⟩ | ⟨completar⟩ |
| **B** | ⟨completar⟩ | ⟨completar⟩ | ⟨completar⟩ |

> No tengo forma de saber si el proyecto es individual o en equipo, ni
> quiénes lo integran — hay que completar esta tabla (o borrar la fila
> B si es individual) antes de entregar.

### Reparto del trabajo

El reparto sigue el corte natural del sistema: un camino va del
navegador al agregador, el otro del agregador a las fuentes de datos y
la infraestructura. El contrato JSON del agregador —definido antes de
escribir código— es lo que permite avanzar en paralelo sin bloquearse:
cada parte programa contra el contrato, no contra lo que la otra esté
escribiendo. Si el proyecto termina siendo individual, esta misma
división describe el orden en que se fue encarando el trabajo.

**Cliente y orquestación**

- Aplicación React sobre shadcn/ui: buscador por solapas, resultados
  diferenciados, perfil, panel de administración.
- Modelo de tres estados y su implementación en el front.
- Servicio agregador: llamadas en paralelo, timeouts con
  `AbortController`, sesión (JWT), circuit breaker y caché.
- Panel de simulación de fallos y guion de la demostración.

**Servicios, datos e infraestructura**

- Microservicios de vuelos, hospedaje y traslado: endpoints, bases
  propias y generación del catálogo global de referencia (OpenFlights).
- Interfaz `ProveedorDeX` y sus dos implementaciones; integración con
  Amadeus (OAuth2, mapeo al contrato).
- Servicio de usuarios: registro, login real, roles, permisos,
  auditoría.
- Arquitectura de tres nodos, `docker compose` por nodo, nodo de
  agencia, migración del Postgres central a Supabase.
- Gestión de secretos (`.env` gitignoreado) y auditoría de cambios de
  configuración (Módulo 5).

**Compartido**

- Contrato del agregador y decisiones de arquitectura.
- Documentación en las cuatro vistas de Kruchten.
- Revisión cruzada de código antes de integrar.
- Ensayo y presentación de la demostración final.

---

## Repositorio y tag *(pendiente, no es un campo de la plantilla)*

```bash
cd ~/Desktop/gestor-viajes
git tag -a v0-plan-del-proyecto -m "Entrega 0 - Plan de proyecto"
# y, si el grupo usa un remoto:
# git remote add origin <url>
# git push -u origin main --follow-tags
```

El repositorio ya está inicializado y con historial (`git log`).
`.gitignore` excluye `node_modules`, `dist`, las bases de datos locales
de cada microservicio y `.env` (donde viven las credenciales reales de
Supabase — nunca se commitea; `.env.example` es la plantilla sin
secretos que sí queda versionada).
