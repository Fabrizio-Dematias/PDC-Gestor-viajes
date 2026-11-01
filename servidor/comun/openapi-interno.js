import { OPENAPI } from '../agregador/openapi.js'

/**
 * Descripción formal de los contratos **entre servicios**, en OpenAPI 3.0.
 *
 * `servidor/agregador/openapi.js` describe la API pública (front →
 * agregador). Esta describe lo que hay detrás: lo que el agregador, el
 * registro y el nodo de agencia les piden a los demás servicios. Cada
 * servicio es un `server` y un `tag`; las formas que ya define el
 * contrato público (`Vuelo`, `Reserva`, `Instancia`…) se reutilizan, no
 * se copian, para que una sola definición valga para los dos lados.
 *
 * Se genera a `docs/openapi-interno.yaml` con `npm run docs:openapi`,
 * junto con el público.
 *
 * Las rutas de servicios internos no se versionan con `/api/v1` (salvo
 * las del registro): no tienen clientes de afuera, y un cambio se
 * despliega a la vez en quien llama y en quien responde. Lo que sí rige
 * es la misma tabla: agregar un campo opcional no rompe; quitar,
 * renombrar o cambiar un tipo, sí.
 */

const ref = (nombre) => ({ $ref: `#/components/schemas/${nombre}` })
const json = (schema, description) => ({ description, content: { 'application/json': { schema } } })
const error = (description) => json(ref('Error'), description)
const query = (name, schema, description, required = false) => ({ name, in: 'query', required, description, schema })
const ruta = (name, description, schema = { type: 'string' }) => ({ name, in: 'path', required: true, description, schema })
const cabecera = (name, description, required = false) => ({ name, in: 'header', required, description, schema: { type: 'string' } })
const cuerpo = (schema) => ({ required: true, content: { 'application/json': { schema } } })

const FECHA = { type: 'string', format: 'date', example: '2026-11-20' }
const PASAJEROS = { type: 'integer', minimum: 1, maximum: 9, default: 1 }
const USUARIO = cabecera('x-usuario-id', 'Id del usuario, ya verificado por el agregador a partir del JWT. Este servicio no sabe qué es un token.', true)
const AGENCIA = cabecera('x-agencia-id', 'Agencia de quien pide, resuelta por el agregador (la del token, si hay sesión).')

/** Rutas de demostración que comparten los tres verticales
 *  (`servidor/comun/salud-demo.js`). No forman parte del sistema. */
const rutasDemo = (tag = 'Demostración') => ({
  '/demo/salud': {
    put: {
      tags: [tag],
      summary: 'Simular un estado de salud (demostración)',
      operationId: 'demo_salud',
      requestBody: cuerpo({ type: 'object', required: ['estado'], properties: { estado: { type: 'string', enum: ['ok', 'lento', 'caido', 'colgado'] } } }),
      responses: { 200: json({ type: 'object', properties: { servicio: { type: 'string' }, estado: { type: 'string' } } }, 'Estado aplicado.'), 400: error('Estado inválido.') },
    },
  },
  '/demo/listo': {
    put: {
      tags: [tag],
      summary: 'Declararse listo o no listo sin reiniciar (demostración)',
      operationId: 'demo_listo',
      requestBody: cuerpo({ type: 'object', required: ['listo'], properties: { listo: { type: 'boolean' } } }),
      responses: { 200: json({ type: 'object', properties: { servicio: { type: 'string' }, listo: { type: 'boolean' } } }, 'Readiness aplicada: con `false`, `/salud/ready` responde 503.') },
    },
  },
})

/** Búsqueda en un vertical: la misma forma en los tres. */
const busqueda = (vertical, item, parametros) => ({
  get: {
    tags: [vertical],
    summary: `Buscar ${vertical}`,
    operationId: `${vertical}_buscar`,
    parameters: parametros,
    responses: {
      200: json(
        {
          type: 'object',
          required: ['vertical', 'estado', 'generado_en', 'items'],
          properties: {
            vertical: { type: 'string', enum: [vertical] },
            estado: { type: 'string', enum: ['ok'] },
            generado_en: { type: 'string', format: 'date-time' },
            items: { type: 'array', items: ref(item) },
          },
        },
        'Resultados (`[]` si no hay, nunca `null`).',
      ),
      400: error('Criterios inválidos (`motivo: lugar_desconocido`, `mismo_lugar`…). No cuenta como fallo del servicio.'),
      503: json(ref('VerticalNoDisponible'), 'La fuente de datos falló o el servicio está simulando una caída. Siempre con cuerpo JSON, nunca un 500 pelado.'),
    },
  },
})

