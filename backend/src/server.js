require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { loadPrompt } = require('./promptLoader');
const { analyzeSIB } = require('./sibAnalyzer');

// Azure Document Intelligence SDK (REST client)
const DocumentIntelligence = require('@azure-rest/ai-document-intelligence').default;
const { getLongRunningPoller, isUnexpected } = require('@azure-rest/ai-document-intelligence');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en 15 minutos.' },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de análisis. Intenta de nuevo en 15 minutos.' },
});

app.use('/api/contracts', generalLimiter);

// Multer memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos PDF'));
    }
  },
});

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postres@localhost:5432/datos',
});

// Azure Document Intelligence client
const azureDIClient = (process.env.AZURE_DI_ENDPOINT && process.env.AZURE_DI_KEY)
  ? DocumentIntelligence(process.env.AZURE_DI_ENDPOINT, {
      key: process.env.AZURE_DI_KEY,
    })
  : null;

// Azure Document Intelligence pricing
const AZURE_DI_FREE_TIER_PAGES = 500;
const AZURE_DI_COST_PER_PAGE = 0.001;

// ─── Initialize database table ───────────────────────────────────────────────
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS registros (
        id                     SERIAL PRIMARY KEY,
        requisicion            TEXT,
        proveedor              TEXT,
        contratante            TEXT,
        inicio                 DATE,
        fin                    DATE,
        tipo_sla               TEXT,
        descripcion_sla        TEXT,
        penalizacion           TEXT,
        terminacion_anticipada BOOLEAN,
        notas                  TEXT,
        tipo_documento         TEXT,
        estado                 TEXT DEFAULT 'pendiente',
        tokens                 JSONB,
        ocr_data               JSONB,
        monto                  TEXT,
        moneda                 TEXT,
        texto_extraido         TEXT,
        sib_data               JSONB,
        created_at             TIMESTAMP DEFAULT NOW()
      )
    `);

    // Agregar columnas si la tabla ya existía sin ellas
    await pool.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS tokens JSONB`);
    await pool.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS ocr_data JSONB`);
    await pool.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS monto TEXT`);
    await pool.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS moneda TEXT`);
    await pool.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS texto_extraido TEXT`);
    await pool.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS sib_data JSONB`);

    console.log('✅ Tabla "registros" lista en PostgreSQL');
  } catch (err) {
    console.error('❌ Error al inicializar la base de datos:', err.message);
  }
}

// Normalize a date value to YYYY-MM-DD or null
function normalizeDate(value) {
  if (!value || value === 'null') return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

// ─── OCR con Azure Document Intelligence ─────────────────────────────────────
async function extractTextWithAzureDI(buffer, filename) {
  if (!azureDIClient) {
    throw new Error('Azure Document Intelligence no está configurado (AZURE_DI_ENDPOINT / AZURE_DI_KEY)');
  }

  console.log(`🔍 Iniciando OCR con Azure Document Intelligence: ${filename}`);

  const base64Source = buffer.toString('base64');

  const initialResponse = await azureDIClient
    .path('/documentModels/{modelId}:analyze', 'prebuilt-read')
    .post({
      contentType: 'application/json',
      body: { base64Source },
    });

  if (isUnexpected(initialResponse)) {
    throw new Error(`Azure DI error: ${JSON.stringify(initialResponse.body.error)}`);
  }

  console.log('⏳ Esperando resultado del OCR...');
  const poller = getLongRunningPoller(azureDIClient, initialResponse);
  const result = await poller.pollUntilDone();

  if (isUnexpected(result)) {
    throw new Error(`Azure DI polling error: ${JSON.stringify(result.body.error)}`);
  }

  console.log('✅ OCR completado');

  const analyzeResult = result.body.analyzeResult;
  const fullText = (analyzeResult?.content || '').trim();
  const totalPages = analyzeResult?.pages?.length || 0;

  console.log(`✅ Páginas procesadas: ${totalPages} | Caracteres: ${fullText.length}`);
  return { text: fullText, pages: totalPages };
}

// ─── Análisis LEGACY con modelo local (para demos con contract_prompt.md) ────
async function analyzeWithLocalModel(text) {
  const model = process.env.LOCAL_MODEL || './contratos_qwen7b';
  const apiUrl = process.env.LLAMA_API_URL || 'http://localhost:8080/v1/chat/completions';
  const apiKey = process.env.MODEL_API_KEY || '';

  console.log(`🤖 Enviando texto a modelo local (${model}) — modo legacy...`);

  const maxChars = 15000 * 3; // ~15K tokens
  const truncated = text.length > maxChars ? text.slice(0, maxChars) : text;
  if (text.length > maxChars) {
    console.log(`⚠️  Texto truncado de ${text.length} a ${truncated.length} caracteres`);
  }
  console.log(`📝 Texto final: ${truncated.length} chars (máx permitido: ${maxChars})`);

  const systemPrompt = loadPrompt(); // carga contract_prompt.md (v1 demo)

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Texto del contrato:\n${truncated}` },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`llama-server error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const rawText = (data.choices[0].message.content || '')
    .replace(/<\|im_end\|>/g, '')
    .replace(/<\|im_start\|>/g, '')
    .trim();

  console.log(`✅ Respuesta de modelo local recibida`);
  console.log(`📊 Tokens — Input: ${data.usage?.prompt_tokens} | Output: ${data.usage?.completion_tokens}`);

  const responseClean = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  return {
    text: responseClean,
    tokens: {
      input: data.usage?.prompt_tokens || 0,
      output: data.usage?.completion_tokens || 0,
      total: data.usage?.total_tokens || 0,
      costo_usd: 0,
      modelo: model,
      modo: 'local',
    },
  };
}

// ─── Detectar tipo de documento (con modelo local) ────────────────────────────
async function detectDocumentType(text) {
  const apiUrl = process.env.LLAMA_API_URL || 'http://localhost:8080/v1/chat/completions';
  const apiKey = process.env.MODEL_API_KEY || '';
  const model = process.env.LOCAL_MODEL || './contratos_qwen7b';
  const sample = text.slice(0, 10000);

  const prompt = `Analiza el siguiente texto y determina si es un CONTRATO LEGAL o no.

