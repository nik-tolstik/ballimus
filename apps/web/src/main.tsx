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
