import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useAgencia } from './api/tenant.js'
import PanelFallos from './components/demo/PanelFallos.jsx'
import Nav from './components/layout/Nav.jsx'
import { useSesion } from './estado/sesion.js'
import './App.css'

/** Un tono ~25% más oscuro, para el hover de los botones primarios
 *  (`--azul-700`). Alcanza con que la agencia defina un solo color: de
 *  ahí salen las dos variables que ya usa el resto de la hoja de
 *  estilos. */
function oscurecer(hex, factor = 0.75) {
  const n = parseInt(hex.slice(1), 16)
  const canal = (despl) => Math.round(((n >> despl) & 255) * factor)
  return `#${[16, 8, 0].map((d) => canal(d).toString(16).padStart(2, '0')).join('')}`
}

export default function App() {
  const agencia = useAgencia()
  const { usuario } = useSesion()

  // Personalización de marca blanca (docs/arquitectura-multi-nodo.md
  // §3): un color por agencia pisa las variables de marca en tiempo de
  // ejecución. El resto de la hoja de estilos no sabe que hay varias
  // agencias — sigue leyendo las mismas `--azul-600`/`--azul-700` de
  // siempre.
  useEffect(() => {
    if (!agencia.color_primario) return
    document.documentElement.style.setProperty('--azul-600', agencia.color_primario)
    document.documentElement.style.setProperty('--azul-700', oscurecer(agencia.color_primario))
  }, [agencia.color_primario])

  return (
    <>
      <Nav />
      <main className="contenido">
        <Outlet />
      </main>
      {usuario?.rol === 'admin' && <PanelFallos />}
    </>
  )
}
