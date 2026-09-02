# Entrega 0 — Plan de proyecto

Contenido para volcar en la plantilla de certificación. Cada título de
acá abajo corresponde a un campo de la plantilla, en el mismo orden.

> **⟨…⟩ = dato que falta y no puedo completar yo.** Son cinco: número de
> grupo, entidad asociada y los datos de los dos integrantes.

**Imágenes adjuntas** (en `docs/`):
`infografia.png` · `gantt.png` · `capturas/1-portada.png` ·
`capturas/2-resultados-ok.png` · `capturas/3-hospedaje-caido.png` ·
`capturas/4-vuelos-colgado.png` · `capturas/5-perfil.png` ·
`capturas/6-admin.png`

**Pendiente antes de entregar:** el repositorio todavía no está bajo
control de versiones, y la plantilla pide un tag. Ver "Repositorio y
tag" al final.

---

## Datos generales

| Campo | Valor |
|---|---|
| **Grupo N°** | ⟨completar⟩ |
| **Tag / Release de esta entrega** | `v0-plan-del-proyecto` |
| **Fecha de entrega** | 07/09/2026 |

---

## Proyecto

**Área:** Turismo — comercio electrónico de servicios de viaje.

**Empresa o entidad asociada:** ⟨ninguna: proyecto académico / completar
si corresponde⟩

**Título:** Gestor de viajes — buscador multivertical con tolerancia a
fallos parciales.

**Dominio:** Búsqueda y consulta de disponibilidad de servicios de viaje
(vuelos y hospedaje), con datos provistos por una API externa de la
industria y una base propia de respaldo.

### Breve descripción (1 párrafo)

Un buscador de viajes estilo Booking.com que consulta vuelos y hospedaje
en paralelo y muestra los resultados en una sola pantalla. Lo que
distingue al proyecto no es el buscador sino su comportamiento ante
fallos: el sistema está construido como microservicios independientes
coordinados por un agregador, de modo que la caída de cualquiera de ellos
degrada únicamente su propia sección de la pantalla y deja el resto
funcionando. Cada vertical obtiene sus datos a través de una interfaz con
dos implementaciones intercambiables —la API real de Amadeus y una base
propia con datos ficticios— seleccionables por configuración, lo que
permite demostrar el sistema sin depender de la red ni de la cuota del
proveedor externo.

---

## Infografía

→ **`docs/infografia.png`** (adjunto)

Muestra la arquitectura completa en el escenario de fallo: navegador con
una sección por vertical, agregador, microservicios, la interfaz de
proveedor con sus dos implementaciones y las fuentes de datos. Incluye
los tres estados, el presupuesto de tiempo por capa y el guion de la
demostración.

---

## Descripción

### El problema

Un buscador de viajes depende de varias fuentes de datos que no controla:
proveedores de vuelos, de hospedaje, de autos. En la mayoría de las
implementaciones ingenuas, la pantalla espera a que **todas** respondan
antes de mostrar algo. Alcanza con que una sola se caiga —o peor, que
quede colgada sin responder— para que el usuario vea una pantalla en
blanco, un error genérico o una espera indefinida, aunque el 80 % de la
información que pidió ya esté disponible.

El proyecto toma ese problema como requisito central de diseño, no como
un detalle de manejo de errores a resolver al final.

### Qué hace el sistema

El usuario ingresa origen, destino, fechas y cantidad de pasajeros. El
sistema devuelve, en una misma pantalla y en secciones separadas, los
vuelos y los alojamientos disponibles para esa búsqueda. Puede además
indicar en su perfil qué verticales le interesan, y un administrador
puede habilitar o deshabilitar verticales para todos los usuarios.

### Arquitectura

Cuatro microservicios independientes, cada uno con su propia base:

- **Vuelos** — disponibilidad y precios de pasajes aéreos.
- **Hospedaje** — disponibilidad y precios de alojamiento.
- **Usuarios / Perfil** — autenticación, roles y preferencias de
  verticales. Las preferencias viven acá y no en un servicio aparte: el
  dato es liviano y el servicio ya iba a existir por el login.
- **Agregador** — recibe la búsqueda, decide a qué verticales llamar
  según las preferencias del usuario y la configuración del
  administrador, los llama **en paralelo** y arma la respuesta con lo que
  haya llegado a tiempo.

El cliente es una SPA en React que renderiza una sección por vertical.
Cada sección hace su propio pedido al agregador, de manera que su ciclo
de vida es independiente del de las demás.

### Cómo se consigue la tolerancia a fallos

Cinco mecanismos, en orden de importancia:

