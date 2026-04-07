import { useEffect, useState } from 'react'
import { FcDocument } from "react-icons/fc";
import { GiBeastEye, GiMoneyStack, GiTakeMyMoney, GiCalendar, GiAbstract024,GiMushroomHouse , GiChart   } from "react-icons/gi";
import { RiPageSeparator } from "react-icons/ri";
import { RxTokens } from "react-icons/rx";
import { MdGeneratingTokens, MdBatchPrediction } from "react-icons/md";
import { FaHouse, FaCloud } from "react-icons/fa6";


const API = 'http://localhost:3001'

function StatCard({ icon, label, value, sub, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50 border-blue-200 text-blue-700',
    green:  'bg-green-50 border-green-200 text-green-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    red:    'bg-red-50 border-red-200 text-red-700',
    gray:   'bg-gray-50 border-gray-200 text-gray-700',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="text-2xl mb-1 flex items-center">{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm font-medium">{label}</div>
      {sub && <div className="text-xs mt-1 opacity-70">{sub}</div>}
    </div>
  )
}

function BarChart({ data, keyX, keyY, color = '#3b82f6' }) {
  if (!data || data.length === 0) return <p className="text-gray-400 text-sm">Sin datos</p>

  const values = data.map(d => parseFloat(d[keyY]) || 0)
  const max    = Math.max(...values) || 1

  const formatDate    = (val) => String(val).slice(5, 10)
  const formatTooltip = (val) => String(val).slice(0, 10)

  return (
    <div className="flex items-end gap-1" style={{ height: '120px' }}>
      {data.map((d, i) => {
        const val = parseFloat(d[keyY]) || 0
        const px  = Math.max(Math.round((val / max) * 100), 4)
        return (
          <div
            key={i}
            className="group relative"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}
          >
            {/* Tooltip */}
            <div
              className="absolute opacity-0 group-hover:opacity-100 bg-gray-800 text-white rounded whitespace-nowrap z-10"
              style={{ top: '0px', left: '50%', transform: 'translateX(-50%)', fontSize: '11px', padding: '2px 6px' }}
            >
              {formatTooltip(d[keyX])}: {val.toLocaleString()}
            </div>

            {/* Barra */}
            <div
              style={{
                width: '100%',
                height: `${px}px`,
                backgroundColor: color,
                borderRadius: '4px 4px 0 0',
                transition: 'height 0.3s',
              }}
            />

            {/* Fecha */}
            <div style={{ fontSize: '9px', color: '#9ca3af', marginTop: '3px', textAlign: 'center' }}>
              {formatDate(d[keyX])}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    fetch(`${API}/api/stats`)
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false) })
      .catch(() => { setError('No se pudieron cargar las estadísticas'); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-500">
      <div className="text-center">
        <div className="text-4xl mb-2">⏳</div>
        <p>Cargando estadísticas...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">{error}</div>
    </div>
  )

  const { resumen, proyeccion, por_dia, por_modelo } = stats
  const totalCosto = (parseFloat(resumen.total_costo_usd) + parseFloat(resumen.total_vision_costo_usd)).toFixed(4)
  console.log('por_dia:', por_dia)
  console.log('por_dia:', JSON.stringify(por_dia, null, 2))
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-800"> <GiChart  className="inline-block mr-1" /> Dashboard de Uso</h1>
        <p className="text-gray-500 text-sm mt-1">
          Métricas de procesamiento de contratos
          {resumen.primer_contrato && (
            <> · desde {new Date(resumen.primer_contrato).toLocaleDateString('es-GT')}</>
          )}
        </p>
      </div>

      {/* KPIs principales */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Resumen General</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<FcDocument />} label="Contratos procesados"  value={resumen.total_contratos}                        color="blue" />
          <StatCard icon={<GiBeastEye />} label="Documentos OCR"        value={resumen.total_ocr}        sub={`${resumen.total_digital} digitales`} color="orange" />
          <StatCard icon={<RiPageSeparator />} label="Páginas OCR totales"   value={resumen.total_vision_pages} sub={`~${resumen.avg_paginas_por_contrato} pág/contrato`} color="purple" />
          <StatCard icon={<MdGeneratingTokens />} label="Tokens consumidos"     value={resumen.total_tokens.toLocaleString()} sub={`~${resumen.avg_tokens_por_contrato.toLocaleString()} por contrato`} color="blue" />
        </div>
      </div>

      {/* Costos */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Costos</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<GiMoneyStack />} label="Costo total IA"        value={`$${resumen.total_costo_usd}`}       sub="USD (Gemini/Ollama)"  color="green" />
          <StatCard icon={<GiMoneyStack />} label="Costo total Vision"    value={`$${resumen.total_vision_costo_usd}`} sub="USD (OCR Google)"    color="green" />
          <StatCard icon={<GiTakeMyMoney />} label="Costo combinado total" value={`$${totalCosto}`}                    sub="IA + Vision USD"       color="green" />
          <StatCard icon={<GiMoneyStack />} label="Costo promedio/contrato" value={`$${resumen.avg_costo_por_contrato}`} sub="USD por análisis"   color="gray" />
        </div>
      </div>

      {/* Tokens desglosados */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Detalle de Tokens</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-sm text-gray-500 mb-1">Tokens Input (prompt)</div>
            <div className="text-xl font-bold text-gray-800">{resumen.total_tokens_input.toLocaleString()}</div>
            <div className="mt-2 bg-blue-100 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${resumen.total_tokens > 0 ? (resumen.total_tokens_input / resumen.total_tokens * 100).toFixed(0) : 0}%` }} />
            </div>
            <div className="text-xs text-gray-400 mt-1">{resumen.total_tokens > 0 ? (resumen.total_tokens_input / resumen.total_tokens * 100).toFixed(1) : 0}% del total</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-sm text-gray-500 mb-1">Tokens Output (respuesta)</div>
            <div className="text-xl font-bold text-gray-800">{resumen.total_tokens_output.toLocaleString()}</div>
            <div className="mt-2 bg-purple-100 rounded-full h-2">
              <div className="bg-purple-500 h-2 rounded-full" style={{ width: `${resumen.total_tokens > 0 ? (resumen.total_tokens_output / resumen.total_tokens * 100).toFixed(0) : 0}%` }} />
            </div>
            <div className="text-xs text-gray-400 mt-1">{resumen.total_tokens > 0 ? (resumen.total_tokens_output / resumen.total_tokens * 100).toFixed(1) : 0}% del total</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-sm text-gray-500 mb-1">Promedio tokens/contrato</div>
            <div className="text-xl font-bold text-gray-800">{resumen.avg_tokens_por_contrato.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mt-3">Total: {resumen.total_tokens.toLocaleString()} tokens</div>
          </div>
        </div>
      </div>

      {/* Gráficas por día */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1"> <GiCalendar className="inline-block mr-1" /> Contratos por día</h3>
          <p className="text-xs text-gray-400 mb-2">Últimos 30 días</p>
          <BarChart data={por_dia} keyX="dia" keyY="contratos" color="#3b82f6" />
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1"> <RxTokens className="inline-block mr-1" /> Tokens por día</h3>
          <p className="text-xs text-gray-400 mb-2">Últimos 30 días</p>
          <BarChart data={por_dia} keyX="dia" keyY="tokens" color="#8b5cf6" />
        </div>
      </div>

      {/* Modelos usados */}
      {por_modelo && por_modelo.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Modelos de IA Utilizados</h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Modelo</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Modo</th>
                  <th className="text-right px-4 py-3 text-gray-600 font-medium">Contratos</th>
                  <th className="text-right px-4 py-3 text-gray-600 font-medium">Tokens</th>
                  <th className="text-right px-4 py-3 text-gray-600 font-medium">Costo USD</th>
                </tr>
              </thead>
              <tbody>
                {por_modelo.map((m, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-gray-800">{m.modelo || '—'}</td>
                    <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1 ${m.modo === 'local' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {m.modo === 'local' ? <><GiMushroomHouse /> local</> : <><FaCloud /> cloud</>}
                        </span>
                    </td>
                    <td className="px-4 py-3 text-right">{m.contratos}</td>
                    <td className="px-4 py-3 text-right">{parseFloat(m.tokens_total).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">${parseFloat(m.costo_usd).toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Proyección */}
{/* Proyección */}
<div>
  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"> <MdBatchPrediction className="inline-block mr-1" /> Proyección Mensual (30 días)</h2>

  {/* Alerta free tier */}
  {proyeccion.supera_free_tier ? (
    <div className="mb-3 bg-orange-50 border border-orange-200 rounded-xl p-3 text-orange-700 text-sm">
      <strong>Superas el free tier de Vision API</strong> — proyectas <strong>{proyeccion.proyeccion_mensual_paginas_ocr.toLocaleString()}</strong> páginas OCR/mes.
      Las primeras <strong>1,000</strong> son gratis, las <strong>{proyeccion.vision_paginas_pagas.toLocaleString()}</strong> restantes costarán <strong>${proyeccion.proyeccion_mensual_costo_vision}</strong> USD.
    </div>
  ) : (
    <div className="mb-3 bg-green-50 border border-green-200 rounded-xl p-3 text-green-700 text-sm">
      <strong>Dentro del free tier de Vision API</strong> — proyectas <strong>{proyeccion.proyeccion_mensual_paginas_ocr.toLocaleString()}</strong> páginas OCR/mes
      {proyeccion.contratos_hasta_free_tier && (
        <> · el free tier aguanta hasta <strong>{proyeccion.contratos_hasta_free_tier}</strong> contratos/mes</>
      )}.
    </div>
  )}

  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    <StatCard
      icon={<GiCalendar/>}
      label="Contratos estimados"
      value={proyeccion.proyeccion_mensual_contratos}
      sub={`${proyeccion.promedio_contratos_dia}/día promedio`}
      color="blue"
    />
    <StatCard
      icon={<MdGeneratingTokens/>}
      label="Tokens estimados"
      value={proyeccion.proyeccion_mensual_tokens.toLocaleString()}
      sub="en 30 días"
      color="purple"
    />
    <StatCard
      icon={<GiMoneyStack/>}
      label="Costo IA estimado"
      value={`$${proyeccion.proyeccion_mensual_costo_ia}`}
      sub="USD Gemini/Ollama"
      color="green"
    />
    <StatCard
      icon={<GiBeastEye/>}
      label="Costo Vision estimado"
      value={`$${proyeccion.proyeccion_mensual_costo_vision}`}
      sub={proyeccion.supera_free_tier
        ? `${proyeccion.vision_paginas_pagas.toLocaleString()} págs pagas`
        : '✅ dentro del free tier'}
      color={proyeccion.supera_free_tier ? 'orange' : 'green'}
    />
  </div>

  {/* Costo total */}
        <div className="mt-3 bg-gray-800 text-white rounded-xl p-4 flex justify-between items-center">
            <div>
            <div className="text-sm text-gray-400">Costo total proyectado (IA + Vision)</div>
            <div className="text-3xl font-bold mt-1">${proyeccion.proyeccion_mensual_costo_total} <span className="text-base font-normal text-gray-400">USD / mes</span></div>
            </div>
            <div className="text-4xl">{<GiAbstract024 className="inline-block mr-1" />}</div>
        </div>

        <p className="text-xs text-gray-400 mt-2">
            * Proyección basada en promedio histórico · Vision API: 1,000 páginas gratis/mes, luego $0.0015/página · Ollama: $0.00
        </p>
        </div>
    </div>
  )
}