# Informe de amenazas

Qué se protegió en el Gestor de viajes, de qué, y qué queda sin cubrir.
La prueba de que el sistema se recupera ante fallos está en
`docs/recuperacion-ante-fallos.md`.

## Qué se protege

| Activo | Por qué importa |
|---|---|
| Cuentas de usuario y de administrador | Un administrador apaga verticales y da de alta a otros administradores de su agencia. |
| Contraseñas y códigos de verificación | Con ellos se entra a una cuenta. |
| Datos de las reservas (nombres, email de contacto) | Son datos personales. |
| El cupo de los vuelos | Una reserva duplicada o una carrera venden asientos que no existen. |
| La disponibilidad de la búsqueda | Es lo que el usuario viene a hacer. |

## Amenazas y cómo se cubren

### 1. Interceptación (*man-in-the-middle*)

**Amenaza.** Alguien en la red entre dos componentes lee o modifica lo
que pasa: el token de sesión, una contraseña en el login, una reserva.

**Qué se hizo.**
- **TLS en todos los tramos** con `TLS=on` (`servidor/comun/tls.js`):
  navegador → front, navegador → agregador y agregador → cada servicio.
  Sólo se aceptan TLS 1.2 y 1.3.
- **Verificación de identidad, no sólo cifrado.** Una CA propia
  (`npm run tls:certs`) firma un certificado por servicio, y ningún
  cliente apaga la verificación: un certificado que no venga de esa CA
  corta la conexión. Cifrar sin verificar dejaría pasar a quien se
  ponga en el medio con su propio certificado.
- **Postgres alojado (Supabase).** La conexión ya iba cifrada pero con
  `rejectUnauthorized: false`, o sea sin comprobar contra quién. Ahora
  se verifica el certificado del servidor contra la CA de Supabase
  (`servidor/certificados/`).
- Las APIs externas (Duffel) van por HTTPS con las CAs públicas.

### 2. Suplantación

**Amenaza.** Alguien se hace pasar por un usuario, por un
administrador o por un componente del sistema.

**Qué se hizo.**
- **Autenticación.** Login por email (con verificación por código) o,
  para administradores, por usuario y contraseña. Las contraseñas se
  guardan con `scrypt` y sal (`servidor/comun/contrasenas.js`), nunca en
  claro. La sesión es un JWT HS256 firmado por el agregador, que es el
  único que conoce el secreto (`servidor/comun/jwt.js`); la firma se
  compara en tiempo constante.
- **Autorización.** La identidad sale del token verificado, nunca de una
  cabecera que mande el cliente. Las rutas de administración exigen rol
  `admin` y además el permiso puntual (`gestion_verticales`,
  `gestion_usuarios`); si falta, 403. La agencia también sale del token:
  un administrador de una agencia no puede tocar la configuración de
  otra.
- **Fuerza bruta.** Cinco intentos fallidos seguidos de login, o de
  código de verificación, bloquean esa cuenta 15 minutos (429). Sin esto
  el código de 6 dígitos se podía recorrer entero
  (`servidor/agregador/intentos.js`).
- **Suplantar a un componente.** Los servicios internos confían en la
  cabecera `x-usuario-id` que les pone el agregador. Sin protección,
  cualquiera que llegara al puerto de `usuarios` podía mandarla con el
  id de un administrador. Con `TLS=on` los servicios internos exigen
  **TLS mutuo**: sin un certificado de cliente firmado por la CA del
  sistema, la conexión se corta en el handshake, antes de llegar a la
  ruta.
- **Reservas repetidas.** Cada reserva lleva una `Idempotency-Key`:
  repetir el pedido no descuenta otro asiento.

### 3. Denegación de servicio

**Amenaza.** Saturar un componente para que deje de atender, o que la
caída de uno arrastre a los demás.

**Qué se hizo.**
- **Aislamiento de fallos.** Cada llamada entre servicios tiene timeout
  (`servidor/comun/pedir.js`). Un vertical lento o caído sale como "no
  disponible" y el resto de la búsqueda sigue.
- **Circuit breaker y caché** en el agregador. Tras tres fallos seguidos
  deja de llamar a ese vertical un rato y muestra la última respuesta
  buena.
- **Límite de tamaño del pedido.** Un cuerpo de más de 1 MB se corta con
  413 sin terminar de leerlo (`servidor/comun/http.js`).
- **Réplicas y failover.** Si una instancia cae, el tráfico va a otra
  (ver `docs/recuperacion-ante-fallos.md`).

## Lo que queda sin cubrir

- **No hay límite de pedidos por IP** en la búsqueda. Un ataque
  distribuido de volumen se frena delante del sistema (un balanceador o
  un servicio anti-DDoS), no en los servicios.
- **Redis va sin TLS ni contraseña.** Está en la misma máquina o red
  privada que el nodo central y no se publica afuera.
- **Un mismo certificado por servicio.** Si alguien roba la clave de un
  servicio, puede hacerse pasar por él hasta que se regeneren los
  certificados (`npm run tls:certs -- --forzar`).
- **El bloqueo de login vive en la memoria del agregador.** Con varias
  instancias del agregador habría que pasarlo a Redis.
- **TLS se activa con `TLS=on`.** Apagado por defecto para que el
  sistema arranque sin certificados; en Docker Compose todavía no se
  montan los certificados.
- **Las rutas `/demo`** (simular caídas) no piden sesión. Son de la
  demostración y se sacan para un despliegue real.

## Cómo activar TLS

```bash
npm run tls:certs                     # CA + un certificado por servicio, en certs/
# En .env:  TLS=on
npm run back                          # los servicios escuchan en https://
npm run dev:back:tls                  # el front, en https://localhost:5173
```

Para que el navegador confíe en el agregador hay que agregar `certs/ca.crt`
como raíz de confianza, una sola vez. En macOS:

```bash
security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db certs/ca.crt
```

Para llamar a un servicio interno con `curl` hay que presentar un
certificado del sistema:

```bash
curl --cacert certs/ca.crt --cert certs/agregador.crt --key certs/agregador.key https://localhost:4006/api/v1/servicios
```