1. **Llamadas en paralelo.** El agregador nunca consulta los verticales
   en serie. El tiempo total de una búsqueda es el del vertical más lento,
   no la suma de todos.

2. **Timeout por vertical con `AbortController`.** Presupuesto de 3000 ms
   entre el front y el agregador, 2500 ms entre el agregador y cada
   vertical, 1800 ms entre un vertical y Amadeus. Cada capa se corta
   antes que la de arriba. El corte se hace con `AbortController` y no
   con `Promise.race`: `race` deja la conexión abierta consumiendo un
   socket, `abort` la cancela de verdad. Sin esto, un servicio *colgado*
   —que acepta la conexión y nunca responde— deja la búsqueda esperando
   indefinidamente, que es peor que un error limpio.

3. **Modelo de tres estados.** Cada vertical está siempre en exactamente
   uno de `loading`, `ok` o `unavailable`. El enum es el mismo en el front
   y en el back. La sección `unavailable` muestra un aviso dentro de su
   propia caja y declara explícitamente que el resto de la búsqueda no se
   vio afectado.

4. **Circuit breaker.** Si un vertical falla N veces seguidas, el
   agregador deja de esperarlo durante un período y responde directamente
   sin él. Evita pagar el timeout completo en cada búsqueda mientras el
   servicio está caído.

5. **Caché de la última respuesta buena.** Si un vertical no responde
   pero hay resultados de una búsqueda reciente, se muestran con un aviso
   explícito de su antigüedad ("datos de hace 4 minutos"). Es
   transparencia de replicación con su costo —datos potencialmente
   desactualizados— hecho visible a propósito en vez de escondido.

### Preferencias en dos capas

**Capa del usuario.** Al registrarse responde una encuesta simple
(casillas: vuelos, hospedaje) que después puede editar en su perfil. El
agregador no consulta los verticales que el usuario no quiere ver. El
efecto secundario es interesante: personalización y resiliencia terminan
usando el mismo mecanismo, porque un vertical que no se llama es un
vertical que no puede fallarle a ese usuario.

**Capa del administrador.** Un panel muestra las preferencias agregadas
de todos los usuarios y permite forzar el apagado global de un vertical
—por ejemplo, si su fuente de datos quedó desactualizada—. El agregador
consulta esa configuración antes de llamar a cada servicio.

Decisión de diseño: la sección "no disponible" que ve un usuario cuando
un servicio se cae solo y la que ve cuando el administrador lo apagó a
mano son **el mismo componente**. Cambia el motivo, no la pantalla. No
son dos funcionalidades parecidas: es una sola con un parámetro.

### Fuente de datos

Cada vertical define una interfaz propia —`ProveedorDeVuelos`,
`ProveedorDeHospedaje`— con implementaciones intercambiables por
configuración: una que lee de la base propia del servicio y otra que
consume una API externa.

**Nota sobre Amadeus.** El plan original usaba su tier Self-Service
gratuito. Ese portal fue dado de baja el **17 de julio de 2026**: las
claves existentes quedaron deshabilitadas y no se admiten registros
nuevos. Lo que queda en pie es Amadeus Enterprise, que es un contrato
comercial fuera del alcance de un proyecto de cátedra.

El sistema no se vio afectado, y ese es justamente el argumento: nunca
dependió de Amadeus, sino de una interfaz. El proveedor externo
desapareció en medio del proyecto y no hubo que tocar el agregador, ni el
front, ni el contrato, ni las bases. La implementación contra Amadeus
queda escrita en el repositorio como segunda implementación de la
interfaz y como plantilla para el proveedor que se elija.

**Qué se hizo en su lugar.** Las bases propias se siembran con datos de
referencia reales: aeropuertos, ciudades, aerolíneas y rutas salen de
OpenFlights, un dataset abierto bajo licencia ODbL (70 aeropuertos, 30
aerolíneas, 255 rutas con origen en Argentina, 22 países). Las distancias
se calculan de las coordenadas y las duraciones de las distancias.

Lo que se simula son los horarios, la disponibilidad y los precios — que
es precisamente el dato que un GDS cobra por dar y el único que aportaría
un proveedor externo. Que Iberia, Aerolíneas Argentinas y Air Europa
vuelen Ezeiza–Madrid es verificable; el precio del pasaje del 12 de
octubre, no.

El buscador ofrece únicamente rutas que existen: de las 36 × 70
combinaciones posibles de origen y destino sólo 255 son reales. Origen y
destino se escriben con sugerencias —por ciudad, país o código IATA,
sin depender de acentos— y las del destino se limitan a los aeropuertos
con vuelo directo desde el origen elegido.

