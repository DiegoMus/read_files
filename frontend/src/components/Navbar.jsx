import { Link, useLocation } from 'react-router-dom'
import { GiCrystalEye } from "react-icons/gi";
import { LuScrollText } from "react-icons/lu";

export default function Navbar() {
  const { pathname } = useLocation()

  const linkClass = (path) =>
    `px-4 py-2 rounded-md text-sm font-medium transition-colors ${
      pathname === path
        ? 'bg-blue-700 text-white'
        : 'text-blue-100 hover:bg-blue-700 hover:text-white'
    }`

  return (
    <nav className="bg-blue-600 shadow-md">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <span className="text-white text-xl font-bold tracking-tight" ><GiCrystalEye className="inline-block mr-3" /> <LuScrollText className="inline-block mr-3" /> Lectura de contratos</span>
        <div className="flex gap-2">
          <Link to="/" className={linkClass('/')}>Cargar Contrato</Link>
          <Link to="/historial" className={linkClass('/historial')}>Historial</Link>
          <Link to="/dashboard" className={linkClass('/dashboard')}>Dashboard</Link>
        </div>
      </div>
    </nav>
  )
}