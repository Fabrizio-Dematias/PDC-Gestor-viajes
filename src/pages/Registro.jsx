import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { registrarse, verificarEmail } from '../api/auth.js'
import { useSesion } from '../estado/sesion.js'

/**
 * Alta de cliente por email (contrato §10). El código de verificación
 * es simulado (`servidor/comun/email.js`): con el proveedor ficticio
 * viaja en la respuesta como `codigo_demo` y se muestra acá, etiquetado
 * como demo — no hay ningún servidor de correo real detrás.
 */
export default function Registro() {
  const navegar = useNavigate()
  const { guardarSesion } = useSesion()

  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [paso, setPaso] = useState('datos') // 'datos' | 'codigo'
  const [codigo, setCodigo] = useState('')
  const [codigoDemo, setCodigoDemo] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(false)

  async function enviarDatos(e) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      const { codigo_demo } = await registrarse({ nombre, email, password })
      setCodigoDemo(codigo_demo ?? null)
      setPaso('codigo')
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  async function confirmar(e) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      const { token, usuario } = await verificarEmail({ email, codigo })
      guardarSesion(token, usuario)
      navegar('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  if (paso === 'codigo') {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Confirmá tu email</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Te "mandamos" un código de 6 dígitos a{' '}
              <strong className="text-foreground">{email}</strong>.
            </p>
            {codigoDemo && (
              <p className="text-sm text-muted-foreground">
                <Badge variant="outline">demo</Badge> el código es{' '}
                <strong className="text-foreground">{codigoDemo}</strong>
              </p>
            )}
            <form className="grid gap-4" onSubmit={confirmar}>
              <div className="grid gap-1.5">
                <Label htmlFor="codigo">Código</Label>
                <Input
                  id="codigo"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={cargando} className="w-full">
                {cargando ? 'Verificando…' : 'Verificar y entrar'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Creá tu cuenta</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={enviarDatos}>
            <div className="grid gap-1.5">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={cargando} className="w-full">
              {cargando ? 'Creando cuenta…' : 'Crear cuenta'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
