import { Routes, Route, Navigate, useLocation, matchPath } from 'react-router-dom'
import { Sidebar } from './components/layout/Sidebar'
import { HomePage } from './pages/home'
import { SessionsPage } from './pages/sessions'
import { SessionDetailPage } from './pages/session-detail'
import { SessionGeneratingPage } from './pages/session-generating'
import { SettingsPage } from './pages/settings'
import { StylesPage } from './pages/styles'
import { StyleEditorPage } from './pages/style-editor'
import { AppToaster } from './components/AppToaster'
import { ScrollArea } from './components/ui/ScrollArea'

function App(): React.JSX.Element {
  const location = useLocation()
  const isSessionDetailRoute = Boolean(matchPath('/sessions/:id/*', location.pathname))

  if (isSessionDetailRoute) {
    return (
      <>
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
          <Routes>
            <Route path="/sessions/:id/generating" element={<SessionGeneratingPage />} />
            <Route path="/sessions/:id" element={<SessionDetailPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <AppToaster />
      </>
    )
  }

  return (
    <>
      <div className="h-full min-h-0 overflow-hidden bg-background text-foreground">
        <div className="flex h-full min-h-0 flex-col">
          <div className="app-drag-region app-titlebar bg-background/85 backdrop-blur-xl" />

          <div className="flex min-h-0 flex-1">
            <aside className="hidden min-h-0 w-[240px] shrink-0 flex-col border-r border-border/70 bg-[#f7f0e2]/40 md:flex">
              <Sidebar />
            </aside>
            <ScrollArea className="min-h-0 flex-1">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/sessions" element={<SessionsPage />} />
                <Route path="/styles" element={<StylesPage />} />
                <Route path="/styles/new" element={<StyleEditorPage />} />
                <Route path="/styles/:styleId" element={<StyleEditorPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ScrollArea>
          </div>
        </div>
      </div>
      <AppToaster />
    </>
  )
}

export default App
