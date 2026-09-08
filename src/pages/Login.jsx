import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { iniciarSesion, reenviarCodigo, verificarEmail } from '../api/auth.js'
import { useSesion } from '../estado/sesion.js'

/**
 * Login único, centralizado (contrato §10): un mismo formulario para
 * clientes (identificador = email, exige verificación) y
 * administradores (identificador = username, no la exige) — el backend
 * ya resuelve los dos casos con la misma consulta
 * (`WHERE email = $1 OR username = $1` en `servidor/usuarios/index.js`),
 * así que separarlos en dos pantallas era una distinción sólo visual.
 * Después de loguear, el rol que vuelve en el token decide a dónde va.
 */
export default function Login() {
  const navegar = useNavigate()
  const { guardarSesion } = useSesion()

  const [identificador, setIdentificador] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(false)

  const [pendienteDeVerificar, setPendienteDeVerificar] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [codigoDemo, setCodigoDemo] = useState(null)

  async function entrar(e) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      const { token, usuario } = await iniciarSesion({ identificador, password })
      guardarSesion(token, usuario)
      navegar(usuario.rol === 'admin' ? '/admin' : '/')
    } catch (err) {
      if (err.motivo === 'email_no_verificado') {
        setPendienteDeVerificar(true)
      } else {
        setError(err.motivo === 'credenciales_invalidas' ? 'Credenciales incorrectas.' : err.message)
      }
    } finally {
      setCargando(false)
    }
  }

  async function reenviar() {
    setError(null)
    try {
      const { codigo_demo } = await reenviarCodigo({ email: identificador })
      setCodigoDemo(codigo_demo ?? null)
    } catch (err) {
      setError(err.message)
    }
  }

  async function confirmarCodigo(e) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      const { token, usuario } = await verificarEmail({ email: identificador, codigo })
      guardarSesion(token, usuario)
      navegar('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  if (pendienteDeVerificar) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Verificá tu email</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Todavía no confirmaste <strong className="text-foreground">{identificador}</strong>.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={reenviar} className="justify-self-start">
              Reenviar código
            </Button>
            {codigoDemo && (
              <p className="text-sm text-muted-foreground">
                <Badge variant="outline">demo</Badge> el código es <strong className="text-foreground">{codigoDemo}</strong>
              </p>
            )}
            <form className="grid gap-4" onSubmit={confirmarCodigo}>
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
          <CardTitle>Iniciar sesión</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={entrar}>
            <div className="grid gap-1.5">
              <Label htmlFor="identificador">Email o usuario</Label>
              <Input
                id="identificador"
                type="text"
                autoComplete="username"
                value={identificador}
                onChange={(e) => setIdentificador(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={cargando} className="w-full">
              {cargando ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          ¿No tenés cuenta?&nbsp;
          <Link to="/registro" className="font-medium text-primary hover:underline">
            Creá una
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