Responde ÚNICAMENTE con este JSON (sin texto adicional, sin markdown):
{
  "es_contrato": true/false,
  "tipo_documento": "string (ej: Factura, Carta, Propuesta, Manual, Reporte, etc.)",
  "descripcion": "string con descripción breve de qué es el documento",
  "datos_relevantes": {
    "titulo": "string o null",
    "fecha": "string o null",
    "partes_involucradas": ["array de nombres si los hay"],
    "monto": "string o null",
    "proposito": "string breve del propósito del documento"
  }
}

Texto:
${sample}`;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Eres un clasificador de documentos. Responde SOLO con JSON válido, sin markdown ni texto adicional.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    throw new Error(`llama-server error (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const rawText = (data.choices[0].message.content || '')
    .replace(/<\|im_end\|>/g, '')
    .replace(/<\|im_start\|>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  return JSON.parse(rawText);
}

// Parse and clean AI JSON response (para modo legacy)
function parseAIResponse(responseText) {
  let cleaned = responseText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();
  return JSON.parse(cleaned);
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', generalLimiter, async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  let modelStatus = 'disconnected';
  try {
    const apiUrl = process.env.LLAMA_API_URL || 'http://localhost:8080/v1/chat/completions';
    const healthUrl = apiUrl.replace('/v1/chat/completions', '/v1/models');
    const modelCheck = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
    modelStatus = modelCheck.ok ? 'connected' : 'error';
  } catch {
    modelStatus = 'disconnected';
  }

  res.json({
    status: 'ok',
    database: dbStatus,
    ocr: azureDIClient ? 'configured (Azure Document Intelligence)' : 'not configured',
    modelo_local: modelStatus,
    modelo_nombre: process.env.LOCAL_MODEL || './contratos_qwen7b',
    llama_api_url: process.env.LLAMA_API_URL || 'http://localhost:8080/v1/chat/completions',
    modo_analisis: process.env.ANALYSIS_MODE || 'sib',
  });
});

