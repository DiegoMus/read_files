import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  })
}

export default function Historial() {
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchContracts = async () => {
      try {
        const { data } = await axios.get(`${API_URL}/api/contracts`)
        setContracts(data)
      } catch (err) {
        setError(err.response?.data?.error || 'Error al cargar el historial')
      } finally {
        setLoading(false)
      }
    }
    fetchContracts()
  }, [])

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Historial de Contratos</h1>
          <p className="text-gray-500 mt-1">Todos los contratos procesados</p>
        </div>
        <Link
          to="/"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          + Cargar Contrato
        </Link>
      </div>

      {loading && (
        <div className="text-center py-20 text-gray-400">
          <svg className="animate-spin h-8 w-8 mx-auto mb-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Cargando historial...
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          ⚠️ {error}
        </div>
      )}

      {!loading && !error && contracts.length === 0 && (
        <div className="text-center py-20">
          <p className="text-5xl mb-4">📭</p>
          <p className="text-gray-500 text-lg">No hay contratos registrados aún</p>
          <Link to="/" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
            Cargar primer contrato →
          </Link>
        </div>
      )}

      {!loading && !error && contracts.length > 0 && (
        <div className="bg-white shadow rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Requisición</th>
                  <th className="px-4 py-3 text-left">Proveedor</th>
                  <th className="px-4 py-3 text-left">Contratante</th>
                  <th className="px-4 py-3 text-left">Inicio</th>
                  <th className="px-4 py-3 text-left">Fin</th>
                  <th className="px-4 py-3 text-left">Tipo SLA</th>
                  <th className="px-4 py-3 text-center">Term. Anticip.</th>
                  <th className="px-4 py-3 text-center">Tipo Doc</th>
                  <th className="px-4 py-3 text-left">Fecha Carga</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contracts.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{c.requisicion || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{c.proveedor || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{c.contratante || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(c.inicio)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(c.fin)}</td>
                    <td className="px-4 py-3 text-gray-600">{c.tipo_sla || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {c.terminacion_anticipada ? '✅' : '❌'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                          c.tipo_documento === 'digital'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {c.tipo_documento === 'digital' ? '🟢 Digital' : '🟡 OCR'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {c.created_at
                        ? new Date(c.created_at).toLocaleString('es-MX', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  )
}
