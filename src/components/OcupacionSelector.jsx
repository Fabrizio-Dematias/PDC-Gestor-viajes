import { Minus, Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button.jsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.jsx'

const FILAS = [
  { campo: 'adultos', etiqueta: 'Adultos', min: 1, max: 9 },
  { campo: 'ninos', etiqueta: 'Niños', min: 0, max: 6 },
  { campo: 'habitaciones', etiqueta: 'Habitaciones', min: 1, max: 5 },
]

function plural(n, singular, pluralForma = `${singular}s`) {
  return Number(n) === 1 ? singular : pluralForma
}

export function resumenOcupacion({ adultos = 1, ninos = 0, habitaciones = 1 }) {
  return (
    `${adultos} ${plural(adultos, 'adulto')} · ` +
    `${ninos} ${plural(ninos, 'niño')} · ` +
    `${habitaciones} ${plural(habitaciones, 'habitación', 'habitaciones')}`
  )
}

/**
 * "Ocupación" del alojamiento (adultos, niños, habitaciones) — a
 * diferencia de vuelos y traslado, que sólo necesitan una cantidad de
 * pasajeros, una reserva de hospedaje se arma por habitación. Es
 * enteramente del lado del front: lo que llega al contrato sigue
 * siendo `pasajeros` (adultos + niños) más estos tres campos extra,
 * que el backend no necesita y por ahora sólo se muestran de vuelta en
 * el resumen de la búsqueda (`Resultados.jsx`).
 */
export default function OcupacionSelector({ valor, onCambiar }) {
  // `??`, no un spread de defaults: `valor` puede traer las claves
  // presentes pero en `undefined` (`form.adultos` antes de la primera
  // vez que se toca el selector), y un spread las pisa igual que un
  // valor real — el default nunca llegaba a aplicarse.
  const ocupacion = {
    adultos: valor.adultos ?? 1,
    ninos: valor.ninos ?? 0,
    habitaciones: valor.habitaciones ?? 1,
  }

  function paso(campo, delta) {
    const fila = FILAS.find((f) => f.campo === campo)
    const siguiente = Math.min(fila.max, Math.max(fila.min, Number(ocupacion[campo]) + delta))
    onCambiar({ ...ocupacion, [campo]: siguiente })
  }

  return (
    <div className="campo">
      <span className="campo__etiqueta" id="ocupacion-etiqueta">Ocupación</span>
      <Popover>
        <PopoverTrigger className="ocupacion__disparador" aria-labelledby="ocupacion-etiqueta">
          <Users aria-hidden="true" />
          {resumenOcupacion(ocupacion)}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          {FILAS.map((f) => (
            <div className="ocupacion__fila" key={f.campo}>
              <span>{f.etiqueta}</span>
              <div className="ocupacion__control">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => paso(f.campo, -1)}
                  disabled={ocupacion[f.campo] <= f.min}
                  aria-label={`Menos ${f.etiqueta.toLowerCase()}`}
                >
                  <Minus />
                </Button>
                <span className="ocupacion__numero">{ocupacion[f.campo]}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => paso(f.campo, 1)}
                  disabled={ocupacion[f.campo] >= f.max}
                  aria-label={`Más ${f.etiqueta.toLowerCase()}`}
                >
                  <Plus />
                </Button>
              </div>
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}
