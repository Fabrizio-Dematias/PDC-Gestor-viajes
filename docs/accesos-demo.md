# Accesos para la demo — quién entra por dónde

Referencia rápida para el grupo: qué puerto es cada agencia y con qué
credenciales entrar en cada uno. Las cuentas ya están sembradas solas
la primera vez que arranca `usuarios` (`servidor/usuarios/datos.js`) —
no hay que crear nada a mano.

## Puertos

| Puerto | Qué es | Agencia por defecto (sin sesión) | Cómo se levanta |
|---|---|---|---|
| **5173** | Front de marca blanca | Gestor de viajes (`ag-demo`) | `npm run dev:back` |
| **5174** | Front de marca blanca | Aventura Sur Viajes (`ag-sur`) | `npm run dev:back:sur` |
| 4000 | Agregador (API Gateway) | — (no tiene UI) | `npm run back` (levanta todo el nodo central + cómputo) |
| 4001–4004 | Vuelos / Hospedaje / Usuarios / Traslado | — | idem |
| 4100 / 4101 | Nodo de agencia (bitácora ag-demo / ag-sur) | — | `npm run back:nodo-agencia` (uno por agencia, no está levantado ahora) |

**Importante:** desde que la sesión decide la agencia (no el puerto),
cualquier cuenta funciona en cualquiera de los dos puertos — 5173 y
5174 son sólo la marca que ve un invitado *antes* de loguearse.

## Credenciales

| Agencia | Rol | Usuario / email | Contraseña | Permisos |
|---|---|---|---|---|
| ag-demo | Cliente | `invitado@demo.com` | `demo1234` | — |
| ag-demo | Admin | `admin` | `admin1234` | gestión de verticales y de administradores |
| ag-sur | Admin | `admin-sur` | `admin1234` | gestión de verticales y de administradores |
| ag-sur | Cliente | *(no hay sembrado)* | — | Registrarse en `localhost:5174` → nace como cliente de ag-sur |

El campo de login acepta el email (clientes) o el username (admins) —
es el mismo campo, el backend resuelve cuál es.

## Qué mostrar con cada una

- **Invitado, sin loguearse**, en cualquiera de los dos puertos: la
  búsqueda funciona igual — el login se ofrece, nunca se exige.
- **`admin` / `admin1234`** en el 5173: panel de administración de
  Gestor de viajes (Vuelos, Hospedaje y Traslado activos).
- **`admin-sur` / `admin1234`** — funciona igual en el 5173 o en el
  5174: la marca cambia sola a Aventura Sur Viajes, y su panel muestra
  Traslado apagado (así está configurada esa agencia) y sus propios
  21 usuarios, no los de ag-demo.
- **Panel de simulación de fallos** ("Simular fallos", abajo a la
  derecha): sólo aparece logueado como admin, de cualquiera de las dos
  agencias.
