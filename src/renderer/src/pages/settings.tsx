import { useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/Select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/Tabs'
import { useSettingsStore } from '../store'
import { useToastStore } from '../store'
import { ShieldCheck, FolderSearch } from 'lucide-react'
import { useLang } from '../i18n'

export function SettingsPage(): React.JSX.Element {
  const {
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
    chooseStoragePath
  } = useSettingsStore()
  const { success, error, warning, info } = useToastStore()
  const { lang, setLang, t } = useLang()
  const [provider, setProvider] = useState<'anthropic' | 'openai'>(() =>
    useSettingsStore.getState().settings?.provider === 'anthropic' ? 'anthropic' : 'openai'
  )
  const [storagePath, setStoragePath] = useState(
    () => useSettingsStore.getState().settings?.storagePath || ''
  )
  const [verifying, setVerifying] = useState(false)
  const [savingModel, setSavingModel] = useState(false)

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    return useSettingsStore.subscribe((state) => {
      const nextSettings = state.settings
      if (!nextSettings) return
      setProvider(nextSettings.provider === 'anthropic' ? 'anthropic' : 'openai')
      setStoragePath(nextSettings.storagePath || '')
    })
  }, [])

  useEffect(() => {
    loadProviderConfig(provider)
    setVerificationMessage(null)
  }, [provider, loadProviderConfig, setVerificationMessage])

  const providerLabel = provider === 'openai' ? 'OpenAI' : 'Claude'

  const handleSaveModel = async (): Promise<void> => {
    setSavingModel(true)
    setVerificationMessage(null)
    try {
      await saveSettings({
        provider,
        providerConfigs: {
          [provider]: {
            model: model.trim(),
            apiKey: apiKey.trim(),
            baseUrl: baseUrl.trim()
          }
        }
      })
      const saveError = useSettingsStore.getState().verificationMessage
      if (saveError) {
        error(t('settings.saveFailed'), { description: saveError })
        return
      }
      success(t('settings.modelSaved'), { description: t('settings.modelSavedDescription') })
    } catch (e) {
      error(t('settings.saveFailed'), {
        description: e instanceof Error ? e.message : t('common.retryLater')
      })
    } finally {
      setSavingModel(false)
    }
  }

  const handleVerify = async (): Promise<void> => {
    if (!apiKey.trim()) {
      warning(t('settings.fillApiKey'))
      return
    }
    if (!model.trim()) {
      warning(t('settings.fillModel'))
      return
    }

    setVerifying(true)
    setVerificationMessage(null)
    try {
      const valid = await verifyApiKey(provider, apiKey, model, baseUrl)
      const verifyMessage = useSettingsStore.getState().verificationMessage
      if (valid) {
        success(t('settings.verifyPassed'), {
          description: verifyMessage || t('settings.verifyPassedDescription')
        })
      } else {
        error(t('settings.verifyFailed'), {
          description: verifyMessage || t('settings.verifyFailedDescription')
        })
      }
    } finally {
      setVerifying(false)
    }
  }

  const handleChoosePath = async (): Promise<void> => {
    const path = await chooseStoragePath()
    const pathError = useSettingsStore.getState().storagePathError
    if (pathError) {
      error(t('settings.choosePathFailed'), { description: pathError })
      return
    }
    if (path) {
      setVerificationMessage(null)
      await saveSettings({ storagePath: path })
      const saveError = useSettingsStore.getState().verificationMessage
      if (saveError) {
        error(t('settings.saveFailed'), { description: saveError })
        return
      }
      setStoragePath(path)
      info(t('settings.storagePathUpdated'), { description: path })
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          {t('settings.eyebrow')}
        </p>
        <h1 className="organic-serif mt-2 text-[32px] font-semibold leading-none text-[#3e4a32]">
          {t('settings.title')}
        </h1>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">{t('settings.generalTab')}</TabsTrigger>
          <TabsTrigger value="model">{t('settings.modelTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.interface')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.language')}</label>
                <Select value={lang} onValueChange={(v) => setLang(v === 'en' ? 'en' : 'zh')}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('settings.languagePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh">{t('settings.chinese')}</SelectItem>
                    <SelectItem value="en">{t('settings.english')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.storage')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('settings.storagePath')}
                </label>
                <div className="flex gap-2">
                  <Input
                    value={storagePath}
                    readOnly
                    placeholder={t('settings.storagePlaceholder')}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    variant="secondary"
                    onClick={handleChoosePath}
                    className="h-11 min-w-[104px] shrink-0 rounded-lg border border-[#7ea06f]/45"
                  >
                    <FolderSearch className="mr-1.5 h-4 w-4" />
                    {t('settings.choose')}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.storageHint')}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="model">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{t('settings.modelAccess')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('settings.providerPreset')}
                </label>
                <Select
                  value={provider}
                  onValueChange={(v) => setProvider(v === 'openai' ? 'openai' : 'anthropic')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('settings.providerPlaceholder')} />
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
                  placeholder={t('settings.modelPlaceholder')}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.modelHint')}</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">base_url</label>
                <Input
                  placeholder={t('settings.baseUrlPlaceholder')}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.baseUrlHint')}</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">api_key</label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={t('settings.apiKeyPlaceholder', { provider: providerLabel })}
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
                    {verifying ? t('settings.verifying') : t('settings.verify')}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.verifyHint')}</p>
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleSaveModel} className="w-full" disabled={savingModel}>
            {savingModel ? t('common.saving') : t('settings.saveModel')}
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  )
}
