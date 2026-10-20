/**
 * Descripción formal de la API pública del agregador, en OpenAPI 3.0
 * (Módulo 4: "contrato de interfaz" vs. "descripción de servicio").
 *
 * El **contrato** es el acuerdo —qué operaciones existen, qué reciben,
 * qué devuelven, qué errores pueden ocurrir— y hasta ahora vivía escrito
 * en prosa en `docs/contrato-agregador.md`. Esto es su **descripción de
 * servicio**: el mismo acuerdo en un formato que una máquina puede leer.
 * Con eso:
 *
 * - `GET /api/v1/docs` muestra documentación interactiva (Swagger UI),
 *   para explorar y probar la API desde el navegador;
 * - `GET /api/v1/openapi.json` entrega el documento, de donde se puede
 *   generar un cliente, o validar;
 * - `docs/openapi.yaml` se genera desde este mismo archivo
 *   (`npm run docs:openapi`), así el YAML versionado y el servido no
 *   pueden contar historias distintas.
 *
 * Es la única fuente de verdad: se escribe una vez, acá, y de acá salen
 * la documentación, el JSON, el YAML y la validación.
 *
 * ## Versionado
 *
 * Todo vive bajo `/api/v1`. Un cambio que **no rompe** (agregar un campo
 * opcional como `segmentos`, un endpoint nuevo, un `motivo` nuevo) no
 * cambia la versión; uno que **rompe** (quitar o renombrar un campo,
 * cambiar un tipo, volver obligatorio algo opcional) tiene que salir
 * como `/api/v2`, y `/v1` sigue respondiendo mientras haya quien lo use.
 * Las rutas sin versión (`/api/buscar`, …) son alias deprecados de `/v1`:
 * responden lo mismo con las cabeceras `Deprecation` y `Link:
 * rel="successor-version"`.
 */

const ref = (nombre) => ({ $ref: `#/components/schemas/${nombre}` })
const json = (schema, description) => ({ description, content: { 'application/json': { schema } } })
const error = (description) => json(ref('Error'), description)
const parametro = (name, schema, description, extra = {}) => ({ name, in: 'query', required: false, description, schema, ...extra })
const ruta = (name, description, schema = { type: 'string' }) => ({ name, in: 'path', required: true, description, schema })
const sesion = [{ bearerAuth: [] }]
const IATA = { type: 'string', pattern: '^[A-Z]{3}$', example: 'EZE' }
const FECHA = { type: 'string', format: 'date', example: '2026-11-20' }
/** Reloj local del aeropuerto escrito con Z (contrato §2). */
const RELOJ = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$',
  description: 'Hora de reloj del aeropuerto, escrita con `Z`: se muestra tal cual, sin convertir al huso de quien mira.',
  example: '2026-11-20T11:45:00.000Z',
}
const VERTICALES = ['vuelos', 'hospedaje', 'traslado']
const MOTIVOS_NO_DISPONIBLE = [
  'timeout',
  'error',
  'circuito_abierto',
  'apagado_por_admin',
  'desactivado_por_usuario',
  'sin_instancias',
]

const respuestasSesion = {
  401: error('Hace falta iniciar sesión (`motivo: sin_sesion`).'),
  403: error('La sesión no tiene el rol o el permiso necesario (`motivo: sin_permiso`).'),
}