// Get all contracts
app.get('/api/contracts', generalLimiter, async (req, res) => {
  try {
    console.log('📋 Obteniendo historial de contratos...');
    const result = await pool.query('SELECT * FROM registros ORDER BY id DESC');

    // Parsear JSONB fields
    const rows = result.rows.map((row) => {
      if (typeof row.tokens === 'string') row.tokens = JSON.parse(row.tokens);
      if (typeof row.ocr_data === 'string') row.ocr_data = JSON.parse(row.ocr_data);
      if (typeof row.sib_data === 'string') row.sib_data = JSON.parse(row.sib_data);
      return row;
    });

    res.json(rows);
  } catch (err) {
    console.error('❌ Error al obtener contratos:', err.message);
    res.status(500).json({ error: 'Error al obtener los contratos' });
  }
});

// Get single contract by ID
app.get('/api/contracts/:id', generalLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM registros WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contrato no encontrado' });
    }

    const row = result.rows[0];
    if (typeof row.sib_data === 'string') row.sib_data = JSON.parse(row.sib_data);
    if (typeof row.tokens === 'string') row.tokens = JSON.parse(row.tokens);
    if (typeof row.ocr_data === 'string') row.ocr_data = JSON.parse(row.ocr_data);

    res.json(row);
  } catch (err) {
    console.error('❌ Error al obtener contrato:', err.message);
    res.status(500).json({ error: 'Error al obtener el contrato' });
  }
});

