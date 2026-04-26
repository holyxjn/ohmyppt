import { Toaster } from 'sonner'
import 'sonner/dist/styles.css'

export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        className: 'app-no-drag',
      }}
    />
  )
}

