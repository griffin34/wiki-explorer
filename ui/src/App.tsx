import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import VaultSelector from './components/VaultSelector'
import Layout from './components/Layout'
import WikiPage from './components/WikiPage'
import GraphView from './components/GraphView'
import LogView from './components/LogView'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Front page — vault selector */}
        <Route path="/" element={<VaultSelector />} />

        {/* Vault-scoped routes */}
        <Route path="/vault/:vaultId" element={<Layout />}>
          <Route index element={<Navigate to="wiki/index" replace />} />
          <Route path="wiki/*" element={<WikiPage />} />
          <Route path="graph" element={<GraphView />} />
          <Route path="log" element={<LogView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
