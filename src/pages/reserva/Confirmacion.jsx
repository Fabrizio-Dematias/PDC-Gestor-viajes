import { CheckCircle2, Clock, Mail, MailWarning } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Badge } from '@/components/ui/badge.jsx'
import { buttonVariants } from '@/components/ui/button.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { leerReserva } from '../../api/reservas.js'
import ResumenVuelos from '../../components/reserva/ResumenVuelos.jsx'
import { formatearPrecios } from '../../dominio/formato.js'
import { vuelosDe } from '../../dominio/viaje.js'

const INTERVALO_MS = 1500
const INTENTOS_MAXIMOS = 8

/**
 * El estado del aviso de confirmación por email, que es el canal
 * **asíncrono** del sistema (Módulo 3): la reserva ya está confirmada
 * —el usuario ve el código acá, al instante—, pero el email lo manda
 * otro servicio, más tarde, a través de una cola. Esta pantalla lo
 * consulta unos segundos para mostrar cuándo salió. Si ese servicio
 * está caído no pasa nada con la reserva: el aviso espera en la cola y
 * sale cuando vuelva.
 */
function useAvisoDeConfirmacion(reservaId, simulada) {
  const [estado, setEstado] = useState(simulada ? 'enviada' : 'pendiente')

  useEffect(() => {
    if (simulada) return
    let vivo = true
    let intentos = 0
    let temporizador
    const sondear = async () => {
      intentos++
      const reserva = await leerReserva(reservaId).catch(() => null)
      if (!vivo) return
      const actual = reserva?.notificacion?.estado ?? 'no_disponible'
      setEstado(actual)
      if (actual !== 'enviada' && intentos < INTENTOS_MAXIMOS) temporizador = setTimeout(sondear, INTERVALO_MS)
    }
    temporizador = setTimeout(sondear, 400)
    return () => {
      vivo = false
      clearTimeout(temporizador)
    }
  }, [reservaId, simulada])

  return estado
}

function AvisoPorEmail({ estado, email }) {
  const textos = {
    enviada: { Icono: Mail, clase: 'text-[var(--ok)]', titulo: 'Confirmación enviada', detalle: email ? `Te la mandamos a ${email}.` : 'Ya te la mandamos.' },
    pendiente: { Icono: Clock, clase: 'text-muted-foreground', titulo: 'Preparando la confirmación…', detalle: 'El email sale en unos segundos: lo manda otro servicio, aparte de la reserva.' },
    no_disponible: { Icono: MailWarning, clase: 'text-[var(--alerta)]', titulo: 'La confirmación por email demora', detalle: 'El servicio de avisos no responde ahora. Tu reserva está confirmada; el email sale apenas vuelva.' },
  }
  const { Icono, clase, titulo, detalle } = textos[estado] ?? textos.pendiente
  return (
    <div className="flex items-start gap-3 text-left text-sm" role="status">
      <Icono className={`mt-0.5 size-4 shrink-0 ${clase}`} aria-hidden="true" />
      <div>
        <p className="font-medium">{titulo}</p>
        <p className="text-muted-foreground">{detalle}</p>
      </div>
    </div>
  )
}

export default function Confirmacion() {
  const { state } = useLocation()
  const vuelos = vuelosDe(state)
  const reserva = state?.reserva
  const aviso = useAvisoDeConfirmacion(reserva?.reserva_id, reserva?.simulada ?? true)

  if (!vuelos || !reserva) return <Navigate to="/resultados" replace />
  const { tarifa, pasajeros, contacto } = state

  return (
    <div className="mx-auto grid max-w-lg gap-4 py-6 text-center">
      <CheckCircle2 className="mx-auto size-12 text-[var(--ok)]" aria-hidden="true" />
      <h1 className="flex items-center justify-center gap-2 text-xl font-semibold tracking-tight">
        Reserva confirmada <Badge variant="outline">demo</Badge>
      </h1>
      <p className="text-sm text-muted-foreground">
        Los asientos quedaron reservados. No se realizó ningún cargo ni se emitió un pasaje real: esto cierra la
        demostración del flujo de búsqueda, selección, datos y reserva.
      </p>

      <Card className="text-left">
        <CardContent className="grid gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Código de reserva</span>
            <span className="font-mono text-lg font-semibold tracking-wider">{reserva.codigo}</span>
          </div>
          <div className="border-t pt-3 text-sm text-muted-foreground">
            <p>{tarifa.nombre}</p>
            <p>
              {pasajeros?.length ?? 1} {(pasajeros?.length ?? 1) === 1 ? 'pasajero' : 'pasajeros'}
            </p>
          </div>
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-semibold">{formatearPrecios(tarifa.precios)}</p>
          </div>
          <div className="border-t pt-3">
            <AvisoPorEmail estado={aviso} email={contacto?.email} />
          </div>
        </CardContent>
      </Card>

      <div className="text-left">
        <ResumenVuelos vuelos={vuelos} />
      </div>

      {reserva.repetida && (
        <p className="text-xs text-muted-foreground">
          Esta reserva ya existía: la recuperamos en vez de crear otra, así que no se descontaron asientos de más.
        </p>
      )}

      <Link to="/" className={buttonVariants({ variant: 'outline' }) + ' justify-self-center'}>
        Volver al inicio
      </Link>
    </div>
  )
}
