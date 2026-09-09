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

Ninguna es obligatoria para aprobar: la base propia alcanza. De las
evaluadas, **Duffel ya está integrado y probado contra la API real**
(sección siguiente) — el resto queda listado por si en algún momento
hace falta cubrir hospedaje también con una fuente externa, que Duffel
no da.

| Proveedor | Qué da | Costo | Sirve para |
|---|---|---|---|
| **[Duffel](https://duffel.com/)** | Vuelos (NDC, 300+ aerolíneas) | Modo test gratuito, sin tarjeta; se paga por reserva confirmada (irrelevante acá, nunca se reserva) | **Implementado y probado** — ver abajo |
| **[Travelpayouts](https://www.travelpayouts.com/)** | Vuelos y hoteles, vía programa de afiliados | Registro gratuito, con límite de llamadas | Vuelos **y** hospedaje: es la única de la lista que cubre los dos verticales |
| **[Aviationstack](https://aviationstack.com/)** | Horarios y estado de vuelos | ~100 pedidos/mes gratis | Horarios reales, pero **no** precios ni disponibilidad |
| **[AeroDataBox](https://aerodatabox.com/)** | Datos de vuelos y aeropuertos | ~600 unidades/mes gratis | Idem: enriquecer datos, no cotizar |

Si en algún momento hospedaje también necesita una fuente externa,
Travelpayouts es la única de la lista que lo cubre — mismo patrón,
archivo nuevo en `servidor/hospedaje/`, nada existente se toca.

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

## Duffel: implementado y probado contra la API real

A diferencia de Amadeus, esta implementación **sí se probó contra la
API real**, con una cuenta y un token de test verdaderos:
`servidor/comun/duffel.js` + `servidor/vuelos/proveedor-duffel.js`.

**Registro:** ~1 minuto, sin tarjeta de crédito — cuenta, entrar a
Developers → Access tokens, crear un token de test. Ese token nunca
puede confirmar una reserva real ni cobrar nada; sólo sirve para
`live_mode: false`.

**Verificado en vivo** (no sólo leyendo la documentación): búsquedas
reales EZE↔MAD y LHR↔JFK devolvieron ofertas de aerolíneas de
verdad (Iberia, British Airways, American Airlines, Aerolíneas
Argentinas) más "Duffel Airways" (`ZZ`), la aerolínea de prueba de la
plataforma — precios y duraciones con formato correcto, mapeados sin
pérdida a la forma `Vuelo` del contrato (`docs/contrato-agregador.md`
§2).

**El hallazgo que hay que decir en la defensa:** la búsqueda de Duffel
es **síncrona contra varias aerolíneas a la vez**
(`return_offers=true`, sin polling), y eso tiene un costo de tiempo
real: en las pruebas tardó entre **1.6 s y 3.4 s** — contra los ~200 ms
del proveedor ficticio. El presupuesto agregador→vertical del contrato
(§3) es 2500 ms. Con Duffel activo, una búsqueda de vuelos lenta va a
superar ese presupuesto **con cierta frecuencia**, y el vertical va a
aparecer como "no disponible" por timeout — no por un bug, sino porque
el timeout está haciendo exactamente lo que tiene que hacer contra una
fuente externa real y variable. Es, de hecho, la demostración más
honesta posible del requisito central del proyecto: con datos
ficticios el timeout nunca se dispara porque nunca hace falta; con una
API real, a veces sí, y el sistema lo absorbe igual.

Por eso el proveedor por defecto sigue siendo `ficticio` — rápido,
controlable, es la base de la demostración de fallos parciales — y
Duffel queda como una segunda demostración, deliberadamente separada:
"esto también funciona contra una API real de la industria, con sus
tiempos reales incluidos".

**Cómo activarlo:**

```bash
# .env (no versionar)
DUFFEL_ACCESS_TOKEN=duffel_test_...
PROVEEDOR=duffel
```

Reiniciar `vuelos` (o todo el stack) después de cambiarlo. Sin
`PROVEEDOR=duffel`, esta variable no hace nada — el sistema sigue con
`ficticio` igual que siempre.

**Por qué no hizo falta tocar el front:** es exactamente el punto del
patrón de interfaz (Módulo 4). `ProveedorDeVuelos` sólo define
`buscar(criterios) → Vuelo[]`; a quien la implementa —Amadeus, Duffel,
la base propia— le toca traducir su formato al contrato, no al revés.
El agregador pide `/api/buscar/vuelos` igual que siempre, `ListaVuelos.jsx`
recibe la misma forma de siempre, y `dominio/formato.js` ya formatea
cualquier moneda ISO 4217 que venga (Duffel no fija una moneda por
parámetro como Amadeus — devuelve la que ponga la aerolínea, USD en las
pruebas). Cero cambios en `src/`.

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

Duffel, en cambio, sí se pudo probar — variables que espera, ver
`.env.example`:

```bash
PROVEEDOR=duffel
DUFFEL_ACCESS_TOKEN=duffel_test_...
```
