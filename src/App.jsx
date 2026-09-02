import { Outlet } from 'react-router-dom'
import PanelFallos from './components/demo/PanelFallos.jsx'
import Nav from './components/layout/Nav.jsx'
import './App.css'

export default function App() {
  return (
    <>
      <Nav />
      <main className="contenido">
        <Outlet />
      </main>
      <PanelFallos />
    </>
  )
}
