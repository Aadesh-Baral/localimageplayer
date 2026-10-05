import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import SharedView from './SharedView.jsx'
import './styles.css'

/** /s/<token> is a shared collection — a separate, read-only page. */
const shareToken = () => window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]{20,64})\/?$/)?.[1] || null

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {shareToken() ? <SharedView token={shareToken()} /> : <App />}
  </React.StrictMode>
)
