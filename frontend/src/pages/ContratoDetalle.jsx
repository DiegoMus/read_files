import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import axios from 'axios'
import { GiCheckMark, GiCancel, GiBookmarklet } from 'react-icons/gi'
import { IoArrowBack } from 'react-icons/io5'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-GT', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
  })
}

function SiNo({ value }) {
  const v = (value || '').toUpperCase()
  if (v === 'SI' || v === 'SÍ')
    return <span className="inline-flex items-center gap-1 text-green-700 font-semibold"><GiCheckMark /> Sí</span>
  return <span className="inline-flex items-center gap-1 text-red-500 font-semibold"><GiCancel /> No</span>
}

function Badge({ value, colorMap }) {
  const colors = colorMap?.[value] || 'bg-gray-100 text-gray-700'
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${colors}`}>{value || '—'}</span>
}

function Field({ label, value, wide }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-gray-800 mt-0.5">{value || '—'}</p>
    </div>
  )
}

function Section({ title, icon, color, children }) {
  return (
    <div className={`border rounded-xl overflow-hidden ${color}`}>
      <div className="px-5 py-3 border-b bg-opacity-50">
        <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
          <span>{icon}</span> {title}
        </h3>
      </div>
      <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        {children}
      </div>
    </div>
  )
}

const criticidadColors = {
  'MUY ALTA': 'bg-red-100 text-red-800',
  'ALTA': 'bg-orange-100 text-orange-800',
  'MEDIA': 'bg-yellow-100 text-yellow-800',
  'BAJA': 'bg-green-100 text-green-700',
  'MUY BAJA': 'bg-gray-100 text-gray-600',
}

const dependenciaColors = {
  'ALTA': 'bg-red-100 text-red-800',
  'MEDIA': 'bg-yellow-100 text-yellow-800',
  'BAJA': 'bg-green-100 text-green-700',
}

export default function ContratoDetalle() {
  const { id } = useParams()
  const [contract, setContract] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data } = await axios.get(`${API_URL}/api/contracts/${id}`)
        setContract(data)
      } catch (err) {
        setError(err.response?.data?.error || 'Error al cargar el contrato')
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [id])

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-20 text-center text-gray-400">
        <svg className="animate-spin h-8 w-8 mx-auto mb-3" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Cargando contrato...
      </main>
    )
  }

  if (error) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-10">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">⚠️ {error}</div>
        <Link to="/historial" className="mt-4 inline-block text-blue-600 hover:underline text-sm">← Volver al historial</Link>
      </main>
    )
  }

  const s = contract?.sib_data || {}

  // Fallback: si no hay sib_data, usar los campos legacy
  const proveedor = s.Proveedor || contract?.proveedor || '—'
  const contratante = s.Contratante || contract?.contratante || '—'

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link to="/historial" className="text-blue-600 hover:underline text-sm flex items-center gap-1 mb-2">
            <IoArrowBack /> Volver al historial
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <GiBookmarklet /> Detalle del Contrato
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Requisición: <span className="font-semibold text-gray-700">{contract?.requisicion || '—'}</span>
            {' · '}ID: {contract?.id}
          </p>
        </div>
        <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold ${
          contract?.tipo_documento === 'digital' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
        }`}>
          {contract?.tipo_documento === 'digital' ? '📄 Digital' : '🖼️ OCR'}
        </span>
      </div>

      {/* ── Sección 1: Datos base ── */}
      <Section title="Datos del Contrato" icon="📋" color="border-blue-200">
        <Field label="Contratante" value={contratante} />
        <Field label="Proveedor" value={proveedor} />
        <Field label="Fecha de suscripción" value={formatDate(s.fecha_suscripcion || contract?.inicio)} />
        <Field label="Última renovación" value={formatDate(s.fecha_ultima_renovacion)} />
        <Field label="Fecha vencimiento" value={formatDate(s.fecha_vencimiento || contract?.fin)} />
        <Field label="Contrato suscrito" value={<SiNo value={s.contrato_suscrito || 'SI'} />} />
        <Field label="Monto" value={s.Monto ? `${Number(s.Monto).toLocaleString('es-GT')}` : contract?.monto || '—'} />
        <Field label="Moneda" value={s.Moneda || contract?.moneda} />
        <Field label="Descripción del servicio" value={s.descripcion_servicio} wide />
        <Field label="Proceso que apoya" value={s.descripcion_proceso} wide />
        <Field label="Entidad intragrupo" value={<SiNo value={s.entidad_intragrupo} />} />
        <Field label="Autorización subcontratación" value={<SiNo value={s.autorizacion_subcontratacion} />} />
        <Field label="Tipo de mantenimiento" value={s.tipo_mantenimiento} />
      </Section>

      {/* ── Sección 2: Cláusulas contractuales ── */}
      <Section title="Cláusulas Contractuales" icon="⚖️" color="border-amber-200">
        <Field label="SLA de servicio formal" value={<SiNo value={s.sla_servicio_formal} />} />
        <Field label="SLA de incidentes formal" value={<SiNo value={s.sla_incidentes_formal} />} />
        {s.sla_servicio_descripcion && (
          <Field label="Detalle SLA servicio" value={s.sla_servicio_descripcion} wide />
        )}
        {s.sla_incidentes_descripcion && (
          <Field label="Detalle SLA incidentes" value={s.sla_incidentes_descripcion} wide />
        )}
        <Field label="Acuerdos de confidencialidad" value={<SiNo value={s.confidencialidad} />} />
        <Field label="Acceso libre de la SIB" value={<SiNo value={s.acceso_sib} />} />
        <Field label="Evaluación del servicio por el banco" value={<SiNo value={s.evaluacion_servicio_banco} />} />
        <Field label="Continuidad del servicio" value={<SiNo value={s.continuidad_servicio} />} />
        <Field label="Terminación anticipada" value={<SiNo value={s.terminacion_anticipada} />} />
        <Field label="Obligaciones post-terminación" value={<SiNo value={s.obligaciones_post_terminacion} />} />
        <Field label="Penalizaciones por incumplimiento" value={<SiNo value={s.penalizaciones_incumplimiento} />} />
        {s.penalizaciones_detalle && (
          <Field label="Detalle de penalizaciones" value={s.penalizaciones_detalle} wide />
        )}
        <Field label="Evaluación cumplimiento SLA" value={<SiNo value={s.evaluacion_cumplimiento_sla} />} />
      </Section>

      {/* ── Sección 3: Riesgo y operación ── */}
      <Section title="Riesgo y Operación" icon="🛡️" color="border-red-200">
        <Field label="Proceso crítico" value={<SiNo value={s.proceso_critico} />} />
        <Field label="Criticidad del servicio" value={<Badge value={s.criticidad_servicio} colorMap={criticidadColors} />} />
        <Field label="Nivel de dependencia" value={<Badge value={s.nivel_dependencia} colorMap={dependenciaColors} />} />
        <Field label="Información crítica/confidencial" value={<SiNo value={s.informacion_critica} />} />
        <Field label="Tipo de información" value={s.tipo_informacion} />
        <Field label="Detalle información" value={s.detalle_informacion} wide />
        <Field label="Planes de contingencia proveedor" value={<SiNo value={s.planes_contingencia} />} />
        <Field label="Pruebas de continuidad informadas" value={<SiNo value={s.pruebas_continuidad} />} />
        <Field label="Planes alternos del banco" value={<SiNo value={s.planes_alternos_banco} />} />
        <Field label="Nube" value={s.nube} />
        <Field label="Activo ciberespacio" value={<SiNo value={s.activo_ciberespacio} />} />
        <Field label="Categoría del activo" value={s.categoria_activo} />
        <Field label="Esquema de conectividad" value={s.esquema_conectividad} />
      </Section>

      {/* ── Consumo ── */}
      {contract?.tokens && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-500">
          <p className="font-semibold mb-1">📊 Consumo del análisis</p>
          <p>Modelo: {contract.tokens.modelo} ({contract.tokens.modo})</p>
          <p>Tokens totales: {contract.tokens.total?.toLocaleString()}</p>
          {contract.tokens.pasadas && <p>Pasadas: {contract.tokens.pasadas}</p>}
          <p>Costo: $0.00 USD (modelo local)</p>
        </div>
      )}
    </main>
  )
}
