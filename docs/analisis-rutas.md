# Análisis de rutas y revisión del proyecto

Qué se pidió: que de Buenos Aires a Madrid "no se puede" buscar un vuelo,
que algunos pares de aeropuertos no se podían buscar, y revisar todas las
rutas que deberían poder buscarse —vuelos y hospedaje— y el resto del
proyecto en busca de errores.

Este documento deja asentado **qué se encontró, por qué y qué se
cambió**. Las cifras de la red y de la cobertura se midieron con
scripts puntuales durante la revisión (no están versionados en el
repo); las de la búsqueda por HTTP se pueden comprobar con
`npm run test:back`.

---

## 1. El síntoma, y por qué pasaba

En el buscador de vuelos, elegir "Buenos Aires" como origen y "Madrid"
como destino no dejaba buscar: el botón quedaba deshabilitado. Con otras
elecciones del mismo origen sí andaba. Eran **tres defectos juntos**:

1. **Se elegía un aeropuerto, no una ciudad.** Buenos Aires aparecía
   dos veces con el mismo nombre —Ezeiza y Aeroparque— y la primera era
   Aeroparque. De Aeroparque no sale ningún vuelo directo a Madrid (los
   intercontinentales salen de Ezeiza), así que Madrid no figuraba entre
   los destinos posibles.
2. **Sólo se ofrecían destinos con vuelo directo.** Los destinos se
   calculaban a partir de las rutas del dataset, y nada más: si no había
   un vuelo directo del aeropuerto elegido, el destino no existía. Con
   las rutas reales de OpenFlights eso deja afuera casi todo (sección 2).
3. **Quien viaja desde una ciudad chica no llegaba a ningún lado.** Los
   aeropuertos provinciales (Tucumán, Salta, Bariloche…) sólo conectan
   con Buenos Aires, y con Aeroparque, no con Ezeiza. Aun admitiendo
   escalas, Tucumán → Madrid exige bajar en Aeroparque, ir hasta Ezeiza y
   volar desde ahí: una conexión entre dos aeropuertos distintos de la
   misma ciudad, que el modelo no sabía representar.

El tercero no se veía hasta arreglar los dos primeros: sin él, el 53 %
de las búsquedas desde una ciudad argentina hacia las 100 ciudades más
conectadas del mundo seguía sin resultados.

## 2. La red en números

