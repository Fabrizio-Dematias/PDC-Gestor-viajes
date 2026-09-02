# Gestor de viajes

Buscador estilo Booking (vuelos + hospedaje) cuyo requisito central es la
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
| Agregador | 4000 | — | no guarda nada |
| Vuelos | 4001 | `vuelos.db` | 70 aeropuertos, 510 itinerarios |
| Hospedaje | 4002 | `hospedaje.db` | 560 alojamientos en 69 ciudades |
| Usuarios | 4003 | `usuarios.db` | 128 usuarios, preferencias, auditoría |

El backend **no tiene dependencias**: usa `node:http` y el `node:sqlite`
que viene con Node 22+. Las bases se crean y se siembran solas la
primera vez que arranca cada servicio.

### De dónde salen los datos

Los aeropuertos, las ciudades, las aerolíneas y **qué aerolínea vuela qué
ruta** son reales: un subconjunto de [OpenFlights](https://openflights.org/data.html)
versionado en `servidor/datos-referencia/` (70 aeropuertos, 30
aerolíneas, 255 rutas con origen en Argentina, 22 países). Las distancias
salen de las coordenadas y las duraciones de las distancias.

Lo simulado son **los horarios, la disponibilidad y los precios** — que
es exactamente lo que cobra un GDS y lo que daría el proveedor externo.
El detalle y la atribución están en `servidor/datos-referencia/FUENTE.md`.

Consecuencia práctica: el buscador sólo ofrece rutas que existen. De las
36 × 70 combinaciones posibles de origen y destino, sólo 255 son reales.

Origen y destino se eligen escribiendo, no de una lista desplegable: dos
o tres letras de una ciudad, un país o un código IATA alcanzan
(`cordoba`, `Córdoba`, `esp` y `ez` funcionan igual). Las sugerencias del
destino salen sólo de los aeropuertos con vuelo directo desde el origen
elegido, y si hay coincidencias fuera de ese conjunto la lista lo dice en
vez de esconderlas. El catálogo lo sirve `GET /api/lugares`.

## Arrancar

```bash
npm install

# Sistema completo (recomendado)
npm run back       # los cuatro servicios
npm run dev:back   # front conectado, en http://localhost:5173

# Sólo el front, contra el servidor simulado
npm run dev

# Pruebas
npm test           # tolerancia a fallos en el front (no necesita backend)
npm run test:back  # aislamiento, timeout y paralelismo en el backend real
npm run build
```

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

## Mapa del código

```
docs/
  contrato-agregador.md      El contrato, escrito antes que el código
  proveedor-externo.md       Qué pasó con Amadeus y qué opciones quedan

servidor/                    Backend, cero dependencias
  datos-referencia/          Aeropuertos, aerolíneas y rutas reales (OpenFlights)
  comun/
    http.js                  Servidor HTTP compartido por los 4 servicios
    base.js                  Apertura de la base propia de cada uno
    pedir.js                 Llamadas entre servicios, con AbortController
    amadeus.js               OAuth2 (escrito, sin probar — ver docs)
    salud-demo.js            Interruptor de fallos por servicio
  vuelos/, hospedaje/
    index.js                 El servicio
    proveedor.js             LA INTERFAZ + selector por variable de entorno
    proveedor-ficticio.js    Implementación contra la base propia
    proveedor-amadeus.js     Implementación contra la API real
    datos.js                 Esquema y semilla
  usuarios/                  Perfil, preferencias, config de admin, auditoría
  agregador/index.js         Paralelo, timeout, resultados parciales
  arrancar.mjs, matar.mjs

src/
  api/
    cliente.js               ÚNICO punto que sabe hablar con el agregador.
                             AbortController + timeout viven acá.
    vuelos.js, hospedaje.js  Un fetcher por vertical
    perfil.js                Perfil y config de admin
    mock/
      servidor.js            Stand-in del agregador. Cumple el contrato.
      caos.js                Estado de salud simulado por vertical
      datos/                 Datos ficticios (el "proveedor base propia")
  dominio/
    estados.js               loading / ok / unavailable + motivos
    errores.js               ServicioNoDisponible
    verticales.jsx           EL registro. Sumar un vertical = una entrada.
  hooks/
    useBusquedaVertical.js   Donde vive el modelo de tres estados
  components/
    BuscadorLugar.jsx        Campo de lugar con sugerencias
    resultados/              SeccionResultados = el límite del fallo
    perfil/, admin/, demo/
  pages/                     Home, Resultados, Perfil, Admin
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
| 3 | Login real con token. Hoy el usuario viaja en la cabecera `x-usuario-id` y el backend confía en ella: **no es autenticación** |
| 4 | Proveedor externo. Amadeus Self-Service cerró en julio de 2026; ver `docs/proveedor-externo.md` |
| 5 | Circuit breaker, caché del lado del servidor y `docker compose` |
| 6 | Panel de admin: ya lee y escribe contra el backend; falta mostrar la auditoría |
| 7 | Reservas con concurrencia (opcional) |

La auditoría de cambios de configuración (Módulo 5) ya está: se registra
en `usuarios.db` y se consulta en `GET /api/admin/auditoria`.
