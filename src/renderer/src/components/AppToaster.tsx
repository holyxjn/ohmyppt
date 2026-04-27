import { Toaster } from 'sonner'
import 'sonner/dist/styles.css'

export function AppToaster(): React.JSX.Element {
  return (
    <Toaster
      position="top-center"
      offset={{ top: 12 }}
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        className: 'app-no-drag'
      }}
    />
  )
}
