import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { ipc } from '@renderer/lib/ipc'
import { useToastStore } from '../store'
import { Plus, PencilLine } from 'lucide-react'
import { useT } from '../i18n'

type StyleSummary = {
  id: string
  label: string
  description: string
  source?: 'builtin' | 'custom' | 'override'
  editable?: boolean
  category: string
  createdAt?: number
  updatedAt?: number
}

export function StylesPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [styles, setStyles] = useState<StyleSummary[]>([])
  const { error } = useToastStore()
  const t = useT()

  const loadStyles = useCallback(async (): Promise<void> => {
    try {
      const { items } = await ipc.listStyles()
      const sorted = [...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      setStyles(sorted)
    } catch (e) {
      error(t('styles.loadFailed'), {
        description: e instanceof Error ? e.message : t('common.retryLater'),
      })
    }
  }, [error, t])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStyles()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadStyles])

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('styles.eyebrow')}</p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="organic-serif text-[32px] font-semibold leading-none text-[#3e4a32]">{t('styles.title')}</h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <Button size="sm" className="min-w-[112px]" onClick={() => navigate('/styles/new')}>
              <Plus className="mr-2 h-4 w-4" />
              {t('styles.newStyle')}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t('styles.description')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {styles.map((style) => (
          <Card
            key={style.id}
            className="group !rounded-lg transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(88,75,56,0.18)]"
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="truncate transition-colors duration-200 group-hover:text-foreground">{style.label}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="transition-all duration-200 group-hover:-translate-y-0.5"
                  onClick={() => navigate(`/styles/${style.id}`)}
                >
                  <PencilLine className="mr-1.5 h-3.5 w-3.5" />
                  {t('common.edit')}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="line-clamp-2 text-sm text-muted-foreground transition-colors duration-200 group-hover:text-foreground/85">
                {style.description || style.id}
              </p>
              <p className="mt-2 text-xs text-muted-foreground transition-colors duration-200 group-hover:text-foreground/70">
                {style.category} · {style.source || t('styles.sourceBuiltin')}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