const sondas = {
  '/salud/live': {
    get: {
      tags: ['Sondas'],
      summary: '¿El proceso responde? (liveness)',
      operationId: 'live',
      description: 'No depende de nada externo: si falla, hay que reiniciar el proceso.',
      responses: { 200: json({ type: 'object', properties: { servicio: { type: 'string' }, estado: { type: 'string', enum: ['vivo'] } } }, 'Vivo.') },
    },
  },
  '/salud/ready': {
    get: {
      tags: ['Sondas'],
      summary: '¿Puede atender tráfico ahora? (readiness)',
      operationId: 'ready',
      description: 'Consulta sus dependencias (base, Redis). Si falla, se le deja de mandar tráfico pero no se lo reinicia. Es lo que consulta el registro en cada health check.',
      responses: {
        200: json({ type: 'object', properties: { servicio: { type: 'string' }, estado: { type: 'string', enum: ['listo'] } } }, 'Listo.'),
        503: json({ type: 'object', properties: { servicio: { type: 'string' }, estado: { type: 'string', enum: ['no_listo', 'cerrando'] }, motivo: { type: 'string' } } }, 'No listo.'),
      },
    },
  },
}

export const OPENAPI_INTERNO = {
  openapi: '3.0.3',
  info: {
    title: 'Gestor de viajes — contratos entre servicios',
    version: '1.0.0',
    description: [
      'Lo que cada servicio interno expone a los demás componentes del sistema. La API pública (front → agregador) está en `docs/openapi.yaml`.',
      '',
      'Quién llama a quién: el **agregador** llama a vuelos, hospedaje, traslado, usuarios y notificaciones; **todos** se anotan en el **registro**, que a su vez consulta `/salud/ready` de cada instancia; el **nodo de agencia** sincroniza su bitácora con el agregador.',
      '',
      'Las direcciones no están fijas: se descubren en el registro (`GET /api/v1/servicios/{nombre}?solo_sanas=true`). Las de `servers` son las de desarrollo por defecto.',
      '',
      'Se genera desde `servidor/comun/openapi-interno.js` — no editar el YAML a mano.',
    ].join('\n'),
  },
  servers: [
    { url: 'http://localhost:4001', description: 'vuelos' },
    { url: 'http://localhost:4002', description: 'hospedaje' },
    { url: 'http://localhost:4003', description: 'usuarios' },
    { url: 'http://localhost:4004', description: 'traslado' },
    { url: 'http://localhost:4005', description: 'notificaciones' },
    { url: 'http://localhost:4006', description: 'registro' },
    { url: 'http://localhost:4100', description: 'nodo-agencia' },
  ],
  tags: [
    { name: 'vuelos', description: 'Puerto 4001. Lo llama el agregador: búsqueda, catálogo de ciudades y reservas.' },
    { name: 'hospedaje', description: 'Puerto 4002. Lo llama el agregador.' },
    { name: 'traslado', description: 'Puerto 4004. Lo llama el agregador.' },
    { name: 'usuarios', description: 'Puerto 4003. Lo llama el agregador, que ya resolvió la sesión: recibe la identidad en `x-usuario-id`/`x-agencia-id`.' },
    { name: 'notificaciones', description: 'Puerto 4005. Consume la cola de reservas; el agregador le pregunta si el aviso ya salió.' },
    { name: 'registro', description: 'Puerto 4006. Registro de servicios: todos se anotan, el agregador descubre.' },
    { name: 'nodo-agencia', description: 'Puerto 4100. Bitácora local de búsquedas de una agencia (la llama el front, sin esperar).' },
    { name: 'Sondas', description: 'Las exponen **todos** los servicios.' },
    { name: 'Demostración', description: 'Interruptores de fallos de vuelos, hospedaje y traslado (los usa el panel de fallos vía el agregador). No forman parte del sistema.' },
  ],
  paths: {
    ...sondas,

    // --- vuelos ---
    '/api/vuelos': busqueda('vuelos', 'Vuelo', [
      query('origen', { type: 'string', example: 'BUE' }, 'Código de ciudad o de aeropuerto.', true),
      query('destino', { type: 'string', example: 'MAD' }, 'Código de ciudad o de aeropuerto.', true),
      query('ida', FECHA, 'Fecha del tramo.', true),
      query('pasajeros', PASAJEROS, 'Cantidad de pasajeros.'),
    ]),
    '/api/ciudades': {
      get: {
        tags: ['vuelos'],
        summary: 'Catálogo de ciudades con sus aeropuertos',
        operationId: 'vuelos_ciudades',
        description: 'El agregador lo sirve como `GET /api/v1/lugares`. Vuelos es el dueño del padrón.',
        responses: { 200: json(ref('CatalogoCiudades'), 'Catálogo.') },
      },
    },
    '/api/lugares': {
      get: {
        tags: ['vuelos'],
        summary: 'Catálogo anterior: aeropuertos sueltos y rutas directas (deprecado)',
        operationId: 'vuelos_lugares_v0',
        deprecated: true,
        responses: {
          200: json(
            {
              type: 'object',
              properties: {
                aeropuertos: { type: 'array', items: { type: 'object', properties: { iata: { type: 'string' }, nombre: { type: 'string' }, ciudad: { type: 'string' }, pais: { type: 'string' } } } },
                origenes: { type: 'array', items: { type: 'string' } },
                rutas: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
              },
            },
            'Aeropuertos y, por origen, los destinos con vuelo directo.',
          ),
        },
      },
    },
    '/api/reservas': {
      post: {
        tags: ['vuelos'],
        summary: 'Reservar (descuento atómico del cupo)',
        operationId: 'vuelos_reservar',
        parameters: [cabecera('Idempotency-Key', 'Id de la reserva. Repetir el pedido con la misma clave no descuenta otro asiento.', true)],
        requestBody: cuerpo(ref('PedidoReserva')),
        responses: {
          201: json(ref('Reserva'), 'Reserva creada.'),
          200: json(ref('Reserva'), 'La misma clave ya existía: se devuelve esa reserva (`repetida: true`).'),
          400: error('Falta la `Idempotency-Key` o el pedido es inválido.'),
          404: error('El vuelo no existe.'),
          409: json(ref('SinCupo'), 'No quedan asientos suficientes.'),
        },
      },
    },
    '/api/reservas/{id}': {
      get: {
        tags: ['vuelos'],
        summary: 'Leer una reserva',
        operationId: 'vuelos_leer_reserva',
        parameters: [ruta('id', 'La `Idempotency-Key` con que se creó.')],
        responses: { 200: json(ref('Reserva'), 'La reserva.'), 404: error('No existe (`motivo: reserva_desconocida`).') },
      },
    },
    '/api/cupos/{vueloId}': {
      get: {
        tags: ['vuelos'],
        summary: 'Cupo de un vuelo',
        operationId: 'vuelos_cupo',
        parameters: [ruta('vueloId', 'Id del vuelo.')],
        responses: { 200: json(ref('Cupo'), 'Capacidad, ocupados y libres.'), 404: error('El vuelo todavía no tiene cupo (`motivo: vuelo_desconocido`).') },
      },
    },
    ...rutasDemo(),

    // --- hospedaje ---
    '/api/hospedaje': busqueda('hospedaje', 'Alojamiento', [
      query('destino', { type: 'string', example: 'MAD' }, 'Código de ciudad.', true),
      query('ida', FECHA, 'Entrada.', true),
      query('vuelta', FECHA, 'Salida; posterior a `ida`.'),
      query('pasajeros', PASAJEROS, 'Huéspedes.'),
    ]),

    // --- traslado ---
    '/api/traslado': busqueda('traslado', 'Traslado', [
      query('destino', { type: 'string', example: 'MAD' }, 'Código de ciudad.', true),
      query('pasajeros', PASAJEROS, 'Pasajeros.'),
    ]),

    // --- usuarios ---
    '/api/auth/registro': {
      post: {
        tags: ['usuarios'],
        summary: 'Alta de cliente (queda pendiente de verificar el email)',
        operationId: 'usuarios_registro',
        parameters: [AGENCIA],
        requestBody: cuerpo({ type: 'object', required: ['email', 'nombre', 'password'], properties: { email: { type: 'string', format: 'email' }, nombre: { type: 'string' }, password: { type: 'string', minLength: 8 } } }),
        responses: { 200: json(ref('CodigoDeVerificacion'), 'Código enviado.'), 400: error('Datos inválidos.'), 409: error('Ya existe una cuenta con ese email.') },
      },
    },
    '/api/auth/reenviar-codigo': {
      post: {
        tags: ['usuarios'],
        summary: 'Reenviar el código de verificación',
        operationId: 'usuarios_reenviar_codigo',
        requestBody: cuerpo({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } }),
        responses: { 200: json(ref('CodigoDeVerificacion'), 'Código reenviado.'), 400: error('El email ya está verificado.'), 404: error('No existe una cuenta con ese email.') },
      },
    },
    '/api/auth/verificar-email': {
      post: {
        tags: ['usuarios'],
        summary: 'Verificar el email con el código',
        operationId: 'usuarios_verificar_email',
        description: 'Devuelve el usuario; el token lo firma el agregador, no este servicio.',
        requestBody: cuerpo({ type: 'object', required: ['email', 'codigo'], properties: { email: { type: 'string', format: 'email' }, codigo: { type: 'string' } } }),
        responses: { 200: json(ref('Usuario'), 'Email verificado.'), 400: error('Código inválido o vencido.') },
      },
    },
    '/api/auth/verificar-credenciales': {
      post: {
        tags: ['usuarios'],
        summary: 'Comprobar usuario y contraseña',
        operationId: 'usuarios_verificar_credenciales',
        description: 'Compara contra el hash scrypt guardado. Devuelve el usuario; el agregador firma el JWT con eso.',
        requestBody: cuerpo({ type: 'object', required: ['identificador', 'password'], properties: { identificador: { type: 'string', description: 'Email o nombre de usuario.' }, password: { type: 'string' } } }),
        responses: {
          200: json(ref('Usuario'), 'Credenciales válidas.'),
          401: error('Credenciales inválidas (`motivo: credenciales_invalidas`).'),
          403: error('Falta verificar el email (`motivo: email_no_verificado`).'),
        },
      },
    },
    '/api/perfil': {
      get: {
        tags: ['usuarios'],
        summary: 'Perfil y preferencias',
        operationId: 'usuarios_leer_perfil',
        parameters: [USUARIO],
        responses: { 200: json(ref('Perfil'), 'El perfil.'), 404: error('No existe el usuario.') },
      },
      put: {
        tags: ['usuarios'],
        summary: 'Actualizar nombre y/o preferencias (parcial)',
        operationId: 'usuarios_actualizar_perfil',
        parameters: [USUARIO],
        requestBody: cuerpo({ type: 'object', properties: { nombre: { type: 'string' }, preferencias: { type: 'object', additionalProperties: { type: 'boolean' } } } }),
        responses: { 200: json(ref('Perfil'), 'El perfil actualizado.') },
      },
    },
    '/api/agencias/{id}': {
      get: {
        tags: ['usuarios'],
        summary: 'Marca blanca de una agencia',
        operationId: 'usuarios_agencia',
        parameters: [ruta('id', 'Id de la agencia.')],
        responses: { 200: json(ref('Agencia'), 'La agencia.'), 404: error('No existe la agencia.') },
      },
    },
    '/api/agencias/{id}/registro': {
      post: {
        tags: ['usuarios'],
        summary: 'Consolidar un lote de la bitácora de un nodo de agencia',
        operationId: 'usuarios_consolidar_bitacora',
        parameters: [ruta('id', 'Id de la agencia.')],
        requestBody: cuerpo({ type: 'object', required: ['entradas'], properties: { entradas: { type: 'array', items: ref('EntradaBitacora') } } }),
        responses: { 200: json({ type: 'object', properties: { insertadas: { type: 'integer' } } }, 'Cuántas entradas se guardaron.') },
      },
    },
    '/api/admin/config': {
      get: {
        tags: ['usuarios'],
        summary: 'Estado de cada vertical en la agencia',
        operationId: 'usuarios_config',
        parameters: [AGENCIA],
        responses: { 200: json(ref('ConfigVerticales'), 'Configuración.') },
      },
    },
    '/api/admin/config/{vertical}': {
      put: {
        tags: ['usuarios'],
        summary: 'Activar o apagar un vertical (queda en la auditoría)',
        operationId: 'usuarios_cambiar_vertical',
        parameters: [ruta('vertical', 'Vertical.', { type: 'string', enum: ['vuelos', 'hospedaje', 'traslado'] }), USUARIO, AGENCIA],
        requestBody: cuerpo({ type: 'object', required: ['estado'], properties: { estado: { type: 'string', enum: ['activo', 'inactivo'] }, motivo: { type: 'string' } } }),
        responses: { 200: json(ref('ConfigVerticales'), 'Configuración actualizada.'), 400: error('Estado inválido.'), 404: error('Vertical desconocido.') },
      },
    },
    '/api/admin/preferencias-agregadas': {
      get: {
        tags: ['usuarios'],
        summary: 'Cuántos usuarios desactivaron cada vertical',
        operationId: 'usuarios_preferencias_agregadas',
        parameters: [AGENCIA],
        responses: { 200: json({ type: 'object' }, 'Totales por vertical.') },
      },
    },
    '/api/admin/auditoria': {
      get: {
        tags: ['usuarios'],
        summary: 'Últimos cambios de configuración',
        operationId: 'usuarios_auditoria',
        parameters: [AGENCIA],
        responses: { 200: json({ type: 'array', items: { type: 'object' } }, 'Cambios, del más nuevo al más viejo.') },
      },
    },
    '/api/admin/administradores': {
      get: {
        tags: ['usuarios'],
        summary: 'Administradores de la agencia',
        operationId: 'usuarios_administradores',
        parameters: [AGENCIA],
        responses: { 200: json({ type: 'array', items: ref('Administrador') }, 'Administradores.') },
      },
      post: {
        tags: ['usuarios'],
        summary: 'Alta de administrador',
        operationId: 'usuarios_alta_administrador',
        parameters: [USUARIO, AGENCIA],
        requestBody: cuerpo({ type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string', minLength: 8 }, permisos: { type: 'array', items: { type: 'string', enum: ['gestion_verticales', 'gestion_usuarios'] } } } }),
        responses: { 200: json({ type: 'array', items: ref('Administrador') }, 'Administrador creado: devuelve la lista actualizada.'), 400: error('Datos inválidos.'), 409: error('Ya existe ese usuario.') },
      },
    },
    '/api/admin/administradores/{id}/permisos': {
      put: {
        tags: ['usuarios'],
        summary: 'Cambiar los permisos de un administrador',
        operationId: 'usuarios_permisos',
        parameters: [ruta('id', 'Id del administrador.'), USUARIO, AGENCIA],
        requestBody: cuerpo({ type: 'object', required: ['permisos'], properties: { permisos: { type: 'array', items: { type: 'string', enum: ['gestion_verticales', 'gestion_usuarios'] } } } }),
        responses: { 200: json({ type: 'array', items: ref('Administrador') }, 'Permisos actualizados: devuelve la lista actualizada.'), 404: error('No existe ese administrador en la agencia.') },
      },
    },

    // --- notificaciones ---
    '/api/notificaciones/{reservaId}': {
      get: {
        tags: ['notificaciones'],
        summary: '¿Ya salió el aviso de esta reserva?',
        operationId: 'notificaciones_estado',
        parameters: [ruta('reservaId', 'Id de la reserva.')],
        responses: {
          200: json({ type: 'object', required: ['reserva_id', 'estado'], properties: { reserva_id: { type: 'string' }, estado: { type: 'string', enum: ['enviada'] }, enviada_en: { type: 'string', format: 'date-time' }, repeticiones: { type: 'integer' } } }, 'El aviso salió.'),
          404: error('Todavía no se envió (`motivo: pendiente`).'),
        },
      },
    },
    '/api/notificaciones': {
      get: {
        tags: ['notificaciones'],
        summary: 'Últimos 20 avisos enviados',
        operationId: 'notificaciones_ultimas',
        responses: { 200: json({ type: 'array', items: { type: 'object' } }, 'Avisos.') },
      },
    },

    // --- registro ---
    '/api/v1/servicios/{nombre}/{id}': {
      put: {
        tags: ['registro'],
        summary: 'Registrar una instancia, o renovarla (latido)',
        operationId: 'registro_anotar',
        description: 'Idempotente: cada servicio lo repite cada 3 s. Una instancia sin latido durante el TTL (10 s) se da de baja sola.',
        parameters: [ruta('nombre', 'Nombre del servicio.', { type: 'string', pattern: '^[a-z][a-z0-9-]{1,40}$' }), ruta('id', 'Id de la instancia, ej. `vuelos@4001`.')],
        requestBody: cuerpo({ type: 'object', required: ['url'], properties: { url: { type: 'string', example: 'http://localhost:4001' }, version: { type: 'string' } } }),
        responses: { 200: json({ allOf: [ref('Instancia'), { type: 'object', properties: { ttl_ms: { type: 'integer' } } }] }, 'Instancia registrada.'), 400: error('Nombre o url inválidos.') },
      },
      delete: {
        tags: ['registro'],
        summary: 'Baja ordenada',
        operationId: 'registro_baja',
        parameters: [ruta('nombre', 'Nombre del servicio.'), ruta('id', 'Id de la instancia.')],
        responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' } } }, 'Dada de baja.'), 404: error('No hay una instancia con ese id.') },
      },
    },
    '/api/v1/servicios': {
      get: {
        tags: ['registro'],
        summary: 'Todos los servicios y sus instancias',
        operationId: 'registro_servicios',
        parameters: [query('solo_sanas', { type: 'boolean' }, 'Sólo las que pasaron el último health check.')],
        responses: { 200: json({ type: 'object', properties: { generado_en: { type: 'string', format: 'date-time' }, servicios: { type: 'object', additionalProperties: { type: 'array', items: ref('Instancia') } } } }, 'Servicios.') },
      },
    },
    '/api/v1/servicios/{nombre}': {
      get: {
        tags: ['registro'],
        summary: 'Instancias de un servicio (lo que consulta el cliente para descubrirlo)',
        operationId: 'registro_instancias',
        parameters: [ruta('nombre', 'Nombre del servicio.'), query('solo_sanas', { type: 'boolean' }, 'Sólo las que pasaron el último health check.')],
        responses: { 200: json({ type: 'object', properties: { nombre: { type: 'string' }, conocido: { type: 'boolean' }, instancias: { type: 'array', items: ref('Instancia') } } }, 'Instancias.') },
      },
    },

    // --- nodo de agencia ---
    '/api/registro': {
      post: {
        tags: ['nodo-agencia'],
        summary: 'Anotar una búsqueda en la bitácora local',
        operationId: 'nodo_agencia_anotar',
        description: 'Se guarda en la base local y se sincroniza con el central en segundo plano (`POST /api/v1/agencias/{id}/registro` del agregador).',
        requestBody: cuerpo(ref('EntradaBitacora')),
        responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' } } }, 'Guardada.'), 400: error('Faltan `vertical` o `estado`.') },
      },
    },
  },
  components: {
    schemas: {
      ...OPENAPI.components.schemas,
      VerticalNoDisponible: {
        type: 'object',
        required: ['vertical', 'estado', 'motivo', 'generado_en'],
        properties: {
          vertical: { type: 'string', enum: ['vuelos', 'hospedaje', 'traslado'] },
          estado: { type: 'string', enum: ['unavailable'] },
          motivo: { type: 'string', enum: ['timeout', 'error'] },
          detalle: { type: 'string' },
          generado_en: { type: 'string', format: 'date-time' },
        },
      },
      Cupo: {
        type: 'object',
        required: ['vuelo_id', 'capacidad', 'ocupados', 'libres'],
        properties: { vuelo_id: { type: 'string' }, capacidad: { type: 'integer' }, ocupados: { type: 'integer' }, libres: { type: 'integer' } },
      },
      EntradaBitacora: {
        type: 'object',
        required: ['vertical', 'estado'],
        properties: {
          vertical: { type: 'string' },
          estado: { type: 'string' },
          motivo: { type: 'string' },
          criterios: { type: 'object' },
          buscado_en: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
}
