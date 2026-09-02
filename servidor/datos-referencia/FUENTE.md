# Datos de referencia

Subconjunto de **OpenFlights** (<https://openflights.org/data.html>),
publicado bajo la [Open Database License
(ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).

## Qué hay acá

| Archivo | Contenido |
|---|---|
| `aeropuertos.json` | 70 aeropuertos: código IATA, nombre, ciudad, país, coordenadas y zona horaria |
| `aerolineas.json` | 30 aerolíneas en actividad, con su código IATA |
| `rutas.json` | 255 rutas reales que salen de aeropuertos argentinos, con la distancia en km calculada por la fórmula del semiverseno |

Se extrajo filtrando el dataset completo a las rutas con origen en
Argentina, quedándose con los aeropuertos y aerolíneas que aparecen en
ellas. El dataset original tiene 7698 aeropuertos y 67 663 rutas; acá hay
lo que este proyecto necesita y nada más.

Los nombres de ciudades y países se tradujeron al español y se les
repusieron los acentos: OpenFlights los publica en inglés y sin
diacríticos (`Cordoba`, `Sao Paulo`, `Spain`). Es la única modificación
sobre los datos originales; los códigos IATA, las coordenadas y las
rutas están tal cual vienen.

## Qué es real y qué no

**Real:** los aeropuertos, las ciudades, los países, las coordenadas, las
aerolíneas y qué aerolínea vuela qué ruta. Las distancias salen de las
coordenadas, y las duraciones de las distancias.

**Simulado:** los horarios de salida, la disponibilidad y los precios.
Son exactamente los datos por los que un GDS cobra, y son los que
proveería el proveedor externo si hubiera uno.

Esta separación es deliberada y conviene decirla en la defensa: la
estructura del dominio es real, lo que se simula es la capa comercial.

## Vigencia

OpenFlights es un dataset comunitario y su última actualización masiva de
rutas es de 2014. Algunas rutas ya no se operan y faltan varias abiertas
después. Para este proyecto no importa —lo que se demuestra es la
arquitectura, no la exactitud del catálogo— pero **no debe presentarse
como información de vuelos vigente**.

## Cómo se usa

Se lee una sola vez, cuando cada servicio siembra su base por primera
vez. En tiempo de ejecución ningún servicio toca estos archivos: cada uno
consulta únicamente su propia base SQLite.