Las alternativas vigentes con capa gratuita están evaluadas en
`docs/proveedor-externo.md`.

Esto cumple tres funciones a la vez: permite demostrar el sistema sin
depender de internet ni de la cuota de un proveedor, aísla el mapeo de
datos externos dentro de un solo archivo, y es en sí mismo el contenido
del Módulo 4 —programar contra una abstracción, con el contrato definido
antes que la implementación—.

### Cómo se demuestra

El escenario de aceptación es una demostración en vivo:

1. Se lanza una búsqueda normal. Vuelos y hospedaje responden en paralelo
   en menos de un segundo.
2. Se apaga el contenedor de hospedaje (`docker stop`) delante del
   evaluador y se repite la búsqueda.
3. Vuelos aparece a los ~600 ms. Hospedaje pasa a "no disponible" al
   vencer su timeout, **dentro de su sección**. Ningún otro elemento de
   la pantalla cambia.
4. Se vuelve a levantar el contenedor y la sección se recupera sola en la
   búsqueda siguiente.

Un quinto caso no se puede reproducir apagando un contenedor: el servicio
*colgado*, que acepta la conexión y nunca contesta. Es justamente el que
voltea a los sistemas sin timeout, y se simula desde un panel de fallos
incluido en la aplicación.

### Alcance

**Dentro:** vuelos, hospedaje, usuarios con roles, agregador,
preferencias en dos capas, panel de administración, tolerancia a fallos
parciales completa y despliegue en contenedores.

**Fuera del núcleo:** autos y cruceros. No se descartan por dificultad
sino por tiempo: como el vertical está armado como un patrón —una
interfaz, un fetcher y una entrada en un registro— sumarlos después es
agregar código nuevo, no rehacer el existente.

**Condicionado al tiempo disponible:** el módulo de reservas con
concurrencia real (dos usuarios compitiendo por el último asiento o la
última habitación). Es la Etapa 7 y sólo se encara si las seis anteriores
están cerradas.

### Mapeo a los módulos de la materia

| Módulo | Cómo lo cubre este proyecto |
|---|---|
| **1** · Vistas 4+1 de Kruchten | El sistema documentado en las cuatro vistas, validadas con un único escenario: *"el usuario busca un viaje mientras el servicio de hospedaje está caído"*. Ese caso atraviesa la vista lógica (los tres estados), la de desarrollo (interfaz y contrato), la de procesos (llamadas en paralelo con timeout) y la física (contenedores separados). |
| **2** · Arquitectura de infraestructura | Microservicios con base propia por servicio; fallos parciales como requisito central; caché como transparencia de replicación con su costo visible. |
| **3** · Comunicación y sincronización | Llamadas del agregador en paralelo con timeout y cancelación. Si se llega a la Etapa 7, concurrencia real sobre el último recurso disponible. |
| **4** · Componentes y contratos | Interfaz `ProveedorDeVuelos` / `ProveedorDeHospedaje` con dos implementaciones intercambiables por variable de entorno. Contrato JSON del agregador definido por escrito **antes** de programar front o back, para que los dos integrantes puedan avanzar en paralelo. La baja de Amadeus a mitad de camino terminó siendo la prueba de que la abstracción servía. |
| **5** · Seguridad | Credenciales del proveedor externo como secreto de servidor, nunca en el front ni en el repositorio. Roles usuario/admin validados del lado del servidor. Auditoría de qué administrador modificó qué configuración y cuándo: **ya implementada**, se registra en la base de usuarios y se consulta por API. |
| **6** · Patrones y escalabilidad | Circuit breaker, caché, e idempotencia en reservas si se llega a esa etapa. |

### Estado al momento de esta entrega

**Las etapas 1 y 2 están completas y el sistema es ejecutable de punta a
punta.**

*Backend distribuido:* cuatro microservicios independientes —vuelos,
hospedaje, usuarios y el agregador—, cada uno en su propio proceso, con
su propio puerto y su propia base SQLite (510 itinerarios sobre 70
aeropuertos reales, 560 alojamientos en 69 ciudades, 128 usuarios). Ningún servicio puede leer la
base de otro: si necesita un dato ajeno lo pide por HTTP. El agregador
llama a los verticales en paralelo, corta a los 2500 ms con
`AbortController` y devuelve resultados parciales. Cero dependencias
externas: usa el `node:http` y el `node:sqlite` que trae Node.

*Frontend:* aplicación React con buscador, resultados por vertical,
perfil con encuesta de preferencias, panel de administración y panel de
simulación de fallos. Funciona conectado al backend o solo, contra un
servidor simulado que cumple el mismo contrato; los componentes son los
mismos en los dos casos.

