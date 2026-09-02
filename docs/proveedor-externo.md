# La fuente de datos externa

## Novedad: Amadeus Self-Service ya no existe

El profesor sugirió Amadeus, y el plan original era usar su tier
**Self-Service** (gratuito, entorno de test). **Ese portal cerró el 17 de
julio de 2026.** Amadeus pausó los registros nuevos meses antes y
deshabilitó las claves existentes en esa fecha. Lo confirmaron varias
fuentes de la industria:

- [PhocusWire — *Amadeus to shut down self-service APIs portal for developers*](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers)
- [Tripgic — *Amadeus Self-Service API Shutdown: Migrate Before July 17*](https://www.tripgic.com/playbook/amadeus-api-shutdown-migration/)
- [Travel Trade Today — *Amadeus Closes Self-Service APIs Portal for Developers*](https://traveltrade.today/gds-systems/amadeus-sa/amadeus-closes-self-service-apis-portal-for-developers/)

Lo que sigue en pie es **Amadeus Enterprise**, que es un contrato
comercial con gestor de cuenta. No es algo a lo que se acceda desde un
proyecto de cátedra.

> Conviene comentárselo al profesor: su sugerencia era razonable cuando
> la hizo, y el cambio es de este año.

## Qué significa esto para el proyecto

Estructuralmente, **nada**. Y eso es el argumento más fuerte que tiene
este diseño para la defensa.

El sistema nunca dependió de Amadeus: depende de una interfaz
(`ProveedorDeVuelos`, `ProveedorDeHospedaje`) con dos implementaciones
intercambiables por configuración. Que una de las dos se haya quedado sin
fuente no obliga a tocar el agregador, ni el front, ni el contrato, ni
las otras tres bases. Se cambia una variable de entorno.

Dicho de otra forma: el proveedor externo desapareció en el medio del
proyecto y el sistema siguió andando. Es literalmente el requisito
central de la materia, aplicado al proyecto mismo.

Lo que cambia es de qué se habla:

| Antes | Ahora |
|---|---|
| Amadeus como fuente, base propia como respaldo | Base propia como fuente, interfaz lista para cualquier proveedor |
| "Demostramos que podemos consumir una API real" | "Demostramos que la fuente es reemplazable sin tocar el sistema" |

## Si quieren igual datos reales

Ninguna es obligatoria para aprobar: la base propia alcanza. Pero si
quieren sumar el punto, estas son las opciones vigentes.

| Proveedor | Qué da | Costo | Sirve para |
|---|---|---|---|
| **[Duffel](https://duffel.com/)** | Vuelos (NDC, 300+ aerolíneas). Es el camino de migración más citado desde Amadeus | Modo test gratuito; se paga por reserva | Vuelos. Los datos del sandbox son de prueba, no reales |
| **[Travelpayouts](https://www.travelpayouts.com/)** | Vuelos y hoteles, vía programa de afiliados | Registro gratuito, con límite de llamadas | Vuelos **y** hospedaje: es la única de la lista que cubre los dos verticales |
| **[Aviationstack](https://aviationstack.com/)** | Horarios y estado de vuelos | ~100 pedidos/mes gratis | Horarios reales, pero **no** precios ni disponibilidad |
| **[AeroDataBox](https://aerodatabox.com/)** | Datos de vuelos y aeropuertos | ~600 unidades/mes gratis | Idem: enriquecer datos, no cotizar |

**Recomendación:** si van a integrar una sola, **Travelpayouts**, porque
cubre los dos verticales y el registro es gratuito. Duffel es más
prolijo técnicamente pero sólo resuelve vuelos, y habría que dejar
hospedaje con la base propia igual — con lo cual conviene evaluar si el
trabajo extra suma algo a la nota.

**Recomendación más fuerte:** dejar la Etapa 4 como está —interfaz
lista, proveedor ficticio andando— y gastar ese tiempo en la Etapa 5
(circuit breaker, caché, contenedores), que es donde está el puntaje de
la materia. Integrar un proveedor externo es trabajo de plomería;
tolerancia a fallos es el tema.

## Qué se decidió hacer

Sembrar las bases propias con **datos de referencia reales** y simular
sólo la capa comercial.

Los aeropuertos, las ciudades, las aerolíneas y qué aerolínea vuela qué
ruta salen de [OpenFlights](https://openflights.org/data.html), un
dataset abierto bajo ODbL: 70 aeropuertos, 30 aerolíneas y 255 rutas con
origen en Argentina, en 22 países. Está versionado en
`servidor/datos-referencia/` con su atribución.

Los horarios, la disponibilidad y los precios se generan. No es una
concesión: **es exactamente el dato que un GDS cobra por dar**, y es el
único que aportaría un proveedor externo. Que EZE–MAD lo vuelen Iberia,
Aerolíneas Argentinas y Air Europa es verificable; cuánto sale el pasaje
del 12 de octubre, no.

Esa frontera conviene decirla explícitamente en la defensa: separa
"inventamos todo" de "modelamos el dominio con datos reales y simulamos
la capa que no es pública".

## Cómo se enchufa un proveedor nuevo

El trabajo está acotado a un archivo por vertical. Para vuelos:

1. Escribir `servidor/vuelos/proveedor-<nombre>.js` exportando una
   función que devuelva `{ nombre, buscar(criterios) }`. El contrato de
   esa interfaz está documentado en `servidor/vuelos/proveedor.js`.
2. Que `buscar` devuelva items con **exactamente** la forma de
   `vuelos[]` del contrato (`docs/contrato-agregador.md` §2). Todo el
   mapeo del formato ajeno al propio vive ahí adentro y no sale.
3. Agregarlo al `if` de `crearProveedor` en `proveedor.js`.
4. Arrancar con `PROVEEDOR=<nombre>`.

Nada más se toca. El agregador, el front y las otras bases no se enteran.

## El código de Amadeus que ya está escrito

`servidor/vuelos/proveedor-amadeus.js`,
`servidor/hospedaje/proveedor-amadeus.js` y
`servidor/comun/amadeus.js` están implementados y quedan en el
repositorio. **Nunca se pudieron probar contra la API real**, y ya no se
van a poder con una cuenta Self-Service.

Se dejan por tres razones: son la segunda implementación que demuestra
que la interfaz sirve para algo, sirven de plantilla para escribir la de
Travelpayouts o Duffel, y funcionarían tal cual si el día de mañana
aparece acceso Enterprise.

Lo que implementan, por si hace falta retomarlo:

- **OAuth2 `client_credentials`** contra
  `POST /v1/security/oauth2/token`. El token dura ~30 min; se renueva un
  minuto antes de vencer y las búsquedas simultáneas comparten una sola
  renovación en lugar de pedir un token cada una.
- Un 401 invalida el token cacheado pero **no** reintenta dentro de la
  misma búsqueda: gastar el presupuesto de tiempo del usuario en un
  segundo intento es peor que decirle "no disponible" rápido.
- **Vuelos:** `GET /v2/shopping/flight-offers`, una llamada.
- **Hospedaje:** dos llamadas —
  `GET /v1/reference-data/locations/hotels/by-city` y después
  `GET /v3/shopping/hotel-offers`— que comparten el mismo presupuesto de
  1800 ms, lo que hacía a ese vertical bastante más frágil que el de
  vuelos.

Variables de entorno que espera:

```bash
PROVEEDOR=amadeus
AMADEUS_CLIENT_ID=...
AMADEUS_CLIENT_SECRET=...
AMADEUS_BASE=https://test.api.amadeus.com   # producción: https://api.amadeus.com
AMADEUS_MONEDA=ARS
```
