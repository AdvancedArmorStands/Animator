import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App, { EmbedApp } from './App.jsx'

const isEmbed = new URLSearchParams(window.location.search).has('embed')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isEmbed ? <EmbedApp /> : <App />}
  </StrictMode>,
)
