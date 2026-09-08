/**
 * # ProveedorDeEmail — la interfaz
 *
 * Mismo patrón que `ProveedorDeVuelos`/`ProveedorDeHospedaje`
 * (servidor/vuelos/proveedor.js): una interfaz chica y una
 * implementación ficticia, para no depender de un servidor de correo
 * real que este proyecto no tiene ni va a tener.
 *
 * ```
 * nombre: string
 * enviarCodigo({ email, codigo }) → Promise<{ enviado: boolean }>
 * ```
 *
 * La implementación ficticia "envía" logueando en la consola del
 * servidor, y el llamador (`servidor/usuarios/index.js`) expone el
 * código en la respuesta HTTP como `codigo_demo` — así el front lo
 * puede mostrar en pantalla en vez de obligar a revisar una casilla de
 * correo que no existe. El día que haya un proveedor real (Resend,
 * SMTP), es un archivo `proveedor-<nombre>.js` nuevo con esta misma
 * forma y una línea acá — nada del resto del sistema se entera.
 */
function crearProveedorFicticio() {
  return {
    nombre: 'ficticio',
    async enviarCodigo({ email, codigo }) {
      console.log(`[email] (modo demo, no se manda nada por internet) código para ${email}: ${codigo}`)
      return { enviado: true }
    },
  }
}

export function crearProveedorEmail() {
  return crearProveedorFicticio()
}