export const OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'Gestor de viajes — API del agregador',
    version: '1.0.0',
    description: [
      'Buscador de vuelos, hospedaje y traslados con **tolerancia a fallos parciales**: si un servicio se cae, el resto de la búsqueda sigue respondiendo.',
      '',
      'El agregador es la puerta de entrada única: llama a cada servicio en paralelo, con timeout y circuit breaker, y devuelve lo que haya llegado. Una búsqueda por vertical (`/buscar/{vertical}`) responde **200** con resultados, **503** si ese vertical no está disponible (con cuerpo JSON válido, nunca un 500 pelado) o **400** si la búsqueda no tiene sentido.',
      '',
      'Documento de diseño: `docs/contrato-agregador.md`. Esta descripción se genera desde `servidor/agregador/openapi.js`.',
    ].join('\n'),
  },
  servers: [{ url: '/api/v1', description: 'Versión 1 (la vigente)' }],
  tags: [
    { name: 'Búsqueda', description: 'Vuelos, hospedaje y traslado, en paralelo y con fallos parciales.' },
    { name: 'Reservas', description: 'Reserva de vuelos: canal síncrono + aviso asíncrono por cola.' },
    { name: 'Cuenta', description: 'Registro, login y perfil.' },
    { name: 'Administración', description: 'Verticales, administradores, auditoría. Exigen rol de administrador.' },
    { name: 'Sistema', description: 'Salud, descubrimiento de servicios, documentación y rutas de demostración.' },
  ],
  paths: {
    '/buscar/{vertical}': {
      get: {
        tags: ['Búsqueda'],
        summary: 'Buscar en un vertical',
        description:
          'Es la que usa el front: una request por vertical, para que cada sección pinte apenas tiene su respuesta. `origen` sólo aplica a `vuelos`. `origen` y `destino` son un código de aeropuerto (`EZE`) o de ciudad (`BUE`, que busca en todos sus aeropuertos).',
        operationId: 'buscarVertical',
        parameters: [
          ruta('vertical', 'Qué se busca.', { type: 'string', enum: VERTICALES }),
          parametro('origen', IATA, 'Sólo vuelos. Aeropuerto o ciudad de salida.'),
          parametro('destino', IATA, 'Aeropuerto o ciudad de llegada (en hospedaje y traslado, la ciudad donde se aloja o te recogen).', { required: true }),
          parametro('ida', FECHA, 'Fecha de salida (en hospedaje, de entrada).', { required: true }),
          parametro('vuelta', FECHA, 'Fecha de regreso (en hospedaje, de salida: debe ser posterior a `ida`).'),
          parametro('pasajeros', { type: 'integer', minimum: 1, maximum: 9, default: 1 }, 'Cantidad de pasajeros.'),
          { $ref: '#/components/parameters/Agencia' },
        ],
        responses: {
          200: json(ref('RespuestaBusqueda'), 'Resultados (posiblemente de la caché, ver `cacheado`).'),
          400: json(ref('Rechazo'), 'La búsqueda no tiene sentido (`mismo_lugar`, `lugar_desconocido`, `solicitud_invalida`). El servicio está sano: no cuenta para el circuit breaker.'),
          503: json(ref('NoDisponible'), 'El vertical no respondió, falló, está apagado o su circuito está abierto.'),
        },
      },
    },
    '/buscar': {
      get: {
        tags: ['Búsqueda'],
        summary: 'Buscar en todos los verticales a la vez',
        description:
          'Forma canónica del agregador; el front no la usa pero sirve para probarlo con `curl`. **Siempre responde 200**, aunque hayan fallado todos: el fallo parcial es el resultado, no un error de la request.',
        operationId: 'buscarCombinada',
        parameters: [
          parametro('origen', IATA, 'Aeropuerto o ciudad de salida.'),
          parametro('destino', IATA, 'Destino.', { required: true }),
          parametro('ida', FECHA, 'Fecha de salida.', { required: true }),
          parametro('vuelta', FECHA, 'Fecha de regreso.'),
          parametro('pasajeros', { type: 'integer', minimum: 1, maximum: 9 }, 'Cantidad de pasajeros.'),
        ],
        responses: { 200: json(ref('BusquedaCombinada'), 'Un resultado por vertical y la lista de los no disponibles.') },
      },
    },
    '/lugares': {
      get: {
        tags: ['Búsqueda'],
        summary: 'Catálogo de ciudades y aeropuertos',
        description:
          'Ciudades con sus aeropuertos y si tienen vuelos, para el buscador. Comprimible con gzip (de ~900 KB a ~130 KB). La forma anterior —aeropuertos sueltos y destinos directos— sigue en `/api/lugares` (sin versión), deprecada.',
        operationId: 'lugares',
        responses: { 200: json(ref('CatalogoCiudades'), 'El catálogo.'), 503: error('El servicio de vuelos no está disponible y no hay una copia.') },
      },
    },
    '/reservas': {
      post: {
        tags: ['Reservas'],
        summary: 'Reservar uno o más vuelos',
        description: [
          'Llamada **síncrona**: el agregador llama a vuelos y espera (hasta 2,5 s) porque el usuario necesita saber en ese momento si consiguió el asiento. Después publica el evento `reserva_confirmada` en una cola (Redis Streams) y responde **sin esperar** a quien lo consuma.',
          '',
          'La cabecera `Idempotency-Key` es obligatoria. Con un timeout (503) no se sabe si la reserva se hizo: **reintentar con la misma clave es seguro** — si ya existía se devuelve la misma (200, `repetida: true`) sin descontar otro asiento. El descuento de cupo es atómico: nunca se vende más que la capacidad.',
        ].join('\n'),
        operationId: 'reservar',
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            description: 'Identifica el pedido; es el `reserva_id`. Un UUID por intento de compra, reusado en cada reintento.',
            schema: { type: 'string', maxLength: 128 },
          },
        ],
        security: [{}, ...sesion],
        requestBody: { required: true, content: { 'application/json': { schema: ref('PedidoReserva') } } },
        responses: {
          201: json(ref('ReservaCreada'), 'Reserva creada.'),
          200: json(ref('ReservaCreada'), 'La `Idempotency-Key` ya existía: se devuelve esa reserva, con `repetida: true`.'),
          400: error('Falta la `Idempotency-Key` o el pedido es inválido.'),
          404: error('El vuelo no existe o no se puede reservar acá (las ofertas de un proveedor externo no tienen cupo local). `motivo: vuelo_desconocido`.'),
          409: json(ref('SinCupo'), 'No quedan asientos suficientes (`motivo: sin_cupo`).'),
          422: error('La `Idempotency-Key` ya se usó para otro pedido (`motivo: clave_reutilizada`), o el vuelo ya salió (`motivo: vuelo_pasado`).'),
          503: json(ref('ReservaNoConfirmada'), 'Vuelos no respondió. Reintentar con la misma clave.'),
        },
      },
    },
    '/reservas/{id}': {
      get: {
        tags: ['Reservas'],
        summary: 'Ver una reserva y el estado de su aviso',
        description: 'Además de la reserva, el estado del aviso de confirmación (el canal asíncrono): `enviada`, `pendiente` o `no_disponible` si el servicio de notificaciones no responde.',
        operationId: 'leerReserva',
        parameters: [ruta('id', 'El `reserva_id` (la `Idempotency-Key` con la que se hizo).')],
        responses: { 200: json(ref('ReservaConAviso'), 'La reserva.'), 404: error('No existe.'), 503: error('Vuelos no responde.') },
      },
    },
    '/tenant/config': {
      get: {
        tags: ['Cuenta'],
        summary: 'Marca y verticales de la agencia',
        description: 'Marca blanca: branding y verticales habilitados de la agencia (la del usuario si hay sesión; si no, la de `x-agencia-id`). Abierta a invitados.',
        operationId: 'tenantConfig',
        parameters: [{ $ref: '#/components/parameters/Agencia' }],
        security: [{}, ...sesion],
        responses: { 200: json(ref('Agencia'), 'La agencia.'), 404: error('No existe esa agencia.'), 503: error('El servicio de usuarios no responde.') },
      },
    },
    '/auth/registro': {
      post: {
        tags: ['Cuenta'],
        summary: 'Crear una cuenta de cliente',
        operationId: 'registro',
        parameters: [{ $ref: '#/components/parameters/Agencia' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'nombre'],
                properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 }, nombre: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: json(ref('CodigoDeVerificacion'), 'Cuenta creada; queda pendiente verificar el email.'),
          400: error('Datos inválidos.'),
          409: error('Ya existe una cuenta con ese email.'),
        },
      },
    },
    '/auth/reenviar-codigo': {
      post: {
        tags: ['Cuenta'],
        summary: 'Reenviar el código de verificación',
        operationId: 'reenviarCodigo',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } } },
        responses: { 200: json(ref('CodigoDeVerificacion'), 'Código reenviado.'), 400: error('El email ya está verificado.'), 404: error('No existe esa cuenta.') },
      },
    },
    '/auth/verificar-email': {
      post: {
        tags: ['Cuenta'],
        summary: 'Verificar el email y entrar',
        operationId: 'verificarEmail',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email', 'codigo'], properties: { email: { type: 'string', format: 'email' }, codigo: { type: 'string' } } } } },
        },
        responses: { 200: json(ref('Sesion'), 'Verificado: devuelve la sesión.'), 400: error('Código inválido o vencido.') },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Cuenta'],
        summary: 'Iniciar sesión',
        description: '`identificador` es un email (clientes, exige email verificado) o un `username` (administradores).',
        operationId: 'login',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['identificador', 'password'], properties: { identificador: { type: 'string' }, password: { type: 'string' } } } } },
        },
        responses: {
          200: json(ref('Sesion'), 'La sesión: un JWT firmado por el agregador.'),
          401: error('Credenciales inválidas (`motivo: credenciales_invalidas`).'),
          403: error('Falta verificar el email (`motivo: email_no_verificado`).'),
          503: error('El servicio de usuarios no responde.'),
        },
      },
    },
    '/perfil': {
      get: {
        tags: ['Cuenta'],
        summary: 'Mi perfil',
        operationId: 'leerPerfil',
        security: sesion,
        responses: { 200: json(ref('Perfil'), 'El perfil.'), 401: respuestasSesion[401] },
      },
      put: {
        tags: ['Cuenta'],
        summary: 'Editar mi perfil',
        description: 'Actualización parcial: se manda sólo lo que cambió.',
        operationId: 'editarPerfil',
        security: sesion,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { nombre: { type: 'string' }, preferencias: { type: 'object', additionalProperties: { type: 'boolean' } } } },
            },
          },
        },
        responses: { 200: json(ref('Perfil'), 'El perfil actualizado.'), 401: respuestasSesion[401] },
      },
    },
    '/admin/config': {
      get: {
        tags: ['Administración'],
        summary: 'Qué verticales están activos en mi agencia',
        description: 'Exige el permiso `gestion_verticales`.',
        operationId: 'leerConfig',
        security: sesion,
        responses: { 200: json(ref('ConfigVerticales'), 'La configuración.'), ...respuestasSesion },
      },
    },
    '/admin/config/{vertical}': {
      put: {
        tags: ['Administración'],
        summary: 'Prender o apagar un vertical',
        description: 'Exige `gestion_verticales`. Queda registrado en la auditoría.',
        operationId: 'cambiarConfig',
        parameters: [ruta('vertical', 'El vertical.', { type: 'string', enum: VERTICALES })],
        security: sesion,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['estado'], properties: { estado: { type: 'string', enum: ['activo', 'inactivo'] }, motivo: { type: 'string' } } } } },
        },
        responses: { 200: json(ref('ConfigVerticales'), 'La configuración resultante.'), 400: error('Estado inválido.'), ...respuestasSesion },
      },
    },
    '/admin/preferencias-agregadas': {
      get: {
        tags: ['Administración'],
        summary: 'Cuántos usuarios quieren cada vertical',
        operationId: 'preferenciasAgregadas',
        security: sesion,
        responses: {
          200: json({ type: 'object', required: ['total_usuarios'], properties: { total_usuarios: { type: 'integer' } }, additionalProperties: { type: 'integer' } }, 'Conteos por vertical.'),
          ...respuestasSesion,
        },
      },
    },
    '/admin/auditoria': {
      get: {
        tags: ['Administración'],
        summary: 'Últimos cambios de configuración',
        description: 'Los últimos 50: quién, cuándo, qué vertical y de qué estado a cuál.',
        operationId: 'auditoria',
        security: sesion,
        responses: { 200: json({ type: 'array', items: { type: 'object' } }, 'Los cambios.'), ...respuestasSesion },
      },
    },
    '/admin/administradores': {
      get: {
        tags: ['Administración'],
        summary: 'Administradores de mi agencia',
        description: 'Exige `gestion_usuarios`.',
        operationId: 'listarAdministradores',
        security: sesion,
        responses: { 200: json({ type: 'array', items: ref('Administrador') }, 'Los administradores.'), ...respuestasSesion },
      },
      post: {
        tags: ['Administración'],
        summary: 'Crear un administrador',
        description: 'Exige `gestion_usuarios`. Siempre de la agencia de quien lo pide.',
        operationId: 'crearAdministrador',
        security: sesion,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: { username: { type: 'string' }, password: { type: 'string', minLength: 8 }, permisos: { type: 'array', items: { type: 'string', enum: ['gestion_verticales', 'gestion_usuarios'] } } },
              },
            },
          },
        },
        responses: { 200: json({ type: 'array', items: ref('Administrador') }, 'La lista actualizada.'), 400: error('Datos inválidos.'), 409: error('El usuario ya existe.'), ...respuestasSesion },
      },
    },
    '/admin/administradores/{id}/permisos': {
      put: {
        tags: ['Administración'],
        summary: 'Cambiar los permisos de un administrador',
        operationId: 'cambiarPermisos',
        parameters: [ruta('id', 'Id del administrador.')],
        security: sesion,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['permisos'], properties: { permisos: { type: 'array', items: { type: 'string', enum: ['gestion_verticales', 'gestion_usuarios'] } } } } } },
        },
        responses: { 200: json({ type: 'array', items: ref('Administrador') }, 'La lista actualizada.'), 404: error('No existe en tu agencia.'), ...respuestasSesion },
      },
    },
    '/agencias/{id}/registro': {
      post: {
        tags: ['Sistema'],
        summary: 'Sincronizar la bitácora de un nodo de agencia',
        description: 'No la usa el front: la usa un nodo de agencia para volcar su bitácora local de búsquedas al nodo central.',
        operationId: 'sincronizarRegistro',
        parameters: [ruta('id', 'Id de la agencia.')],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { entradas: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { 200: json({ type: 'object', properties: { insertadas: { type: 'integer' } } }, 'Cuántas entradas se guardaron.') },
      },
    },
    '/sistema/servicios': {
      get: {
        tags: ['Sistema'],
        summary: 'Servicios registrados y su estado de salud',
        description: 'Lo que ve el registro de servicios: cada instancia, su dirección y si pasa su health check. Exige rol de administrador.',
        operationId: 'sistemaServicios',
        security: sesion,
        responses: { 200: json(ref('EstadoDelSistema'), 'Servicios e instancias.'), ...respuestasSesion },
      },
    },
    '/openapi.json': {
      get: { tags: ['Sistema'], summary: 'Esta descripción, en JSON', operationId: 'openapi', responses: { 200: json({ type: 'object' }, 'El documento OpenAPI.') } },
    },
    '/docs': {
      get: {
        tags: ['Sistema'],
        summary: 'Documentación interactiva (Swagger UI)',
        operationId: 'docs',
        responses: { 200: { description: 'Página HTML.', content: { 'text/html': { schema: { type: 'string' } } } } },
      },
    },
    '/demo/salud/{vertical}': {
      put: {
        tags: ['Sistema'],
        summary: 'Imponer un estado de salud simulado (sólo demostración)',
        description:
          'Interruptor de fallos para la defensa: sirve para mostrar el servicio *colgado*, que no se puede reproducir apagando el proceso. Código de demostración, no forma parte del sistema.',
        operationId: 'demoSalud',
        parameters: [ruta('vertical', 'El vertical.', { type: 'string', enum: VERTICALES })],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['estado'], properties: { estado: { type: 'string', enum: ['ok', 'lento', 'caido', 'colgado'] } } } } } },
        responses: { 200: json({ type: 'object' }, 'El estado resultante.'), 404: error('Vertical desconocido.'), 503: error('No se pudo hablar con el vertical.') },
      },
    },
    '/salud': {
      servers: [{ url: '/' }],
      get: {
        tags: ['Sistema'],
        summary: 'Estado de todo el sistema, de un vistazo',
        description: 'Operativa, fuera de `/api`: no se versiona. Consulta a cada servicio y devuelve su detalle.',
        operationId: 'salud',
        responses: { 200: json(ref('Salud'), 'Un servicio por clave, cada uno `ok` o `unavailable`.') },
      },
    },
    '/salud/live': {
      servers: [{ url: '/' }],
      get: {
        tags: ['Sistema'],
        summary: 'Liveness: ¿el proceso responde?',
        description: 'No depende de nada externo. Si falla, hay que **reiniciar** el proceso. Existe igual en todos los servicios.',
        operationId: 'saludLive',
        responses: { 200: json({ type: 'object', required: ['estado'], properties: { servicio: { type: 'string' }, estado: { type: 'string', enum: ['vivo'] } } }, 'Vivo.') },
      },
    },
    '/salud/ready': {
      servers: [{ url: '/' }],
      get: {
        tags: ['Sistema'],
        summary: 'Readiness: ¿puede atender tráfico ahora?',
        description: 'Consulta las dependencias. Si falla (503), hay que **dejar de mandarle tráfico**, no reiniciarlo. Es lo que mira el registro de servicios.',
        operationId: 'saludReady',
        responses: {
          200: json({ type: 'object', required: ['estado'], properties: { servicio: { type: 'string' }, estado: { type: 'string', enum: ['listo'] } } }, 'Listo.'),
          503: json({ type: 'object', required: ['estado'], properties: { servicio: { type: 'string' }, estado: { type: 'string', enum: ['no_listo', 'cerrando'] }, motivo: { type: 'string' } } }, 'No listo.'),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'El `token` que devuelven `/auth/login` y `/auth/verificar-email`. Sin él se es invitado: la búsqueda funciona igual.' },
    },
    parameters: {
      Agencia: {
        name: 'x-agencia-id',
        in: 'header',
        required: false,
        description: 'Marca blanca: de qué agencia es el front que pregunta. Con sesión manda la agencia del token, no esta cabecera. Por defecto `ag-demo`.',
        schema: { type: 'string', example: 'ag-demo' },
      },
    },
    schemas: {
      Precio: {
        type: 'object',
        required: ['monto', 'moneda'],
        properties: { monto: { type: 'number', example: 1900000 }, moneda: { type: 'string', description: 'ISO 4217 (ARS, USD, EUR…).', example: 'ARS' } },
      },
      Segmento: {
        type: 'object',
        description: 'Un tramo de un itinerario con escalas.',
        required: ['origen', 'destino', 'salida', 'llegada', 'duracion_min', 'aerolinea', 'codigo_aerolinea'],
        properties: {
          origen: IATA,
          destino: IATA,
          salida: RELOJ,
          llegada: RELOJ,
          duracion_min: { type: 'integer' },
          aerolinea: { type: 'string' },
          codigo_aerolinea: { type: 'string' },
          espera_min: { type: 'integer', description: 'Cuánto se espera en el aeropuerto de llegada hasta el próximo vuelo. El último tramo no lo trae.' },
          cambio_aeropuerto: {
            type: 'boolean',
            description: 'Verdadero si el próximo vuelo sale de **otro aeropuerto de la misma ciudad** (llegás a Aeroparque y salís de Ezeiza): el traslado por tierra corre por cuenta del pasajero. Campo opcional.',
          },
        },
      },
      Vuelo: {
        type: 'object',
        required: ['id', 'aerolinea', 'codigo_aerolinea', 'origen', 'destino', 'salida', 'llegada', 'duracion_min', 'escalas', 'precio'],
        properties: {
          id: { type: 'string', description: 'Único dentro del vertical. Un itinerario con escalas junta los ids de sus tramos con `~`.', example: 'IBEZEMAD-1-2026-11-20' },
          aerolinea: { type: 'string', description: 'Con varias aerolíneas se nombran todas, unidas con " + ".' },
          codigo_aerolinea: { type: 'string' },
          origen: IATA,
          destino: IATA,
          salida: RELOJ,
          llegada: RELOJ,
          duracion_min: { type: 'integer', description: 'Duración real de punta a punta, escalas incluidas.' },
          escalas: { type: 'integer', minimum: 0 },
          precio: ref('Precio'),
          segmentos: { type: 'array', items: ref('Segmento'), description: 'Campo opcional (agregado sin romper a nadie): sólo cuando hay escalas.' },
        },
      },
      Alojamiento: {
        type: 'object',
        required: ['id', 'nombre', 'ciudad', 'estrellas', 'puntaje', 'opiniones', 'servicios', 'noches', 'precio'],
        properties: {
          id: { type: 'string' },
          nombre: { type: 'string' },
          ciudad: { type: 'string' },
          estrellas: { type: 'integer' },
          puntaje: { type: 'number' },
          opiniones: { type: 'integer' },
          servicios: { type: 'array', items: { type: 'string' } },
          noches: { type: 'integer' },
          precio: ref('Precio'),
        },
      },
      Traslado: {
        type: 'object',
        required: ['id', 'proveedor', 'vehiculo', 'capacidad', 'precio'],
        properties: { id: { type: 'string' }, proveedor: { type: 'string' }, vehiculo: { type: 'string' }, capacidad: { type: 'integer' }, precio: ref('Precio') },
      },
      RespuestaBusqueda: {
        type: 'object',
        required: ['vertical', 'estado', 'generado_en', 'items'],
        properties: {
          vertical: { type: 'string', enum: VERTICALES },
          estado: { type: 'string', enum: ['ok'] },
          generado_en: { type: 'string', format: 'date-time' },
          items: { type: 'array', items: { anyOf: [ref('Vuelo'), ref('Alojamiento'), ref('Traslado')] } },
          cacheado: { type: 'boolean', description: 'Verdadero si son los datos de la última búsqueda buena (circuito abierto): transparencia de replicación, con su costo a la vista.' },
          edad_ms: { type: 'integer', description: 'Antigüedad de los datos cacheados.' },
        },
      },
      NoDisponible: {
        type: 'object',
        required: ['vertical', 'estado', 'motivo', 'generado_en'],
        properties: {
          vertical: { type: 'string', enum: VERTICALES },
          estado: { type: 'string', enum: ['unavailable'] },
          motivo: { type: 'string', enum: MOTIVOS_NO_DISPONIBLE },
          generado_en: { type: 'string', format: 'date-time' },
        },
      },
      Rechazo: {
        type: 'object',
        required: ['vertical', 'estado', 'motivo', 'generado_en'],
        properties: {
          vertical: { type: 'string', enum: VERTICALES },
          estado: { type: 'string', enum: ['rejected'] },
          motivo: { type: 'string', enum: ['mismo_lugar', 'lugar_desconocido', 'solicitud_invalida'] },
          error: { type: 'string' },
          generado_en: { type: 'string', format: 'date-time' },
        },
      },
      BusquedaCombinada: {
        type: 'object',
        required: ['generado_en', 'no_disponibles', 'vuelos', 'hospedaje', 'traslado'],
        properties: {
          generado_en: { type: 'string', format: 'date-time' },
          vuelos: { type: 'array', items: ref('Vuelo') },
          hospedaje: { type: 'array', items: ref('Alojamiento') },
          traslado: { type: 'array', items: ref('Traslado') },
          no_disponibles: {
            type: 'array',
            description: 'Un vertical acá tiene su clave presente y en `[]`: nunca se omite.',
            items: { type: 'object', required: ['vertical', 'motivo'], properties: { vertical: { type: 'string' }, motivo: { type: 'string' } } },
          },
          aviso: { type: 'string' },
        },
      },
      Aeropuerto: {
        type: 'object',
        required: ['iata', 'nombre', 'vuelos'],
        properties: { iata: IATA, nombre: { type: 'string', example: 'Ezeiza' }, vuelos: { type: 'boolean' } },
      },
      Ciudad: {
        type: 'object',
        required: ['codigo', 'nombre', 'pais', 'trafico', 'vuelos', 'aeropuertos'],
        properties: {
          codigo: { ...IATA, description: 'Código de la ciudad (`BUE`) o, para una ciudad de un solo aeropuerto, el del aeropuerto.', example: 'BUE' },
          nombre: { type: 'string', example: 'Buenos Aires' },
          pais: { type: 'string', example: 'Argentina' },
          trafico: { type: 'integer', description: 'Rutas que tocan sus aeropuertos; ordena las sugerencias.' },
          vuelos: { type: 'boolean', description: 'Si algún aeropuerto de la ciudad tiene vuelos.' },
          aeropuertos: { type: 'array', items: ref('Aeropuerto') },
        },
      },
      CatalogoCiudades: {
        type: 'object',
        required: ['version', 'ciudades'],
        properties: { version: { type: 'integer', example: 1 }, generado_en: { type: 'string', format: 'date-time' }, ciudades: { type: 'array', items: ref('Ciudad') } },
      },
      PedidoReserva: {
        type: 'object',
        required: ['vuelos'],
        properties: {
          vuelos: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' }, description: 'Ids de vuelo tal como salieron de la búsqueda: uno por tramo (ida y vuelta, multidestino).' },
          pasajeros: { type: 'integer', minimum: 1, maximum: 9, default: 1 },
          contacto: { type: 'object', properties: { email: { type: 'string', format: 'email' } } },
          nombres: { type: 'array', items: { type: 'string' }, description: 'Sólo nombres: los documentos no viajan al servidor.' },
        },
      },
      Reserva: {
        type: 'object',
        required: ['reserva_id', 'codigo', 'estado', 'vuelos', 'tramos', 'pasajeros', 'creada_en', 'repetida'],
        properties: {
          reserva_id: { type: 'string', description: 'La `Idempotency-Key`.' },
          codigo: { type: 'string', pattern: '^[0-9A-F]{6}$', example: 'F59C8A' },
          estado: { type: 'string', enum: ['confirmada'] },
          vuelos: { type: 'array', items: { type: 'string' } },
          tramos: { type: 'array', items: { type: 'string' }, description: 'Los tramos individuales cuyo cupo se descontó.' },
          pasajeros: { type: 'integer' },
          email: { type: 'string' },
          creada_en: { type: 'string', format: 'date-time' },
          repetida: { type: 'boolean', description: 'Verdadero si es una repetición de un pedido anterior con la misma clave.' },
        },
      },
      ReservaCreada: {
        allOf: [
          ref('Reserva'),
          {
            type: 'object',
            required: ['evento_encolado'],
            properties: { evento_encolado: { type: 'boolean', description: 'Falso si Redis estaba caído: la reserva igual se confirma, pero el aviso no se encoló.' } },
          },
        ],
      },
      ReservaConAviso: {
        allOf: [
          ref('Reserva'),
          {
            type: 'object',
            required: ['notificacion'],
            properties: {
              notificacion: {
                type: 'object',
                required: ['estado'],
                properties: { estado: { type: 'string', enum: ['enviada', 'pendiente', 'no_disponible'] }, enviada_en: { type: 'string', format: 'date-time' } },
              },
            },
          },
        ],
      },
      SinCupo: {
        type: 'object',
        required: ['error', 'motivo', 'vuelo_id'],
        properties: { error: { type: 'string' }, motivo: { type: 'string', enum: ['sin_cupo'] }, vuelo_id: { type: 'string' }, libres: { type: 'integer' } },
      },
      ReservaNoConfirmada: {
        type: 'object',
        required: ['error', 'motivo', 'reintentable'],
        properties: { error: { type: 'string' }, motivo: { type: 'string' }, reintentable: { type: 'boolean' }, nota: { type: 'string' } },
      },
      Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' }, motivo: { type: 'string' } } },
      Agencia: {
        type: 'object',
        required: ['id', 'nombre', 'color_primario', 'verticales_habilitados'],
        properties: {
          id: { type: 'string', example: 'ag-demo' },
          nombre: { type: 'string' },
          color_primario: { type: 'string', example: '#1565c0' },
          descripcion: { type: 'string' },
          verticales_habilitados: { type: 'array', items: { type: 'string', enum: VERTICALES } },
          presupuestos_ms: {
            type: 'object',
            description: 'Cuánto espera el agregador a cada vertical antes de darlo por no disponible. El cliente se corta un poco después. Campo opcional (agregado sin romper a nadie).',
            additionalProperties: { type: 'integer' },
            example: { vuelos: 2500, hospedaje: 2500, traslado: 2500 },
          },
        },
      },
      Usuario: {
        type: 'object',
        required: ['id', 'nombre', 'rol', 'agencia_id', 'permisos'],
        properties: {
          id: { type: 'string' },
          nombre: { type: 'string' },
          rol: { type: 'string', enum: ['usuario', 'admin'] },
          agencia_id: { type: 'string' },
          email: { type: 'string' },
          username: { type: 'string' },
          permisos: { type: 'array', items: { type: 'string' } },
        },
      },
      Sesion: { type: 'object', required: ['token', 'usuario'], properties: { token: { type: 'string' }, usuario: ref('Usuario') } },
      CodigoDeVerificacion: {
        type: 'object',
        required: ['ok', 'email'],
        properties: { ok: { type: 'boolean' }, email: { type: 'string' }, codigo_demo: { type: 'string', description: 'Sólo con el proveedor de email ficticio: el código que uno real mandaría por correo.' } },
      },
      Perfil: {
        type: 'object',
        required: ['id', 'nombre', 'rol', 'agencia_id', 'preferencias'],
        properties: {
          id: { type: 'string' },
          nombre: { type: 'string' },
          rol: { type: 'string' },
          agencia_id: { type: 'string' },
          preferencias: { type: 'object', additionalProperties: { type: 'boolean' } },
        },
      },
      ConfigVerticales: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['estado'],
          properties: { estado: { type: 'string', enum: ['activo', 'inactivo'] }, motivo: { type: 'string' } },
        },
      },
      Administrador: {
        type: 'object',
        required: ['id', 'username', 'permisos'],
        properties: { id: { type: 'string' }, nombre: { type: 'string' }, username: { type: 'string' }, permisos: { type: 'array', items: { type: 'string' } } },
      },
      Instancia: {
        type: 'object',
        required: ['id', 'url', 'estado'],
        properties: {
          id: { type: 'string', example: 'vuelos@4001' },
          url: { type: 'string', example: 'http://localhost:4001' },
          estado: { type: 'string', enum: ['pasando', 'critico', 'desconocido'], description: 'Resultado de su último health check (`/salud/ready`).' },
          detalle: { type: 'string' },
          latencia_ms: { type: 'integer' },
          registrada_en: { type: 'string', format: 'date-time' },
          ultimo_latido: { type: 'string', format: 'date-time' },
          ultimo_chequeo: { type: 'string', format: 'date-time' },
        },
      },
      EstadoDelSistema: {
        type: 'object',
        required: ['registro', 'servicios'],
        properties: {
          registro: { type: 'string', enum: ['disponible', 'no_disponible'], description: 'Si el registro de servicios responde. Si no, el sistema sigue con las direcciones fijas de configuración.' },
          servicios: { type: 'object', additionalProperties: { type: 'array', items: ref('Instancia') } },
        },
      },
      Salud: {
        type: 'object',
        required: ['servicio', 'servicios'],
        properties: {
          servicio: { type: 'string' },
          generado_en: { type: 'string', format: 'date-time' },
          servicios: { type: 'object', additionalProperties: { type: 'object', required: ['estado'], properties: { estado: { type: 'string', enum: ['ok', 'unavailable'] } } } },
        },
      },
    },
  },
}
