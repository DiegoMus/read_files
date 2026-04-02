import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import Upload from './pages/Upload.jsx'
import Historial from './pages/Historial.jsx'

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <Routes>
        <Route path="/" element={<Upload />} />
        <Route path="/historial" element={<Historial />} />
      </Routes>
    </div>
  )
}
