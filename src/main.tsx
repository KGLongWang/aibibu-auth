import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { AccountPage } from './account-page'
import { App } from './App'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Auth root element is missing')
}

const accountPage = window.location.pathname === '/account'

createRoot(root).render(
  <StrictMode>
    {accountPage ? <AccountPage /> : <App />}
  </StrictMode>
)