*Contrato:* escrito antes que el código y ya en su versión 2, con los
cambios que impuso la implementación anotados
(`docs/contrato-agregador.md`).

*Pruebas automatizadas:* `npm test` verifica el timeout, el aislamiento y
la cancelación en el front. `npm run test:back` los verifica contra el
sistema real y mide los tiempos: con los dos verticales lentos la
búsqueda tarda **1810 ms en vez de los 3600 ms que tardaría en serie**,
que es la prueba de que las llamadas son paralelas.

*Lo verificado a mano:* apagar el proceso de hospedaje deja la búsqueda
de vuelos intacta; apagar además el de usuarios tampoco la voltea, porque
el agregador falla abierto; al volver a levantarlos, el sistema se
recupera solo en la búsqueda siguiente.

Falta lo de las etapas 3 en adelante: login real con token —hoy el
usuario viaja en una cabecera en la que el backend confía—, el proveedor
externo, el circuit breaker, la caché y los contenedores.

Capturas de la aplicación tal como está hoy:

| Archivo | Qué muestra |
|---|---|
| `capturas/1-portada.png` | Buscador inicial |
| `capturas/2-resultados-ok.png` | Búsqueda completa: los dos verticales responden |
| `capturas/3-hospedaje-caido.png` | **Hospedaje devuelve 503; vuelos sigue mostrando sus 8 resultados** |
| `capturas/4-vuelos-colgado.png` | **Vuelos queda colgado y lo corta el timeout; hospedaje no se entera** |
| `capturas/5-perfil.png` | Encuesta de preferencias |
| `capturas/6-admin.png` | Toggles por servicio y preferencias agregadas |
| `capturas/7-apagado-por-admin.png` | Hospedaje apagado por el administrador: la sección se colapsa con su motivo |
| `capturas/8-buscador-sugerencias.png` | Sugerencias de lugar: escribir «esp» trae los aeropuertos de España con vuelo directo |

Todas están tomadas contra el sistema real, con el backend andando.
Apagar el proceso de hospedaje produce exactamente la misma pantalla que
la captura 3 — y eso no es una casualidad, es la decisión de diseño de
usar un solo componente para todos los motivos de "no disponible".

Las dos en negrita son la evidencia del requisito central: en las dos, la
mitad de la pantalla que no falló quedó intacta.

---

## Planificación

→ **`docs/gantt.png`** (adjunto)

| Etapa | Módulos | Desde | Hasta | Sem. | Entregable |
|---|---|---|---|---|---|
| **E0** · Plan del proyecto | — | 01/09 | 07/09 | 1 | Este documento + tag `v0-plan-del-proyecto` |
| **E1** · Cimientos y contrato ✓ | 1, 4 | 01/09 | 06/09 | 1 | **Hecho.** Contrato del agregador y front ejecutable |
| **E2** · Backend distribuido ✓ | 2, 3 | 01/09 | 06/09 | 1 | **Hecho.** Cuatro microservicios con base propia + agregador en paralelo con timeouts |
| **E3** · Identidad y preferencias | 3, 5 | 07/09 | 27/09 | 3 | Login con token, roles validados en el servidor, auditoría a la vista |
| **E4** · Proveedor externo | 4, 5 | 28/09 | 11/10 | 2 | Nueva fuente de datos detrás de la interfaz existente |
| **E5** · Resiliencia y despliegue | 2, 6 | 12/10 | 15/11 | 5 | Circuit breaker, caché, `docker compose` y demostración de apagado en vivo |
| **E6** · Administración | 6 | 16/11 | 29/11 | 2 | Tablero de preferencias agregadas y registro de auditoría |
| | | | **Núcleo** | **13** | **Sistema completo y defendible** |
| **E7** · Reservas *(opcional)* | 3, 6 | 30/11 | 20/12 | 3 | Reservas con concurrencia real e idempotencia |

**Criterio de corte:** cada etapa deja algo demostrable por sí solo. Si el
calendario se estira, se recorta desde el final —E7 primero, después
E6— sin que quede un sistema a medio hacer.

**Replanificación:** las etapas 1 y 2 se completaron en la primera
semana, bastante antes de lo previsto. Las semanas que quedaron libres no
se recortan del calendario: se reinvierten en la etapa 5 —circuit
breaker, caché y contenedores—, que pasa de 2 a 5 semanas por ser la que
concentra el requisito central de la materia.

---

## Actividades

