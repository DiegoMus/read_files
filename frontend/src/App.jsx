import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import Upload from './pages/Upload.jsx'
import Historial from './pages/Historial.jsx'
import Dashboard from './pages/Dashboard.jsx'
import ContratoDetalle from './pages/ContratoDetalle.jsx'

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <Routes>
        <Route path="/" element={<Upload />} />
        <Route path="/historial" element={<Historial />} />
        <Route path="/contrato/:id" element={<ContratoDetalle />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </div>
  )
}