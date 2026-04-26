import { useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/Select'
import { useSettingsStore } from '../store'
import { useToastStore } from '../store'
import { ShieldCheck, FolderSearch } from 'lucide-react'

export function SettingsPage() {
  const {
    settings,
    fetchSettings,
    saveSettings,
    apiKey,
    model,
    baseUrl,
    setApiKey,
    setModel,
    setBaseUrl,
    setVerificationMessage,
    loadProviderConfig,
    verifyApiKey,
    chooseStoragePath,
  } = useSettingsStore()
  const { success, error, warning, info } = useToastStore()
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('openai')
  const [storagePath, setStoragePath] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    const s = settings || useSettingsStore.getState().settings
    if (s) {
      const normalizedProvider = s.provider === 'anthropic' ? 'anthropic' : 'openai'
      setProvider(normalizedProvider)
      setStoragePath(s.storagePath || '')
    }
  }, [settings])

  useEffect(() => {
    loadProviderConfig(provider)
    setVerificationMessage(null)
  }, [provider, loadProviderConfig])

  const providerLabel = provider === 'openai' ? 'OpenAI' : 'Claude'

  const handleSave = async () => {
    if (!storagePath.trim()) {
      warning('请先选择存储目录')
      return
    }
    setSaving(true)
    setVerificationMessage(null)
    try {
      await saveSettings({
        provider,
        storagePath,
        providerConfigs: {
          [provider]: {
            model: model.trim(),
            apiKey: apiKey.trim(),
            baseUrl: baseUrl.trim(),
          },
        },
      })
      const saveError = useSettingsStore.getState().verificationMessage
      if (saveError) {
        error('设置保存失败', { description: saveError })
        return
      }
      success('设置已保存', { description: '配置已写入本地' })
    } catch (e) {
      error('设置保存失败', {
        description: e instanceof Error ? e.message : '请稍后重试',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleVerify = async () => {
    if (!apiKey.trim()) {
      warning('请先填写 api_key')
      return
    }
    if (!model.trim()) {
      warning('请先填写 model')
      return
    }

    setVerifying(true)
    setVerificationMessage(null)
    try {
      const valid = await verifyApiKey(provider, apiKey, model, baseUrl)
      const verifyMessage = useSettingsStore.getState().verificationMessage
      if (valid) {
        success('API Key 验证通过', {
          description: verifyMessage || '当前配置可正常调用模型',
        })
      } else {
        error('API Key 验证失败', {
          description: verifyMessage || '请检查 model / api_key / base_url',
        })
      }
    } finally {
      setVerifying(false)
    }
  }

  const handleChoosePath = async () => {
    const path = await chooseStoragePath()
    const pathError = useSettingsStore.getState().storagePathError
    if (pathError) {
      error('选择目录失败', { description: pathError })
      return
    }
    if (path) {
      setStoragePath(path)
      info('存储路径已更新', { description: path })
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Preferences</p>
        <h1 className="organic-serif mt-2 text-[32px] font-semibold leading-none text-[#3e4a32]">系统设置</h1>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>模型接入</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Provider 预设</label>
            <Select value={provider} onValueChange={(v) => setProvider(v === 'openai' ? 'openai' : 'anthropic')}>
              <SelectTrigger>
                <SelectValue placeholder="选择 Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Claude (Anthropic)</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">model</label>
            <Input
              placeholder="例如：deepseek-v4/gpt-5.4"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <p className="mt-2 text-xs text-muted-foreground">只要该 provider 兼容这个模型名即可，不做限制。</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">base_url</label>
            <Input
              placeholder="例如：https://api.deepseek.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="mt-2 text-xs text-muted-foreground">请填写兼容 provider 协议的服务地址。</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">api_key</label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={`输入 ${providerLabel} 的 API Key`}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button
                variant="secondary"
                onClick={handleVerify}
                disabled={verifying}
                className="h-11 min-w-[104px] shrink-0 rounded-lg border border-[#7ea06f]/45"
              >
                <ShieldCheck className="mr-1.5 h-4 w-4" />
                {verifying ? '验证中…' : '验证'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">会使用当前 provider 预设下的 model / api_key / base_url 做一次真实连通性校验。（本地ollama随便填写值）</p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>存储</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">存储路径</label>
            <div className="flex gap-2">
              <Input value={storagePath} readOnly placeholder="请先选择存储目录" className="min-w-0 flex-1" />
              <Button
                variant="secondary"
                onClick={handleChoosePath}
                className="h-11 min-w-[104px] shrink-0 rounded-lg border border-[#7ea06f]/45"
              >
                <FolderSearch className="mr-1.5 h-4 w-4" />
                选择
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">新建会话时生成创意结果会写入这个目录。</p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} className="w-full" disabled={saving}>
        {saving ? '保存中…' : '保存设置'}
      </Button>
    </div>
  )
}
