import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { ipc } from '@renderer/lib/ipc'
import { useToastStore } from '../store'
import { Plus, PencilLine, RefreshCw } from 'lucide-react'

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

export function StylesPage() {
  const navigate = useNavigate()
  const [styles, setStyles] = useState<StyleSummary[]>([])
  const [loading, setLoading] = useState(false)
  const { error, success } = useToastStore()

  const loadStyles = async (showSuccess = false) => {
    setLoading(true)
    try {
      const { items } = await ipc.listStyles()
      const sorted = [...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      setStyles(sorted)
      if (showSuccess) {
        success('风格列表已刷新', { description: `共 ${sorted.length} 个风格` })
      }
    } catch (e) {
      error('风格列表加载失败', {
        description: e instanceof Error ? e.message : '请稍后重试',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStyles()
  }, [])

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Style Lab</p>
          <h1 className="organic-serif mt-2 text-[32px] font-semibold leading-none text-[#3e4a32]">风格管理</h1>
          <p className="mt-2 text-sm text-muted-foreground">内置30+风格，支持自定义风格，点击“编辑”或“新建”进入独立编辑页。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void loadStyles(true)} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button onClick={() => navigate('/styles/new')}>
            <Plus className="mr-2 h-4 w-4" />
            新建风格
          </Button>
        </div>
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
                  编辑
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="line-clamp-2 text-sm text-muted-foreground transition-colors duration-200 group-hover:text-foreground/85">
                {style.description || style.id}
              </p>
              <p className="mt-2 text-xs text-muted-foreground transition-colors duration-200 group-hover:text-foreground/70">
                {style.category} · {style.source || 'builtin'}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
