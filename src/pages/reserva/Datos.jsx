import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { formatearPrecio } from '../../dominio/formato.js'

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
 * Datos del pasajero — último paso antes de "confirmar". No hay cobro
 * ni emisión real detrás de este botón: es una demostración de la
 * pantalla, no la Etapa 7 (reservas con concurrencia real), que sigue
 * sin encarar. Por eso el aviso de arriba es explícito y no un detalle
 * chico — mostrar un formulario que junta datos personales sin decir
 * para qué se usan de verdad sería el tipo de cosa que no se hace.
 */
export default function Datos() {
  const { state } = useLocation()
  const navegar = useNavigate()

  const cantidad = Math.max(Number(state?.criterios?.pasajeros) || 1, 1)
  const [pasajeros, setPasajeros] = useState(() => Array.from({ length: cantidad }, pasajeroVacio))
  const [contacto, setContacto] = useState({ email: '', telefono: '' })

  if (!state?.vuelo || !state?.tarifa) return <Navigate to="/resultados" replace />
  const { vuelo, tarifa } = state

  const cambiarPasajero = (i, campo) => (e) =>
    setPasajeros((ps) => ps.map((p, idx) => (idx === i ? { ...p, [campo]: e.target.value } : p)))
  const cambiarContacto = (campo) => (e) => setContacto((c) => ({ ...c, [campo]: e.target.value }))

  function confirmar(e) {
    e.preventDefault()
    navegar('/reserva/confirmacion', { state: { vuelo, tarifa, pasajeros, contacto } })
  }

  return (
    <form onSubmit={confirmar} className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="grid gap-4">
        <Alert>
          <AlertTitle className="flex items-center gap-2">
            Reserva simulada <Badge variant="outline">demo</Badge>
          </AlertTitle>
          <AlertDescription>
            Esta pantalla no procesa ningún pago ni emite un pasaje real — es la demostración del flujo completo de
            búsqueda y selección.
          </AlertDescription>
        </Alert>

        {pasajeros.map((p, i) => (
          <Card key={i}>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <h2 className="font-medium sm:col-span-2">Pasajero {i + 1}</h2>
              <Campo etiqueta="Nombre">
                <Input required value={p.nombre} onChange={cambiarPasajero(i, 'nombre')} />
              </Campo>
              <Campo etiqueta="Apellido">
                <Input required value={p.apellido} onChange={cambiarPasajero(i, 'apellido')} />
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
              <Input type="email" required value={contacto.email} onChange={cambiarContacto('email')} />
            </Campo>
            <Campo etiqueta="Teléfono">
              <Input type="tel" required value={contacto.telefono} onChange={cambiarContacto('telefono')} />
            </Campo>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardContent className="grid gap-3">
          <h2 className="font-medium">Resumen</h2>
          <p className="text-sm text-muted-foreground">
            {vuelo.origen} → {vuelo.destino} · {vuelo.aerolinea}
          </p>
          <p className="text-sm text-muted-foreground">{tarifa.nombre}</p>
          <div className="mt-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-semibold">{formatearPrecio(tarifa.precio)}</p>
          </div>
          <Button type="submit" className="mt-2">
            Confirmar reserva
          </Button>
        </CardContent>
      </Card>
    </form>
  )
}