Los aeropuertos, las aerolíneas y qué aerolínea vuela qué ruta son los
reales de [OpenFlights](https://openflights.org/data.html) (2014); lo
simulado son los horarios, la disponibilidad y los precios. De ahí:

| | |
|---|---:|
| Aeropuertos en el dataset | 6.071 |
| …con vuelos de salida | 3.130 |
| …sin ninguna ruta | 2.929 |
| Ciudades (aeropuertos agrupados, sección 4) | 5.814 |
| Ciudades con vuelos | 3.082 |
| Ciudades con más de un aeropuerto | 194 |
| Rutas directas distintas (origen → destino) | 36.383 |

Y qué parte de todos los pares posibles (aeropuerto con salidas ×
aeropuerto con llegadas, ~9,8 millones) se cubre según cuántas escalas se
admiten:

| Se admite | Pares cubiertos | % |
|---|---:|---:|
| Sólo vuelo directo | 36.383 | 0,4 % |
| Hasta 1 escala | 644.125 | 6,6 % |
| Hasta 2 escalas | 3.485.861 | 35,6 % |

**Esto explica el error original.** Filtrar por vuelo directo dejaba
afuera el 99,6 % de los pares. Y el 35,6 % de los pares con dos escalas
no contradice que "todo se pueda buscar": la cuenta es sobre *aeropuertos*,
incluidos miles de aeródromos regionales a los que casi nadie viaja desde
Buenos Aires con papel y lápiz en la mano; lo que importa es lo de la
sección 5, ciudades que la gente de verdad busca.

## 3. Qué rutas "deberían poder buscarse"

El criterio que se adoptó, por vertical:

| Vertical | Criterio | Por qué |
|---|---|---|
| **Vuelos** | Cualquier par de lugares (ciudad o aeropuerto) unido por un recorrido de **hasta dos escalas** en la red real. Si no existe, la respuesta es vacía —ni error ni vuelo inventado. | Con más de dos escalas el viaje deja de ser razonable, y el espacio de búsqueda crece de 10² a 10⁴ recorridos por consulta. |
| **Hospedaje** | **Cualquier ciudad** o aeropuerto del catálogo (6.089 códigos), exista o no un vuelo a ella. | Alojarse no depende de que haya una ruta aérea. Se aloja uno en la ciudad: Torrejón (sin vuelos) resuelve a Madrid. |
| **Traslado** | Igual: cualquier ciudad o aeropuerto. | Un traslado es terrestre. |

Medido contra los servicios levantados: **los 6.089 códigos** (las 5.814
ciudades más los aeropuertos cuyo código difiere del de su ciudad)
devuelven alojamientos y devuelven opciones de traslado.

## 4. Qué se cambió

### Un *lugar* es una ciudad o un aeropuerto

`servidor/datos-referencia/ciudades.mjs` agrupa los 6.071 aeropuertos en
5.814 ciudades: mismo país, mismo nombre y a menos de 120 km. El límite
de distancia importa: hay 98 nombres de ciudad repetidos en países
distintos (Hamilton existe en cuatro) y 66 grupos "mismo nombre, mismo
país" cuyos aeropuertos están a más de 120 km entre sí, a veces a miles
(Deer Lake, en Canadá, tiene dos a 2.570 km: son localidades distintas
con el mismo nombre). Para las 18 ciudades con código metropolitano oficial de IATA
(`BUE`, `LON`, `NYC`, `PAR`…) se usa ése, que además es el que entiende
Duffel: verificado contra su API, `BUE → MAD` devuelve en una sola
búsqueda las ofertas de Ezeiza y de Aeroparque.

Los nombres de las ciudades principales están en español (París, Roma,
Milán, Estambul, Neuquén, Tucumán, Puerto Iguazú…) y ordenados por tráfico
para que "sa" ofrezca Santiago antes que una localidad con dos vuelos por
semana. Detalle del contrato en `docs/contrato-agregador.md` §13.

### Búsqueda con escalas

`servidor/vuelos/proveedor-ficticio.js` arma itinerarios de **una y dos
escalas** sobre las rutas reales:

- Los recorridos candidatos salen del grafo de rutas, ordenados por
  distancia total, descartando rodeos absurdos (un vuelo corto puede
  pasar por un hub lejano; uno largo no).
- Cada recorrido se convierte en **horarios que cierran**: se toma la
  primera salida del tramo siguiente que respete la conexión mínima (90
  min dentro de un país, 120 entre países) y se descarta si hay que
  esperar más de 14 h.
- Las horas respetan el huso real de cada aeropuerto. La llegada se
  calcula en UTC y se escribe como reloj del aeropuerto de destino.
- El precio baja un poco con las escalas (18 % y 28 %), como pasa en la
  realidad.
- Una búsqueda cuesta unos 3 ms (medido sobre 4.000 búsquedas al azar:
  p50 2,6 ms, p95 6,7 ms, máximo 19,5 ms), así que el grafo se arma una
  vez y las consultas son inmediatas.

### Cambio de aeropuerto dentro de la ciudad

Un recorrido puede pasar de Aeroparque a Ezeiza *por tierra*:

```
Tucumán → Aeroparque   ··· traslado (≥ 4 h de espera) ···   Ezeiza → Madrid
        1 escala, con "cambio_aeropuerto" en el primer segmento
```

Cuenta como **una** escala (no dos), exige al menos 4 h entre el aterrizaje
y la salida (traslado, nuevo check-in y margen para un retraso) y el
segmento sale marcado para que la pantalla lo diga: *"Llegás a Aeroparque
y salís de Ezeiza. El traslado entre los dos corre por tu cuenta, y son dos
pasajes distintos."* Es lo que hace un viajero real, no un truco del
modelo.

## 5. Cobertura medida

Medido con un script que le hace al proveedor de vuelos las mismas
búsquedas que le haría el servicio, sobre la base sembrada en memoria:

| Pares de ciudades | Directo | Mejor con 1 escala | Con 2 escalas | Sin resultados |
|---|---:|---:|---:|---:|
| Las 100 con más tráfico entre sí (9.900) | 37,5 % | 57,1 % | 5,5 % | **0,0 %** |
| Las 400 más conectadas entre sí (159.600)¹ | 10,0 % | 56,2 % | 33,3 % | 0,4 % |
| 35 ciudades argentinas → esas 100 (3.500) | 0,5 % | 17,7 % | 67,1 % | 14,7 % |
| Esas 100 → las 35 argentinas (3.500) | 0,5 % | 18,5 % | 69,5 % | 11,4 % |

¹ Sólo con `--completo` (ver sección 8).

Antes del cambio de aeropuerto, las ciudades argentinas hacia las 100
principales daban un 53,3 % de pares sin resultados; con él, 14,7 %. Lo
que queda sin resultados es lo que de verdad necesita **tres escalas o
más** con las rutas de ese dataset. Se diagnosticó con un recorrido de la
red ciudad por ciudad: de los ~520 pares sin resultados desde ciudades
argentinas, 488 necesitan tres escalas, 22 necesitan cuatro, y 12
tendrían camino con dos pero ningún horario que enlace dentro de la espera
máxima. Dos rasgos del dataset explican casi todo: el 68 % tiene como
destino una ciudad china (en 2014 se conectaban sobre todo entre sí), y
169 salen de dos ciudades chicas, Santa Rosa y Viedma, cuyas únicas rutas
de salida llevan a otra ciudad chica (San Rafael y Trelew), no a Buenos
Aires: el dataset tiene el vuelo de ida a ellas, pero no el de vuelta.
Sólo el 2 % de las rutas del dataset (739 de 36.383) está en esa
situación, y se dejó como está: completarlas sería inventar rutas, y esta
red es la parte real de la simulación.

Se podría admitir una escala más; se decidió que no: el recorrido por
Buenos Aires, un hub, otro hub y el destino ya es un viaje de un día y
medio, y la cantidad de combinaciones por consulta crece unas cincuenta
veces.

## 6. Otros errores encontrados en la revisión

Además de las rutas, la revisión de todo el proyecto encontró lo
siguiente. Cada fila dice cómo se verificó.

| Síntoma | Causa | Arreglo | Prueba |
|---|---|---|---|
| La hora de llegada de un vuelo estaba corrida varias horas | Se calculaba como salida + duración sin mirar el huso de cada aeropuerto: EZE → MAD "llegaba" 4 h antes de lo real | La llegada se calcula en UTC y se muestra como reloj del aeropuerto de destino | `humo-backend`: *horas* |
| Con Duffel, un vuelo de las 14:42 se veía a las 17:42 | Duffel manda la hora local sin huso; el navegador la leía como hora propia | `comoRelojConZ` en `proveedor-duffel.js` | medido contra la API real |
| Con Duffel, un viaje de más de 24 h mostraba "0 min" de duración | La duración trae días (`P1DT4H15M`) y el lector de duraciones sólo entendía `PT…H…M`; es justo lo que pasa con un cambio de aeropuerto o una escala larga | `duracionAMinutos` entiende días y segundos, y si Duffel no informa la duración se calcula con los husos | se encontró y se verificó contra la API real |
| Una búsqueda a Duffel que iba bien aparecía como "no disponible por timeout" | Presupuesto de 2,5 s para una API que tarda 1,5–3,5 s | Presupuesto por proveedor, que el agregador informa al front (`presupuestos_ms`) | medido contra la API real (1,4–2,8 s por búsqueda) |
| Con Redis caído, toda búsqueda tardaba 5–8 s | El cliente de Redis encolaba los comandos esperando reconectar | Falla rápido (`disableOfflineQueue`): sin Redis se busca igual, sin caché | medido a mano con Redis detenido: búsqueda 200 y reserva 201 en milisegundos |
| Tres búsquedas inválidas dejaban a todos sin vuelos 30 s | Un 4xx del proveedor se contaba como fallo y abría el circuit breaker | Un rechazo (4xx) es "rechazado", no un fallo | `humo-backend`: *búsquedas inválidas* |
| El panel decía "Administrador" pero cada pedido daba 401 | Un token firmado con otro secreto seguía guardado en el navegador | La sesión se descarta al primer 401 | probado a mano en el navegador |
| "Reserva confirmada" no reservaba nada | El código de reserva se generaba al azar en el navegador | Reservas reales con cupo y aviso asíncrono (Módulo 3) | probado a mano en el navegador y con `curl` |
| El campo de origen pisaba el texto largo con la insignia | Un `padding: 0` anulaba el espacio reservado | Padding explícito al final del campo | revisado en el navegador |
| Con Supabase, un pedido que necesitaba la base de usuarios podía tardar más de 1,5 s | Abrir una conexión nueva (TLS + pooler) cuesta ~1,5 s y el pool la cerraba por inactividad | Pool con una conexión viva (`min: 1`, keep-alive) | medido a mano contra Supabase |
| Si Postgres no contesta, `usuarios` no arrancaba | Esperaba la base antes de abrir el puerto | Arranca *vivo pero no listo* (`/salud/live` 200, `/salud/ready` 503) y prepara la base en segundo plano | medido a mano con Postgres detenido (listo 5 s después de volver) |
| Una búsqueda con el mismo origen y destino no se rechazaba | El servicio sólo comprobaba que los parámetros existieran | 400 `mismo_lugar` (también entre dos aeropuertos de la misma ciudad) | `humo-backend` |
| Era posible reservar un vuelo que ya salió | Nada lo comprobaba | 422 `vuelo_pasado` | probado a mano con `curl` |
| Una instancia que moría de golpe hacía fallar la mitad de las búsquedas durante unos segundos | La lista de instancias tiene hasta ~4 s de antigüedad | Reintento contra otra instancia ante un fallo de conexión | medido a mano con dos instancias (de 4 de 8 fallas a 0) |

Una consecuencia de método: las pruebas que reservan asientos dejaron
reservas de prueba en las bases con las que se hace la demostración.
`DATOS_DIR` (ver `.env.example`) manda las bases a otra carpeta.

## 7. Qué sigue siendo una limitación

- **Los datos son de 2014.** Hay aerolíneas que ya no existen y rutas que
  ya no se vuelan. No hay que presentarlo como información vigente. Con
  `PROVEEDOR=duffel` los vuelos son de una API real (en modo de prueba).
- **Horarios y precios simulados.** Son plausibles y estables (la misma
  ruta da los mismos horarios en cada arranque), no reales.
- **Hasta dos escalas.** Lo que necesita más se informa como vacío.
- **La "misma ciudad" es un criterio de distancia.** 120 km agrupa Ezeiza
  y Aeroparque (35 km), Londres y sus cinco aeropuertos, y deja afuera
  Rosario y Buenos Aires; es una heurística razonable, no una verdad.
- **Duffel en modo de prueba** devuelve las ofertas de su aerolínea de
  ensayo; la cobertura real de rutas es la de su cuenta en producción.

## 8. Cómo comprobarlo

```bash
npm run test:back    # las rutas por HTTP, contra el sistema levantado
```
