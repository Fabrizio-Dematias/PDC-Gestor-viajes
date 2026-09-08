import { Checkbox } from '@/components/ui/checkbox.jsx'
import { Label } from '@/components/ui/label.jsx'
import { VERTICALES } from '../../dominio/verticales.jsx'

/**
 * Capa automática de preferencias: el usuario dice qué le interesa y el
 * agregador deja de pedir el resto.
 *
 * Vale la pena notar por qué está acá y no sólo en "opciones": reduce la
 * superficie de fallo que ese usuario puede llegar a ver. Personalización
 * y resiliencia terminan siendo el mismo mecanismo.
 */
export default function EncuestaPreferencias({ preferencias, onCambiar }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">¿Qué querés que busquemos?</legend>
      {VERTICALES.map((v) => (
        <Label
          key={v.id}
          htmlFor={`pref-${v.id}`}
          className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal has-[[data-checked]]:border-primary has-[[data-checked]]:bg-accent"
        >
          <Checkbox
            id={`pref-${v.id}`}
            checked={Boolean(preferencias[v.id])}
            onCheckedChange={(checked) => onCambiar(v.id, checked)}
          />
          <span aria-hidden="true">{v.icono}</span>
          <span className="grid gap-0.5">
            <span className="font-medium text-foreground">{v.titulo}</span>
            <span className="text-xs text-muted-foreground">{v.descripcionPreferencia}</span>
          </span>
        </Label>
      ))}
    </fieldset>
  )
}
