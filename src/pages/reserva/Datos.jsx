import { CircleAlert, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Button, buttonVariants } from '@/components/ui/button.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { nuevaClave, reservar } from '../../api/reservas.js'
import ResumenVuelos from '../../components/reserva/ResumenVuelos.jsx'
import { formatearPrecios } from '../../dominio/formato.js'
import { urlDeResultados, vuelosDe } from '../../dominio/viaje.js'

function Campo({ etiqueta, children }) {
  return (
    <Label className="grid gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {etiqueta}
      {children}
    </Label>
  )
}

function pasajeroVacio() {
  return { nombre: '', apellido: '', tipoDocumento: 'dni', documento: '', nacimiento: '' }
}

/**
 * Datos del pasajero — último paso antes de confirmar. Al confirmar se
 * hace la reserva de verdad contra el backend: se descuentan los
 * asientos de cada vuelo (Módulo 3, `docs/contrato-agregador.md` §11).
 * No hay cobro ni emisión de pasaje real detrás, y el aviso de arriba lo
 * dice explícito: mostrar un formulario que junta datos personales sin
 * decir para qué se usan sería el tipo de cosa que no se hace.
 *
 * Qué viaja al servidor: la cantidad de pasajeros, sus nombres y el
 * email de contacto (para el aviso de confirmación). Documentos y
 * fechas de nacimiento se piden —es lo que pide cualquier aerolínea—
 * pero se quedan en el navegador: no hay para qué guardarlos acá.
 */
export default function Datos() {
  const { state } = useLocation()
  const navegar = useNavigate()

  const cantidad = Math.max(Number(state?.criterios?.pasajeros) || 1, 1)
  const [pasajeros, setPasajeros] = useState(() => Array.from({ length: cantidad }, pasajeroVacio))
  const [contacto, setContacto] = useState({ email: '', telefono: '' })
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)

  // Una clave por pantalla, no por intento: el reintento tras un corte
  // tiene que reusar la misma para que el servidor reconozca el pedido.
  const clave = useRef(null)
  clave.current ??= nuevaClave()

  const vuelos = vuelosDe(state)
  if (!vuelos || !state?.tarifa) return <Navigate to="/resultados" replace />
  const { tarifa, criterios } = state

  const cambiarPasajero = (i, campo) => (e) =>
    setPasajeros((ps) => ps.map((p, idx) => (idx === i ? { ...p, [campo]: e.target.value } : p)))
  const cambiarContacto = (campo) => (e) => setContacto((c) => ({ ...c, [campo]: e.target.value }))

  async function confirmar(e) {
    e.preventDefault()
    if (enviando) return
    setEnviando(true)
    setError(null)
    try {
      const reserva = await reservar({
        vuelos,
        pasajeros: pasajeros.length,
        contacto,
        nombres: pasajeros.map((p) => `${p.nombre} ${p.apellido}`.trim()),
        clave: clave.current,
      })
      navegar('/reserva/confirmacion', { state: { vuelos, tarifa, pasajeros, contacto, reserva }, replace: true })
    } catch (falla) {
      setError(falla)
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={confirmar} className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="grid gap-4">
        <ResumenVuelos vuelos={vuelos} />

        <Alert>
          <AlertTitle className="flex items-center gap-2">
            Reserva de demostración <Badge variant="outline">demo</Badge>
          </AlertTitle>
          <AlertDescription>
            Al confirmar se reservan los asientos de verdad, pero no se procesa ningún pago ni se emite un pasaje real.
          </AlertDescription>
        </Alert>

        {error && (
          <Alert variant="destructive" role="alert">
            <CircleAlert />
            <AlertTitle>
              {error.motivo === 'sin_cupo'
                ? 'No quedan asientos'
                : error.motivo === 'no_disponible'
                  ? 'No pudimos confirmar la reserva'
                  : 'No se pudo reservar'}
            </AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
            <AlertAction>
              {error.reintentable ? (
                <Button type="submit" variant="outline" size="sm" disabled={enviando}>
                  Reintentar
                </Button>
              ) : (
                <Link to={urlDeResultados(criterios)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Elegir otro vuelo
                </Link>
              )}
            </AlertAction>
          </Alert>
        )}

        {pasajeros.map((p, i) => (
          <Card key={i}>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <h2 className="font-medium sm:col-span-2">Pasajero {i + 1}</h2>
              <Campo etiqueta="Nombre">
                <Input required autoComplete="given-name" value={p.nombre} onChange={cambiarPasajero(i, 'nombre')} />
              </Campo>
              <Campo etiqueta="Apellido">
                <Input required autoComplete="family-name" value={p.apellido} onChange={cambiarPasajero(i, 'apellido')} />
              </Campo>
              <Campo etiqueta="Tipo de documento">
                <select value={p.tipoDocumento} onChange={cambiarPasajero(i, 'tipoDocumento')}>
                  <option value="dni">DNI</option>
                  <option value="pasaporte">Pasaporte</option>
                </select>
              </Campo>
              <Campo etiqueta="Número de documento">
                <Input required value={p.documento} onChange={cambiarPasajero(i, 'documento')} />
              </Campo>
              <Campo etiqueta="Fecha de nacimiento">
                <Input type="date" required value={p.nacimiento} onChange={cambiarPasajero(i, 'nacimiento')} />
              </Campo>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <h2 className="font-medium sm:col-span-2">Datos de contacto</h2>
            <Campo etiqueta="Email">
              <Input type="email" required autoComplete="email" value={contacto.email} onChange={cambiarContacto('email')} />
            </Campo>
            <Campo etiqueta="Teléfono">
              <Input type="tel" required autoComplete="tel" value={contacto.telefono} onChange={cambiarContacto('telefono')} />
            </Campo>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Te mandamos la confirmación por email. Es un aviso aparte de la reserva: llega unos segundos después.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardContent className="grid gap-3">
          <h2 className="font-medium">Resumen</h2>
          <p className="text-sm text-muted-foreground">
            {vuelos.map((v) => `${v.origen} → ${v.destino}`).join(' · ')}
          </p>
          <p className="text-sm text-muted-foreground">
            {tarifa.nombre} · {pasajeros.length} {pasajeros.length === 1 ? 'pasajero' : 'pasajeros'}
          </p>
          <div className="mt-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-semibold">{formatearPrecios(tarifa.precios)}</p>
          </div>
          <Button type="submit" className="mt-2" disabled={enviando}>
            {enviando && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {enviando ? 'Reservando…' : 'Confirmar reserva'}
          </Button>
        </CardContent>
      </Card>
    </form>
  )
}
