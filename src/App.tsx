import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import WikiSelector from './components/VaultSelector'
import Layout from './components/Layout'
import WikiPage from './components/WikiPage'
import GraphView from './components/GraphView'
import LogView from './components/LogView'
import AISearch from './components/AISearch'

function WikiIndexRedirect() {
  const { wikiId } = useParams<{ wikiId: string }>()
  return <Navigate to={`/wiki/${wikiId}/page/index`} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Front page — wiki selector */}
        <Route path="/" element={<WikiSelector />} />

        {/* Wiki-scoped routes */}
        <Route path="/wiki/:wikiId" element={<Layout />}>
          <Route index element={<WikiIndexRedirect />} />
          <Route path="page/*" element={<WikiPage />} />
          <Route path="graph" element={<GraphView />} />
          <Route path="log" element={<LogView />} />
          <Route path="search" element={<AISearch />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