// Upload and analyze contract
app.post('/api/contracts/upload', uploadLimiter, upload.single('contrato'), async (req, res) => {
  try {
    const { requisicion } = req.body;
    const file = req.file;
    const analysisMode = process.env.ANALYSIS_MODE || 'sib'; // 'sib' o 'legacy'

    if (!file) return res.status(400).json({ error: 'No se recibió ningún archivo PDF' });
    if (!requisicion) return res.status(400).json({ error: 'El número de requisición es requerido' });

    console.log(`\n📄 Procesando contrato: ${file.originalname} | Requisición: ${requisicion} | Modo: ${analysisMode}`);

    // ── Step 1: Extraer texto con pdf-parse ──────────────────────────────────
    let extractedText = '';
    let tipoDocumento = 'digital';
    let ocrData = null;

    console.log('🔎 Extrayendo texto del PDF con pdf-parse...');
    try {
      const parsed = await pdfParse(file.buffer);
      extractedText = parsed.text || '';
      console.log(`📝 Texto extraído por pdf-parse: ${extractedText.length} caracteres`);
    } catch (parseErr) {
      console.warn('⚠️ pdf-parse falló:', parseErr.message);
      extractedText = '';
    }

    // ── Step 2: Digital o escaneado ──────────────────────────────────────────
    if (extractedText.trim().length > 50) {
      console.log('✅ PDF digital detectado — usando texto extraído directamente');
      tipoDocumento = 'digital';
    } else {
      console.log('🖼️ PDF escaneado detectado — se requiere OCR');
      tipoDocumento = 'ocr';

      if (!azureDIClient) {
        return res.status(422).json({
          error: 'El documento parece ser una imagen escaneada. Configura Azure Document Intelligence para habilitar OCR.',
        });
      }

      const ocrResult = await extractTextWithAzureDI(file.buffer, file.originalname);
      extractedText = ocrResult.text;

      const ocrPages = ocrResult.pages || 0;
      const ocrCostUSD = ocrPages <= AZURE_DI_FREE_TIER_PAGES
        ? 0
        : ((ocrPages - AZURE_DI_FREE_TIER_PAGES) * AZURE_DI_COST_PER_PAGE);

      ocrData = {
        paginas: ocrPages,
        costo_usd: parseFloat(ocrCostUSD.toFixed(6)),
        servicio: 'azure-document-intelligence',
      };

      console.log(`📊 OCR — Páginas: ${ocrPages} | Costo: $${ocrCostUSD.toFixed(6)} USD`);

      if (!extractedText || extractedText.trim().length < 10) {
        return res.status(422).json({
          error: 'No se pudo extraer texto del documento escaneado.',
        });
      }
    }

    // ── Step 3: Detectar tipo de documento ───────────────────────────────────
    console.log('🔍 Detectando tipo de documento...');
    let docDetection;
    try {
      docDetection = await detectDocumentType(extractedText);
      console.log(`📄 Tipo detectado: ${docDetection.tipo_documento} | Es contrato: ${docDetection.es_contrato}`);
    } catch (detErr) {
      console.warn('⚠️  No se pudo detectar tipo de documento:', detErr.message);
      docDetection = { es_contrato: true, tipo_documento: 'Contrato', descripcion: null, datos_relevantes: null };
    }

    if (!docDetection.es_contrato) {
      console.log(`⚠️  Documento no es un contrato: ${docDetection.tipo_documento}`);
      return res.status(200).json({
        success: false,
        es_contrato: false,
        tipo_documento: docDetection.tipo_documento,
        descripcion: docDetection.descripcion,
        datos_relevantes: docDetection.datos_relevantes,
        mensaje: `El documento no parece ser un contrato. Se identificó como: ${docDetection.tipo_documento}.`,
      });
    }

    // ── Step 4: Analizar contrato ────────────────────────────────────────────
    let geminiData, aiTokens, sibDataJson;

    if (analysisMode === 'sib') {
      // ═══ MODO SIB: 3 pasadas, 28 campos ═══
      console.log('🏛️ Analizando contrato con formato SIB (3 pasadas)...');
      let sibResult;
      try {
        sibResult = await analyzeSIB(extractedText);
        console.log('✅ Análisis SIB completado');
      } catch (err) {
        console.error('❌ Análisis SIB falló:', err.message);
        return res.status(500).json({
          error: 'El modelo local no pudo analizar el contrato. Verifica que mlx_lm.server esté corriendo.',
        });
      }

      geminiData = sibResult.data;
      aiTokens = sibResult.tokens;
      sibDataJson = JSON.stringify(geminiData);

    } else {
      // ═══ MODO LEGACY: 1 pasada, prompt original (contract_prompt.md) ═══
      console.log('🤖 Analizando contrato en modo legacy...');
      let aiResult;
      try {
        aiResult = await analyzeWithLocalModel(extractedText);
        JSON.parse(aiResult.text);
        console.log('✅ Modelo local respondió correctamente (legacy)');
      } catch (err) {
        console.error('❌ Modelo local falló:', err.message);
        return res.status(500).json({
          error: 'El modelo local no pudo analizar el contrato.',
        });
      }

      geminiData = parseAIResponse(aiResult.text);
      aiTokens = aiResult.tokens;
      sibDataJson = null;
    }

    // ── Step 5: Normalizar fechas ─────────────────────────────────────────────
    const fechaInicio = normalizeDate(
      geminiData.fecha_suscripcion || geminiData.fecha_inicio
    );
    const fechaFin = normalizeDate(
      geminiData.fecha_vencimiento || geminiData.fecha_fin
    );

    // ── Step 6: Guardar en PostgreSQL ─────────────────────────────────────────
    console.log('💾 Guardando en PostgreSQL...');
    const insertResult = await pool.query(
      `INSERT INTO registros
        (requisicion, proveedor, contratante, inicio, fin, tipo_sla, descripcion_sla,
         penalizacion, terminacion_anticipada, notas, tipo_documento, estado,
         tokens, ocr_data, monto, moneda, texto_extraido, sib_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        requisicion,
        geminiData.Proveedor || null,
        geminiData.Contratante || null,
        fechaInicio,
        fechaFin,
        geminiData.sla_servicio_formal === 'SI'
          ? (geminiData.sla_servicio_descripcion || 'SLA Formal')
          : (geminiData.SLA?.tipo_de_SLA || null),
        geminiData.sla_servicio_descripcion || geminiData.SLA?.descripcion || null,
        geminiData.penalizaciones_detalle || geminiData.Penalizacion_sla || null,
        geminiData.terminacion_anticipada === 'SI' || geminiData.TerminacionAnticipada === true,
        geminiData.descripcion_servicio || geminiData.notas || null,
        tipoDocumento,
        'completado',
        JSON.stringify(aiTokens),
        ocrData ? JSON.stringify(ocrData) : null,
        geminiData.Monto ? String(geminiData.Monto) : null,
        geminiData.Moneda || null,
        extractedText || null,
        sibDataJson,
      ]
    );

    const savedRecord = insertResult.rows[0];
    console.log(`✅ Contrato guardado con ID: ${savedRecord.id}`);

    // ── Step 7: Retornar resultado ────────────────────────────────────────────
    res.json({
      success: true,
      es_contrato: true,
      tipo_documento: tipoDocumento,
      tipo_documento_detectado: docDetection.tipo_documento,
      descripcion_documento: docDetection.descripcion,
      datos_relevantes: docDetection.datos_relevantes,
      consumo: {
        tokens: aiTokens,
        ocr: ocrData,
      },
      data: {
        id: savedRecord.id,
        requisicion: savedRecord.requisicion,
        proveedor: geminiData.Proveedor || null,
        contratante: geminiData.Contratante || null,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        SLA: {
          tipo_de_SLA: geminiData.sla_servicio_formal || geminiData.SLA?.tipo_de_SLA || null,
          descripcion: geminiData.sla_servicio_descripcion || geminiData.SLA?.descripcion || null,
        },
        TerminacionAnticipada: geminiData.terminacion_anticipada === 'SI' || geminiData.TerminacionAnticipada === true,
        Penalizacion_sla: geminiData.penalizaciones_detalle || geminiData.Penalizacion_sla || null,
        notas: geminiData.descripcion_servicio || geminiData.notas || null,
        monto: geminiData.Monto || null,
        moneda: geminiData.Moneda || null,
        // Campos SIB adicionales (solo si modo sib)
        ...(analysisMode === 'sib' ? { sib_data: geminiData } : {}),
      },
    });

  } catch (err) {
    console.error('❌ Error general en upload:', err.message);
    res.status(500).json({ error: err.message || 'Error interno del servidor' });
  }
});

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'El archivo excede el tamaño máximo de 50MB' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// Dashboard stats
app.get('/api/stats', generalLimiter, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int                                                         AS total_contratos,
        COUNT(*) FILTER (WHERE tipo_documento = 'ocr')::int                  AS total_ocr,
        COUNT(*) FILTER (WHERE tipo_documento = 'digital')::int              AS total_digital,
        COALESCE(SUM((tokens::jsonb->>'total')::numeric), 0)                 AS total_tokens,
        COALESCE(SUM((tokens::jsonb->>'input')::numeric), 0)                 AS total_tokens_input,
        COALESCE(SUM((tokens::jsonb->>'output')::numeric), 0)                AS total_tokens_output,
        COALESCE(SUM((ocr_data::jsonb->>'paginas')::numeric), 0)             AS total_ocr_pages,
        COALESCE(SUM((ocr_data::jsonb->>'costo_usd')::numeric), 0)          AS total_ocr_costo_usd,
        COALESCE(AVG((tokens::jsonb->>'total')::numeric), 0)                 AS avg_tokens_por_contrato,
        COALESCE(AVG((ocr_data::jsonb->>'paginas')::numeric), 0)             AS avg_paginas_por_contrato,
        MIN(created_at)                                                       AS primer_contrato,
        MAX(created_at)                                                       AS ultimo_contrato
      FROM registros
      WHERE estado = 'completado'
    `);

    const porDia = await pool.query(`
      SELECT
        TO_CHAR(DATE(created_at), 'YYYY-MM-DD')                              AS dia,
        COUNT(*)::int                                                         AS contratos,
        COALESCE(SUM((tokens::jsonb->>'total')::numeric), 0)                 AS tokens,
        COALESCE(SUM((ocr_data::jsonb->>'costo_usd')::numeric), 0)          AS ocr_costo_usd
      FROM registros
      WHERE estado = 'completado'
      GROUP BY DATE(created_at)
      ORDER BY dia DESC
      LIMIT 30
    `);

    const stats = result.rows[0];
    const diasActivo = porDia.rows.length || 1;
    const promedioContratosPerDia = parseFloat((stats.total_contratos / diasActivo).toFixed(2));
    const avgPaginasPorContrato = parseFloat(stats.avg_paginas_por_contrato) || 0;

    const proyMensualContratos = Math.round(promedioContratosPerDia * 30);
    const proyMensualTokens = Math.round(parseFloat(stats.avg_tokens_por_contrato) * promedioContratosPerDia * 30);
    const proyMensualPaginas = Math.round(avgPaginasPorContrato * proyMensualContratos);

    const paginasPagas = Math.max(0, proyMensualPaginas - AZURE_DI_FREE_TIER_PAGES);
    const proyMensualCostoOCR = parseFloat((paginasPagas * AZURE_DI_COST_PER_PAGE).toFixed(4));
    const proyMensualCostoTotal = proyMensualCostoOCR;

    const contratosHastaFreeTier = avgPaginasPorContrato > 0
      ? Math.floor(AZURE_DI_FREE_TIER_PAGES / avgPaginasPorContrato)
      : null;

    res.json({
      resumen: {
        total_contratos: stats.total_contratos,
        total_ocr: stats.total_ocr,
        total_digital: stats.total_digital,
        total_tokens: parseFloat(stats.total_tokens),
        total_tokens_input: parseFloat(stats.total_tokens_input),
        total_tokens_output: parseFloat(stats.total_tokens_output),
        total_ocr_pages: parseFloat(stats.total_ocr_pages),
        total_ocr_costo_usd: parseFloat(stats.total_ocr_costo_usd).toFixed(6),
        avg_tokens_por_contrato: Math.round(stats.avg_tokens_por_contrato),
        avg_paginas_por_contrato: Math.round(stats.avg_paginas_por_contrato),
        costo_ia_usd: 0,
        primer_contrato: stats.primer_contrato,
        ultimo_contrato: stats.ultimo_contrato,
      },
      proyeccion: {
        promedio_contratos_dia: promedioContratosPerDia,
        proyeccion_mensual_contratos: proyMensualContratos,
        proyeccion_mensual_tokens: proyMensualTokens,
        proyeccion_mensual_paginas_ocr: proyMensualPaginas,
        proyeccion_mensual_costo_ia: '0.0000',
        proyeccion_mensual_costo_ocr: proyMensualCostoOCR.toFixed(4),
        proyeccion_mensual_costo_total: proyMensualCostoTotal.toFixed(4),
        ocr_free_tier_paginas: AZURE_DI_FREE_TIER_PAGES,
        ocr_paginas_pagas: paginasPagas,
        contratos_hasta_free_tier: contratosHastaFreeTier,
        supera_free_tier: proyMensualPaginas > AZURE_DI_FREE_TIER_PAGES,
      },
      por_dia: porDia.rows,
    });
  } catch (err) {
    console.error('❌ Error al obtener stats:', err.message);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// Start server
async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    const mode = process.env.ANALYSIS_MODE || 'sib';
    console.log(`\n🚀 Backend corriendo en http://localhost:${PORT}`);
    console.log(`🔍 OCR:     ${azureDIClient ? '✅ Azure Document Intelligence' : '❌ no configurado'}`);
    console.log(`🤖 Modelo:  ${process.env.LOCAL_MODEL || './contratos_qwen7b'}`);
    console.log(`🔗 MLX:     ${process.env.LLAMA_API_URL || 'http://localhost:8080/v1/chat/completions'}`);
    console.log(`🏛️  Modo:    ${mode === 'sib' ? 'SIB (3 pasadas, 28 campos)' : 'Legacy (1 pasada)'}`);
  });
}

start();