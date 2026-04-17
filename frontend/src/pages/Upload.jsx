import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import axios from 'axios'
import { GiBattleMech, GiCheckMark, GiNightVision, GiCancel, GiCyberEye, GiBookmarklet } from "react-icons/gi";
import { FaUpload, FaFileContract } from "react-icons/fa6";
import { FcOk } from "react-icons/fc";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const LOADING_MESSAGES = [
  'Extrayendo texto del PDF...',
  'Detectando tipo de documento...',
  'Analizando contenido con IA...',
  'Guardando en base de datos...',
]

export default function Upload() {
  const [requisicion, setRequisicion] = useState('')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState(0)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const onDrop = useCallback((acceptedFiles, rejectedFiles) => {
    if (rejectedFiles.length > 0) {
      const reason = rejectedFiles[0]?.errors?.[0]?.message || 'Archivo no válido'
      setError(reason)
      return
    }
    setFile(acceptedFiles[0])
    setError(null)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: 50 * 1024 * 1024,
    multiple: false,
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!file) return setError('Por favor selecciona un archivo PDF')
    if (!requisicion.trim()) return setError('El número de requisición es requerido')

    setLoading(true)
    setError(null)
    setResult(null)

    let msgIndex = 0
    const msgInterval = setInterval(() => {
      msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length
      setLoadingMsg(msgIndex)
    }, 2500)

    try {
      const formData = new FormData()
      formData.append('contrato', file)
      formData.append('requisicion', requisicion.trim())

      const { data } = await axios.post(`${API_URL}/api/contracts/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      setResult(data)
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.message ||
        'Error al procesar el contrato'
      setError(msg)
    } finally {
      clearInterval(msgInterval)
      setLoading(false)
    }
  }

  const handleReset = () => {
    setFile(null)
    setRequisicion('')
    setResult(null)
    setError(null)
    setLoadingMsg(0)
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-800">
        <FaFileContract className="inline-block mr-1" /> Cargar Contrato
      </h1>
      <p className="text-gray-500 mb-8">
        Sube un contrato en PDF para extraer su información de forma inteligente.
      </p>

      {!result ? (
        /* ── Formulario ── */
        <form onSubmit={handleSubmit} className="bg-white shadow rounded-xl p-6 space-y-6">

          {/* Requisición */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Número de Requisición <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={requisicion}
              onChange={(e) => setRequisicion(e.target.value)}
              placeholder="Ej. REQ-2024-001"
              disabled={loading}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          {/* Dropzone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Archivo PDF <span className="text-red-500">*</span>
            </label>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? 'border-blue-400 bg-blue-50'
                  : file
                  ? 'border-green-400 bg-green-50'
                  : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
              } ${loading ? 'pointer-events-none opacity-60' : ''}`}
            >
              <input {...getInputProps()} />
              {file ? (
                <div className="text-green-700">
                  <p className="text-2xl mb-1"><FcOk /></p>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              ) : isDragActive ? (
                <p className="text-blue-600 font-medium">Suelta el PDF aquí...</p>
              ) : (
                <div className="text-gray-500">
                  <p className="text-3xl mb-2"><FaUpload /></p>
                  <p className="font-medium">Arrastra un PDF aquí, o haz clic para seleccionar</p>
                  <p className="text-sm mt-1">Solo archivos .pdf • Máximo 50MB</p>
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              ⚠️ {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {LOADING_MESSAGES[loadingMsg]}
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <GiBattleMech />
                Analizar Contrato
              </span>
            )}
          </button>
        </form>

      ) : !result.es_contrato ? (
        /* ── Documento NO es contrato ── */
        <div className="bg-white shadow rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">⚠️</span>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Documento no reconocido como contrato</h2>
              <p className="text-sm text-gray-500">{result.mensaje}</p>
            </div>
          </div>

          {/* Tipo y descripción */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo de documento</p>
            <p className="text-gray-800 font-medium">{result.tipo_documento}</p>
            <p className="text-gray-600 text-sm mt-1">{result.descripcion}</p>
          </div>

          {/* Datos relevantes */}
          {result.datos_relevantes && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Datos identificados</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Field label="Título"    value={result.datos_relevantes.titulo} />
                <Field label="Fecha"     value={result.datos_relevantes.fecha} />
                <Field label="Monto"     value={result.datos_relevantes.monto} />
                <Field label="Propósito" value={result.datos_relevantes.proposito} />
              </div>

              {result.datos_relevantes.partes_involucradas?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Partes involucradas
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {result.datos_relevantes.partes_involucradas.map((parte, i) => (
                      <span key={i} className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded-full">
                        {parte}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-gray-400 italic">
            Este documento no fue guardado en la base de datos.
          </p>

          <button
            onClick={handleReset}
            className="w-full mt-2 border border-yellow-500 text-yellow-600 hover:bg-yellow-50 font-semibold py-2.5 rounded-lg transition-colors"
          >
            Subir otro documento
          </button>
        </div>

            
      ) : (
        /* ── Contrato analizado exitosamente ── */
        <div className="bg-white shadow rounded-xl p-6 space-y-4">

          {/* Header con tipo de documento detectado */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-800">
                <GiBookmarklet className="inline-block mr-1" /> Contrato Analizado
              </h2>
              <p className="text-sm font-medium text-blue-600 mt-0.5">
                {result.tipo_documento_detectado || 'Contrato'}
              </p>
              {result.descripcion_documento && (
                <p className="text-xs text-gray-500 mt-0.5">{result.descripcion_documento}</p>
              )}
            </div>
            <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold ${
              result.tipo_documento === 'digital'
                ? 'bg-green-100 text-green-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}>
              {result.tipo_documento === 'digital' ? '📄 Digital' : '🖼️ OCR'}
            </span>
          </div>

          {/* Datos relevantes del documento (de la detección) */}
          {result.datos_relevantes && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
                📋 Información del documento
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {result.datos_relevantes.titulo && (
                  <Field label="Título" value={result.datos_relevantes.titulo} />
                )}
                {result.datos_relevantes.proposito && (
                  <Field label="Propósito" value={result.datos_relevantes.proposito} />
                )}
                {result.datos_relevantes.monto && (
                  <Field label="Monto" value={result.datos_relevantes.monto} />
                )}
              </div>
              {result.datos_relevantes.partes_involucradas?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Partes involucradas
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {result.datos_relevantes.partes_involucradas.map((parte, i) => (
                      <span key={i} className="bg-white border border-blue-200 text-blue-700 text-xs px-2 py-1 rounded-full">
                        {parte}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Campos del contrato */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Field label="Requisición"     value={result.data?.requisicion} />
            <Field label="Proveedor"        value={result.data?.proveedor} />
            <Field label="Contratante"      value={result.data?.contratante} />
            <Field label="Fecha Inicio"     value={result.data?.fecha_inicio} />
            <Field label="Fecha Fin"        value={result.data?.fecha_fin} />
            <Field label="Penalización SLA" value={result.data?.Penalizacion_sla} />
            <Field
              label="Terminación Anticipada"
              value={
                result.data?.TerminacionAnticipada
                  ? <GiCheckMark className="inline-block text-green-500" />
                  : <GiCancel className="inline-block text-red-500" />
              }
            />
          </div>

          {result.data?.SLA && (
            <div className="border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">SLA</p>
              <p className="font-medium text-gray-800">{result.data.SLA.tipo_de_SLA || '—'}</p>
              <p className="text-gray-600 text-sm mt-1">{result.data.SLA.descripcion || '—'}</p>
            </div>
          )}

          {result.data?.notas && (
            <div className="border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notas</p>
              <p className="text-gray-700 text-sm">{result.data.notas}</p>
            </div>
          )}

          {/* Consumo */}
          {result.consumo?.tokens && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-500">
              <p className="font-semibold mb-1">📊 Consumo</p>
              <p>Modelo: {result.consumo.tokens.modelo} ({result.consumo.tokens.modo})</p>
              <p>Tokens: {result.consumo.tokens.total?.toLocaleString()}</p>
              {result.consumo.tokens.costo_usd > 0 && (
                <p>Costo IA: ${result.consumo.tokens.costo_usd} USD</p>
              )}
              {result.consumo.vision && (
                <p>Vision OCR: {result.consumo.vision.paginas} págs. — ${result.consumo.vision.costo_usd} USD</p>
              )}
            </div>
          )}

          <button
            onClick={handleReset}
            className="w-full mt-2 border border-blue-600 text-blue-600 hover:bg-blue-50 font-semibold py-2.5 rounded-lg transition-colors"
          >
            Analizar otro contrato
          </button>
        </div>
      )}
    </main>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-gray-800 mt-0.5">{value || '—'}</p>
    </div>
  )
}