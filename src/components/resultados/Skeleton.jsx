import { Skeleton as Hueso } from '@/components/ui/skeleton.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'

export default function Skeleton({ filas = 4 }) {
  return (
    <ul className="grid gap-3" aria-hidden="true">
      {Array.from({ length: filas }, (_, i) => (
        <li key={i}>
          <Card>
            <CardContent className="flex items-center gap-4">
              <Hueso className="size-10 shrink-0 rounded-md" />
              <div className="flex-1 space-y-2">
                <Hueso className="h-4 w-1/3" />
                <Hueso className="h-3 w-2/3" />
                <Hueso className="h-3 w-1/4" />
              </div>
              <Hueso className="h-5 w-14 shrink-0" />
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
