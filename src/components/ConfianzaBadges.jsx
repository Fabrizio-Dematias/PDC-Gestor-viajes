import {
  ArrowLeftRight,
  Building2,
  Car,
  CalendarRange,
  LayoutGrid,
  MapPinned,
  Plane,
  Route,
  Split,
  Tag,
  Users,
} from 'lucide-react'
import { useAgencia } from '../api/tenant.js'

/**
 * Franja bajo el buscador de la portada — mismo lugar que ocupa
 * "¿Por qué Booking.com?" en el sitio real, pero con dos diferencias a
 * propósito:
 *
 * 1. El contenido es sobre lo que le importa a quien viaja (cuántas
 *    opciones hay, qué puede elegir), no sobre cómo está armado el
 *    sistema por dentro — eso no le interesa a un usuario común.
 * 2. Cambia según la solapa activa: lo que vale la pena contar de
 *    vuelos no es lo mismo que de hospedaje o traslado, así que
 *    repetir las mismas cuatro tarjetas en las tres pestañas no suma.
 *
 * Los números son reales (conteos de las bases propias, no
 * estadísticas de marketing inventadas) — lo único que no se replica
 * de sitios como Booking es lo que depende de reservas o pagos
 * (cancelación, "pagás en el alojamiento", opiniones de otros
 * usuarios): esas funciones no existen en este sistema, así que
 * prometerlas sería mentir.
 */
const POR_VERTICAL = {
  vuelos: [
    { Icono: Plane, titulo: '131.294 vuelos reales', descripcion: 'Itinerarios entre 6071 aeropuertos de todo el mundo, no rutas inventadas.' },
    { Icono: Route, titulo: 'Directo o con escalas', descripcion: 'Elegís vos: el más rápido o el más barato.' },
    { Icono: Tag, titulo: 'Todas las aerolíneas juntas', descripcion: 'Iberia, Aerolíneas Argentinas, Air Europa y muchas más, en una sola búsqueda.' },
    { Icono: ArrowLeftRight, titulo: 'Ida, vuelta o multidestino', descripcion: 'Si tu viaje no es lineal, volvés desde otra ciudad sin problema.' },
  ],
  hospedaje: [
    { Icono: Building2, titulo: '48.568 alojamientos', descripcion: 'Hoteles, aparts y hostales para comparar en el mismo destino.' },
    { Icono: Users, titulo: 'Ocupación exacta', descripcion: 'Adultos, niños y habitaciones — no un número suelto de pasajeros.' },
    { Icono: CalendarRange, titulo: 'Tus fechas exactas', descripcion: 'Entrada y salida a tu medida, no paquetes de noches fijas.' },
    { Icono: LayoutGrid, titulo: 'Mismo destino, todas las opciones', descripcion: 'Comparás precio y capacidad sin cambiar de pantalla.' },
  ],
  traslado: [
    { Icono: Car, titulo: 'Combi, auto, van o taxi', descripcion: 'Elegís el vehículo según cuántos viajan y cuánto querés gastar.' },
    { Icono: MapPinned, titulo: 'Aeropuerto ↔ destino', descripcion: 'Te recogen a la llegada, te llevan de vuelta a la salida.' },
    { Icono: Split, titulo: 'Ida y vuelta desde lugares distintos', descripcion: 'Si te quedás en dos ciudades, cada tramo tiene su propio traslado.' },
    { Icono: Tag, titulo: 'Precio por traslado, no por persona', descripcion: 'Vas con más gente y no pagás de más por eso.' },
  ],
}

export default function ConfianzaBadges({ vertical = 'vuelos' }) {
  const agencia = useAgencia()
  const items = POR_VERTICAL[vertical] ?? POR_VERTICAL.vuelos

  return (
    <section className="grid gap-4 pt-2">
      <h2 className="text-xl font-semibold tracking-tight">¿Por qué {agencia.nombre}?</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ Icono, titulo, descripcion }) => (
          <div key={titulo} className="grid gap-2 rounded-lg border p-4">
            <Icono className="size-6 text-primary" aria-hidden="true" />
            <h3 className="font-medium">{titulo}</h3>
            <p className="text-sm text-muted-foreground">{descripcion}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
