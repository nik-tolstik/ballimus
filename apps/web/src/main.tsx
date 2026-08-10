import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { shouldRetryRequest } from '@football/api-client'
import App from './App'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { applicationBrand } from '@/brand'
import './styles.css'

document.title = applicationBrand.name

const favicon = document.createElement('link')
favicon.rel = 'icon'
document.head.append(favicon)

const faviconSource = new Image()
faviconSource.addEventListener('load', () => {
  const size = Math.min(faviconSource.naturalWidth, faviconSource.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) return

  context.beginPath()
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  context.clip()
  context.drawImage(faviconSource, (faviconSource.naturalWidth - size) / 2, (faviconSource.naturalHeight - size) / 2, size, size, 0, 0, size, size)
  favicon.type = 'image/png'
  favicon.href = canvas.toDataURL('image/png')
})
faviconSource.src = applicationBrand.logo

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryRequest,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="football-ui-theme" disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster position="top-center" richColors closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
