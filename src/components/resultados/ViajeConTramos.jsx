import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { useSesion } from '../../estado/sesion.js'
import { duracionTexto, formatearPrecio, horaDeReloj } from '../../dominio/formato.js'
import SeccionResultados from './SeccionResultados.jsx'

/**
 * Un viaje de varios vuelos —ida y vuelta, o multidestino— donde hay que
 * elegir uno por tramo antes de seguir.
 *
 * Antes "ida y vuelta" buscaba sólo la ida: la vuelta se ignoraba aunque
 * el título dijera "viaje de ida y vuelta", y no había manera de elegir
 * el regreso. Ahora cada tramo es su propia búsqueda (`origen→destino` y
 * `destino→origen`, cada una con su fecha, en paralelo y con su propio
 * ciclo cargando → ok | no disponible — el fallo de uno no tapa al otro)
 * y el viaje avanza cuando están todos elegidos.
 *
 * La elección vive acá, no en cada lista: el total y el botón
 * "Continuar" necesitan ver todos los tramos a la vez.
 */
export default function ViajeConTramos({ vertical, tramos, criterios }) {
  const [elegidos, setElegidos] = useState({})
  const navegar = useNavigate()
  const { usuario } = useSesion()

  const alternar = (i) => (vuelo) =>
    setElegidos((previos) => ({ ...previos, [i]: previos[i]?.id === vuelo.id ? undefined : vuelo }))

  const lista = tramos.map((_, i) => elegidos[i])
  const completos = lista.every(Boolean)
  const monedas = new Set(lista.filter(Boolean).map((v) => v.precio.moneda))
  const total = lista.filter(Boolean).reduce((suma, v) => suma + v.precio.monto, 0)
  const hayElegidos = lista.some(Boolean)

  function continuar() {
    navegar('/reserva/tarifas', { state: { vuelos: lista, criterios } })
  }

  return (
    <>
      {tramos.map((t, i) => (
        <SeccionResultados
          key={t.id}
          vertical={{ ...vertical, id: t.id, titulo: t.titulo }}
          criterios={t.criterios}
          listaProps={{ onSeleccionar: alternar(i), seleccionadoId: elegidos[i]?.id, resumen: false }}
        />
      ))}

      {/* El panel de fallos (sólo para administradores) vive abajo a la
          derecha: sin este margen taparía el botón. */}
      <div className={`sticky z-10 ${usuario?.rol === 'admin' ? 'bottom-16' : 'bottom-4'}`}>
        <Card className="shadow-lg">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <ul className="grid min-w-0 flex-1 basis-64 gap-1 text-sm">
              {tramos.map((t, i) => {
                const v = lista[i]
                return (
                  <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
                    <span className="font-medium text-foreground">{t.corto}</span>
                    {v ? (
                      <span className="min-w-0 truncate">
                        {v.aerolinea} · {horaDeReloj(v.salida)} {v.origen} → {horaDeReloj(v.llegada)} {v.destino} ·{' '}
                        {duracionTexto(v.duracion_min)}
                      </span>
                    ) : (
                      <span>sin elegir</span>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{completos ? 'Total' : 'Subtotal'}</p>
              <p className="font-semibold tabular-nums">
                {hayElegidos && monedas.size === 1 ? formatearPrecio({ monto: total, moneda: [...monedas][0] }) : '—'}
              </p>
            </div>
            <Button type="button" disabled={!completos} onClick={continuar}>
              {completos ? 'Continuar' : `Elegí ${tramos.length === 2 ? 'los dos vuelos' : `los ${tramos.length} vuelos`}`}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
