# Datos de referencia

Dataset **completo** de OpenFlights (<https://openflights.org/data.html>),
publicado bajo la [Open Database License
(ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Hasta la
Etapa 3 estos archivos eran un recorte manual con origen en Argentina;
ahora es el mundo entero, para que el catálogo de lugares pueda ofrecer
cualquier aeropuerto real, en cualquier país.

## Qué hay acá

| Archivo | Contenido |
|---|---|
| `aeropuertos.json` | 6071 aeropuertos con IATA válido y tipo `airport`: código, nombre, ciudad, país, coordenadas y zona horaria |
| `aerolineas.json` | 983 aerolíneas activas, con su código IATA |
| `rutas.json` | 65 647 rutas reales entre esos aeropuertos, con la distancia en km calculada por la fórmula del semiverseno |

Se generan con `node servidor/datos-referencia/generar.mjs`, que baja
`airports.dat` / `airlines.dat` / `routes.dat` directo del repositorio
de OpenFlights y filtra:

- **Aeropuertos:** IATA de 3 letras válido y `type = airport` (el
  dataset completo tiene 7698 filas; también incluye helipuertos y
  estaciones de tren agregadas después, que se excluyen).
- **Aerolíneas:** `Active = Y` con IATA de 2 caracteres válido (de
  6162 filas quedan 983).
- **Rutas:** origen y destino con IATA en el set de aeropuertos válidos
  y aerolínea en el set de aerolíneas válidas, sin duplicar
  codeshares del mismo trío aerolínea-origen-destino (de 67 663 filas
  quedan 65 647).

## Qué es real y qué no

**Real:** los aeropuertos, las ciudades, los países, las coordenadas,
las aerolíneas y qué aerolínea vuela qué ruta, para el mundo entero.
Las distancias salen de las coordenadas, y las duraciones de las
distancias.

**Simulado:** los horarios de salida, la disponibilidad y los precios.
Son exactamente los datos por los que un GDS cobra, y son los que
proveería el proveedor externo si hubiera uno.

**A medias — y hay que decirlo en la defensa:** los nombres de país
están traducidos al español completos (`traducciones-paises.mjs`, 237
valores, todos mapeados a mano). Los nombres de **ciudad** no: son
casi 7000 valores distintos y traducirlos uno por uno no es viable a
mano en el tiempo de este proyecto. Se corrigió un conjunto de ~150
capitales y ciudades muy conocidas (exónimos en español —Londres,
Moscú, Pekín— y reposición de acentos en topónimos de origen
español/portugués —Córdoba, São Paulo—, ver `traducciones-ciudades.mjs`).
El resto de las ciudades queda con el nombre que publica OpenFlights,
en inglés y sin diacríticos. Es la misma separación deliberada de
siempre entre "esto es real" y "esto es simulado", aplicada ahora
también a "esto está traducido" y "esto no".

## Vigencia

OpenFlights es un dataset comunitario y su última actualización masiva
de rutas es de 2014. Algunas rutas ya no se operan y faltan varias
abiertas después. Para este proyecto no importa —lo que se demuestra es
la arquitectura, no la exactitud del catálogo— pero **no debe
presentarse como información de vuelos vigente**.

## Cómo se usa

Se lee una sola vez, cuando cada servicio siembra su base por primera
vez (`servidor/vuelos/datos.js`, `servidor/hospedaje/datos.js`,
`servidor/traslado/datos.js` sólo usa `aeropuertos.json` para la lista
de ciudades). En tiempo de ejecución ningún servicio toca estos
archivos: cada uno consulta únicamente su propia base SQLite.

Si se vuelve a correr `generar.mjs` después de que un servicio ya
sembró su base, hay que borrar la base para que se vuelva a sembrar con
los datos nuevos — `sembrar()` no resiembra si ya hay filas (ver
`servidor/comun/base.js`, `.gitignore` ya excluye `servidor/*/datos/`
por esto mismo).
