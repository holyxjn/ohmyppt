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
import {
  CONFIGURABLE_MODEL_TIMEOUT_PROFILES,
  type ConfigurableModelTimeoutProfile,
  resolveModelTimeoutMs,
} from '@shared/model-timeout.js'

export function SettingsPage(): React.JSX.Element {
  const {
    fetchSettings,
    saveSettings,
    apiKey,
    model,
    baseUrl,
    timeoutSeconds,
    setApiKey,
    setModel,
    setBaseUrl,
    setTimeoutSeconds,
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
  const timeoutFields: Array<{
    profile: ConfigurableModelTimeoutProfile
    label: string
    hint: string
    min: number
  }> = [
    {
      profile: 'planning',
      label: t('settings.timeoutPlanning'),
      hint: t('settings.timeoutPlanningHint'),
      min: 120
    },
    {
      profile: 'design',
      label: t('settings.timeoutDesign'),
      hint: t('settings.timeoutDesignHint'),
      min: 120
    },
    {
      profile: 'agent',
      label: t('settings.timeoutAgent'),
      hint: t('settings.timeoutAgentHint'),
      min: 300
    },
    {
      profile: 'document',
      label: t('settings.timeoutDocument'),
      hint: t('settings.timeoutDocumentHint'),
      min: 300
    }
  ]

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
            baseUrl: baseUrl.trim(),
            timeouts: Object.fromEntries(
              CONFIGURABLE_MODEL_TIMEOUT_PROFILES.map((profile) => [
                profile,
                resolveModelTimeoutMs(timeoutSeconds[profile] * 1000, profile)
              ])
            ) as Record<ConfigurableModelTimeoutProfile, number>
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
      const valid = await verifyApiKey(
        provider,
        apiKey,
        model,
        baseUrl,
        resolveModelTimeoutMs(undefined, 'verify')
      )
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
      <div className="mb-5">
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
          <TabsTrigger value="advanced">{t('settings.advancedTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.interface')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <div>
                <label className="mb-1.5 block text-sm font-medium">{t('settings.language')}</label>
                <Select value={lang} onValueChange={(v) => setLang(v === 'en' ? 'en' : 'zh')}>
                  <SelectTrigger className="h-10">
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
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.storage')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  {t('settings.storagePath')}
                </label>
                <div className="flex gap-2">
                  <Input
                    value={storagePath}
                    readOnly
                    placeholder={t('settings.storagePlaceholder')}
                    className="h-10 min-w-0 flex-1"
                  />
                  <Button
                    variant="secondary"
                    onClick={handleChoosePath}
                    className="h-10 min-w-[96px] shrink-0 rounded-lg border border-[#7ea06f]/45 px-4"
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
          <Card className="mb-4">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.modelAccess')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  {t('settings.providerPreset')}
                </label>
                <Select
                  value={provider}
                  onValueChange={(v) => setProvider(v === 'openai' ? 'openai' : 'anthropic')}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder={t('settings.providerPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Claude (Anthropic)</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">model</label>
                <Input
                  placeholder={t('settings.modelPlaceholder')}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="h-10"
                />
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.modelHint')}</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">base_url</label>
                <Input
                  placeholder={t('settings.baseUrlPlaceholder')}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="h-10"
                />
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.baseUrlHint')}</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">api_key</label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={t('settings.apiKeyPlaceholder', { provider: providerLabel })}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="h-10 min-w-0 flex-1"
                  />
                  <Button
                    variant="secondary"
                    onClick={handleVerify}
                    disabled={verifying}
                    className="h-10 min-w-[96px] shrink-0 rounded-lg border border-[#7ea06f]/45 px-4"
                  >
                    <ShieldCheck className="mr-1.5 h-4 w-4" />
                    {verifying ? t('settings.verifying') : t('settings.verify')}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.verifyHint')}</p>
              </div>

            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSaveModel} disabled={savingModel}>
              {savingModel ? t('common.saving') : t('settings.saveModel')}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="advanced">
          <Card className="mb-4">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.timeoutSection')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <p className="text-xs text-muted-foreground">{t('settings.timeoutHint')}</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {timeoutFields.map((field) => (
                  <div key={field.profile}>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {field.label}
                    </label>
                    <Input
                      type="number"
                      min={field.min}
                      max={3600}
                      step={30}
                      placeholder={t('settings.timeoutPlaceholder')}
                      value={timeoutSeconds[field.profile]}
                      onChange={(e) => setTimeoutSeconds(field.profile, Number(e.target.value))}
                      className="h-10"
                    />
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {field.hint}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSaveModel} disabled={savingModel}>
              {savingModel ? t('common.saving') : t('settings.saveModel')}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