| Etapa / Épica | Sprint | Período | Tareas principales |
|---|---|---|---|
| **E0** · Plan del proyecto | **S0** · Arranque | 01/09 – 06/09 | Definición de alcance, arquitectura e infografía. Armado del repositorio y del plan. |
| **E1** · Cimientos y contrato ✓ | **S1** · Cascarón | 01/09 – 06/09 | Contrato JSON del agregador. Front con las cuatro pantallas y el modelo de tres estados. Panel de simulación de fallos. Prueba de humo de timeout y aislamiento. |
| **E2** · Backend distribuido ✓ | **S2** · Microservicios | 01/09 – 06/09 | Servicios de vuelos, hospedaje y usuarios, cada uno con su base SQLite y su semilla. Interfaz de proveedor con dos implementaciones. Agregador con llamadas en paralelo, timeouts y respuesta parcial. Front conectado. Auditoría de configuración. |
| **E3** · Identidad y preferencias | **S3** · Sesión y perfil | 07/09 – 27/09 | Registro y login con token. Validación de rol en el servidor y no sólo en el front. Documentación en las cuatro vistas de Kruchten. |
| **E4** · Proveedor externo | **S4** · Proveedor | 28/09 – 11/10 | Elección de la fuente externa entre las alternativas evaluadas. Implementación detrás de la interfaz existente, con vuelta al proveedor ficticio por configuración. |
| **E5** · Resiliencia y despliegue | **S5** · Breaker y caché | 12/10 – 01/11 | Circuit breaker en el agregador. Caché de la última respuesta buena, con su antigüedad a la vista. |
| | **S6** · Contenedores | 02/11 – 15/11 | `docker compose` con un contenedor por servicio. Ensayo de la demostración de apagado en vivo. |
| **E6** · Administración | **S7** · Panel de admin | 16/11 – 29/11 | Tablero de preferencias agregadas y registro de auditoría a la vista. |
| **E7** · Reservas *(opcional)* | **S8** · Reservas | 30/11 – 20/12 | Reserva de asiento o habitación con control de concurrencia e idempotencia. |

---

## Participación

### Integrantes

| | Nombre y apellido | Legajo | Correo |
|---|---|---|---|
| **A** | ⟨completar⟩ | ⟨completar⟩ | ⟨completar⟩ |
| **B** | ⟨completar⟩ | ⟨completar⟩ | ⟨completar⟩ |

### Reparto del trabajo

El reparto sigue el corte natural del sistema: un integrante toma el
camino que va del navegador al agregador, el otro el que va del agregador
a las fuentes de datos. El contrato JSON del agregador —definido en la
Etapa 1, antes de escribir código— es lo que permite que ambos avancen en
paralelo sin bloquearse: cada uno programa contra el contrato, no contra
lo que el otro esté escribiendo.

**Integrante A — Cliente y orquestación**

- Aplicación React: buscador, pantalla de resultados, perfil y panel de
  administración.
- Modelo de tres estados y su implementación en el front.
- Servicio agregador: llamadas en paralelo, timeouts con
  `AbortController`, armado de la respuesta parcial.
- Circuit breaker y caché de última respuesta buena.
- Panel de simulación de fallos y guion de la demostración.

**Integrante B — Servicios y datos**

- Microservicios de vuelos y hospedaje: endpoints, bases propias y carga
  de datos ficticios.
- Interfaz `ProveedorDeX` y sus dos implementaciones. Integración con
  Amadeus, manejo del token OAuth2 y mapeo al contrato.
- Servicio de usuarios: registro, login, roles, preferencias.
- Gestión de secretos y auditoría de cambios de configuración
  (Módulo 5).
- `docker compose` y puesta en marcha del entorno de demostración.

**Compartido entre los dos**

- Contrato del agregador y decisiones de arquitectura.
- Documentación en las cuatro vistas de Kruchten.
- Revisión cruzada de código: cada uno revisa lo que escribió el otro
  antes de integrar, así ninguna parte del sistema queda conocida por una
  sola persona de cara a la defensa.
- Ensayo y presentación de la demostración final.


---

## Repositorio y tag *(pendiente, no es un campo de la plantilla)*

La plantilla pide un **Tag / Release** y la carpeta del proyecto todavía
no es un repositorio git. Antes de entregar hay que hacer:

```bash
cd ~/Desktop/gestor-viajes
git init -b main
git add -A
git commit -m "Entrega 0: plan de proyecto y front cascarón (Fase 0-1)"
git tag -a v0-plan-del-proyecto -m "Entrega 0 - Plan del proyecto"
# y, si el grupo usa un remoto:
# git remote add origin <url>
# git push -u origin main --follow-tags
```

`.gitignore` ya está en el proyecto y excluye `node_modules` y `dist`.
