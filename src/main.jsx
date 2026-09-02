import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from './App.jsx'
import Admin from './pages/Admin.jsx'
import Home from './pages/Home.jsx'
import Perfil from './pages/Perfil.jsx'
import Resultados from './pages/Resultados.jsx'
import './index.css'

const clienteQuery = new QueryClient({
  defaultOptions: {
    queries: {
      // Un vertical caído no se arregla porque el usuario vuelva a la
      // pestaña, y un refetch automático mientras se explican los
      // resultados hace que la demo salte sola.
      refetchOnWindowFocus: false,
    },
  },
})

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: 'resultados', element: <Resultados /> },
      { path: 'perfil', element: <Perfil /> },
      { path: 'admin', element: <Admin /> },
    ],
  },
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={clienteQuery}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
