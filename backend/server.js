require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const rateLimit = require('express-rate-limit');
const vision = require('@google-cloud/vision');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
app.use(cors({
  origin: 'http://localhost:5173',
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB para PDFs grandes
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

// Gemini AI client
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// Google Cloud Storage client
const storage = process.env.GCS_BUCKET_NAME
  ? new Storage()
  : null;

// Google Cloud Vision API pricing constants
const VISION_FREE_TIER_PAGES = 1000;
const VISION_COST_PER_PAGE = 0.0015;

// Gemini 2.5 Flash token pricing constants (USD per token)
const GEMINI_INPUT_TOKEN_COST = 0.0000003;
const GEMINI_OUTPUT_TOKEN_COST = 0.0000025;

// Initialize database table — adds tokens and vision_pages columns if they don't exist
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
        vision_pages           JSONB,
        created_at             TIMESTAMP DEFAULT NOW()
      )
    `);

    // Agregar columnas si la tabla ya existía sin ellas
    await pool.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS tokens JSONB`);
    await pool.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS vision_pages JSONB`);

    console.log('✅ Tabla "registros" lista en PostgreSQL (con campos tokens y vision_pages)');
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

// ─── OCR via Google Cloud Storage (sin límite de páginas) ─────────────────────
async function extractTextWithVisionGCS(buffer, filename) {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) throw new Error('GCS_BUCKET_NAME no está configurado');

  const bucket = storage.bucket(bucketName);
  const uniqueName = `ocr-temp/${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const outputPrefix = `ocr-output/${Date.now()}-output`;

  console.log(`☁️  Subiendo PDF a GCS: gs://${bucketName}/${uniqueName}`);

  // 1. Subir PDF a GCS
  const file = bucket.file(uniqueName);
  await file.save(buffer, { contentType: 'application/pdf' });
  console.log('✅ PDF subido a GCS correctamente');

  // 2. Llamar a Vision API para procesar todas las páginas
  const visionClient = new vision.ImageAnnotatorClient();
  const inputConfig = {
    mimeType: 'application/pdf',
    gcsSource: { uri: `gs://${bucketName}/${uniqueName}` },
  };
  const outputConfig = {
    gcsDestination: { uri: `gs://${bucketName}/${outputPrefix}` },
    batchSize: 10, // páginas por archivo de output
  };

  console.log('🔍 Iniciando OCR asíncrono con Vision API (todas las páginas)...');
  const [operation] = await visionClient.asyncBatchAnnotateFiles({
    requests: [{
      inputConfig,
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      outputConfig,
    }],
  });

  // 3. Esperar a que termine el OCR
  console.log('⏳ Esperando resultado del OCR...');
  const [filesResponse] = await operation.promise();
  console.log('✅ OCR asíncrono completado');

  // 4. Leer los archivos de output de GCS
  const outputUriPrefix = filesResponse.responses[0]?.outputConfig?.gcsDestination?.uri || `gs://${bucketName}/${outputPrefix}`;
  const outputBucketPath = outputUriPrefix.replace(`gs://${bucketName}/`, '');

  const [outputFiles] = await bucket.getFiles({ prefix: outputBucketPath });
  console.log(`📄 Archivos de output encontrados: ${outputFiles.length}`);

  let fullText = '';
  let totalPages = 0;

  for (const outputFile of outputFiles) {
    const [content] = await outputFile.download();
    const json = JSON.parse(content.toString());
    for (const response of json.responses || []) {
      const pageText = response.fullTextAnnotation?.text || '';
      fullText += pageText + '\n';
      totalPages++;
    }
    // Borrar archivo de output
    await outputFile.delete();
    console.log(`🗑️  Output eliminado: ${outputFile.name}`);
  }

  // 5. Borrar el PDF original de GCS
  await file.delete();
  console.log(`🗑️  PDF original eliminado de GCS: ${uniqueName}`);

  console.log(`✅ OCR completado. Páginas procesadas: ${totalPages} | Caracteres: ${fullText.length}`);
  return { text: fullText, pages: totalPages };
}

// ─── OCR inline (fallback, máximo 5 páginas) ──────────────────────────────────
async function extractTextWithVisionInline(buffer) {
  console.log('🔍 Usando Google Cloud Vision (inline, hasta 5 páginas)...');
  console.log(`📦 Credenciales: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);

  const client = new vision.ImageAnnotatorClient();
  const base64 = buffer.toString('base64');
  console.log(`📄 Buffer en base64. Tamaño: ${base64.length} caracteres`);

  let response;
  try {
    [response] = await client.batchAnnotateFiles({
      requests: [{
        inputConfig: {
          mimeType: 'application/pdf',
          content: base64,
        },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        pages: Array.from({ length: 20 }, (_, i) => i + 1),
      }],
    });
  } catch (err) {
    // Si falla con muchas páginas, intenta con 5
    console.warn('⚠️ Fallback a 5 páginas por límite de Vision API inline');
    [response] = await client.batchAnnotateFiles({
      requests: [{
        inputConfig: {
          mimeType: 'application/pdf',
          content: base64,
        },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        pages: [1, 2, 3, 4, 5],
      }],
    });
  }

  console.log('✅ Respuesta recibida de Vision API');

  const text = response.responses
    ?.flatMap(r => r.responses || [])
    ?.map(r => r.fullTextAnnotation?.text || '')
    .join('\n') || '';

  const pages = response.responses?.flatMap(r => r.responses || []).length || 0;

  console.log(`✅ OCR completado. Páginas: ${pages} | Caracteres: ${text.length}`);
  console.log(`📋 Muestra: ${text.slice(0, 300)}`);
  return { text, pages };
}

// ─── Función principal de OCR — elige GCS o inline automáticamente ────────────
async function extractTextWithVision(buffer, filename) {
  if (process.env.GCS_BUCKET_NAME && storage) {
    console.log('☁️  Modo GCS activado — procesará todas las páginas del PDF');
    try {
      return await extractTextWithVisionGCS(buffer, filename);
    } catch (gcsErr) {
      console.error('❌ Error en GCS, intentando modo inline:', gcsErr.message);
      return await extractTextWithVisionInline(buffer);
    }
  } else {
    console.log('📄 Modo inline activado (configura GCS_BUCKET_NAME para procesar todas las páginas)');
    return await extractTextWithVisionInline(buffer);
  }
}

// ─── Analyze text with Ollama (local model — 100% privado) ───────────────────
// ─── Analyze text with llama-server (local model — 100% privado) ──────────────
async function analyzeWithOllama(text) {
  const model = process.env.LOCAL_MODEL || 'contract-reader:v1';
  console.log(`🤖 Enviando texto a llama-server (${model}) — modo local...`);

  const CTX_SIZE = 65536;
  const RESERVED_TOKENS = 2048;
  const MAX_TOKENS = CTX_SIZE - RESERVED_TOKENS;
  const maxChars = MAX_TOKENS * 3;

  const truncated = text.length > maxChars ? text.slice(0, maxChars) : text;
  if (text.length > maxChars) {
    console.log(`⚠️  Texto truncado de ${text.length} a ${truncated.length} caracteres`);
  }
  console.log(`📝 Texto final: ${truncated.length} chars (máx permitido: ${maxChars})`);

  const systemPrompt = `Como un analista tecnológico legal especializado en contratos en español, analiza el texto y extrae la información en formato JSON con exactamente esta estructura:
{
  "fecha_inicio": "YYYY-MM-DD o null",
  "fecha_fin": "YYYY-MM-DD o null",
  "SLA": { "tipo_de_SLA": "string", "descripcion": "string" },
  "TerminacionAnticipada": true/false,
  "Contratante": "string",
  "Proveedor": "string",
  "Penalizacion_sla": "string o null",
  "notas": "string o null"
}
Responde ÚNICAMENTE con el JSON, sin explicaciones adicionales.`;

  const response = await fetch(
    process.env.LLAMA_API_URL || 'http://localhost:8080/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Texto del contrato:\n${truncated}` },
        ],
        temperature: 0.1,
        max_tokens: 2048,
        n_predict: 2048,
        n_ctx: 65536,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`llama-server error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const rawText = (data.choices[0].message.content || '')
    .replace(/<\|im_end\|>/g, '')
    .replace(/<\|im_start\|>/g, '')
    .trim();

  console.log(`✅ Respuesta de llama-server recibida`);
  console.log(`📊 Tokens — Input: ${data.usage?.prompt_tokens} | Output: ${data.usage?.completion_tokens}`);
  console.log(`💰 Costo: $0.00 USD (modelo local)`);
  console.log(`📋 Respuesta raw: ${rawText.slice(0, 300)}`);

  const responseClean = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  console.log(`📋 Respuesta limpia: ${responseClean.slice(0, 300)}`);

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

// ─── Analyze text with Gemini 2.5 Flash ───────────────────────────────────────
async function analyzeWithGemini(text) {
  if (!genAI) throw new Error('GEMINI_API_KEY no está configurada');

  console.log('🤖 Enviando texto a Gemini 2.5 Flash...');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `Como un analista tecnológico legal especializado en contratos en español, analiza el siguiente texto y extrae la información en formato JSON con exactamente esta estructura y si Request for Proposal RFP considera entregables claros y si tiene estructura para clasificarse como CAPEX:
{
  "fecha_inicio": "YYYY-MM-DD o null",
  "fecha_fin": "YYYY-MM-DD o null",
  "SLA": {
    "tipo_de_SLA": "string",
    "descripcion": "string"
  },
  "TerminacionAnticipada": true/false,
  "Contratante": "string",
  "Proveedor": "string",
  "Penalizacion_sla": "string o null",
  "notas": "Si el documento es un RFP, describir los entregables y estructura para determinar si es CAPEX o no. Si no es un RFP, colocar null."
}

INSTRUCCIONES IMPORTANTES:

Para "TerminacionAnticipada" debes buscar si el contrato menciona alguna de estas variantes:
- "terminación del contrato"
- "rescisión del contrato"
- "rescisión anticipada"
- "dar por terminado antes"
- "terminar anticipadamente"
- "derecho a rescindir"
- "cualquiera de las partes podrá dar por terminado"
- "podrá terminar el contrato"
- "finalización anticipada"
Si encuentra CUALQUIERA de estas frases o frases similares que impliquen que el contrato puede terminar antes de su fecha fin → TerminacionAnticipada: true
Si NO encuentra ninguna mención → TerminacionAnticipada: false

Para "fecha_inicio" y "fecha_fin":
- Busca frases como "vigencia", "plazo", "duración", "a partir del", "hasta el"
- Convierte fechas escritas en texto a formato YYYY-MM-DD
- Ejemplo: "primero de enero de dos mil veinticuatro" → "2024-01-01"

Para "Penalizacion_sla":
- Busca montos, porcentajes o descripciones de penalizaciones por incumplimiento
- Ejemplo: "10% del valor mensual del servicio"

Para ="tipo_de_SLA":
- Busca si el contrato menciona algún tipo específico de SLA (ejemplo: "SLA de disponibilidad", "SLA de soporte", "SLA de rendimiento") y extrae esa información como "tipo_de_SLA". Si no se menciona un tipo específico, puedes dejarlo como null o "general".

Responde ÚNICAMENTE con el JSON, sin explicaciones adicionales.

Texto del contrato:
${text}`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // Calcular tokens y costo
  const usage = result.response.usageMetadata;
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;
  const totalTokens = usage?.totalTokenCount || 0;
  const costUSD = ((inputTokens * GEMINI_INPUT_TOKEN_COST) + (outputTokens * GEMINI_OUTPUT_TOKEN_COST)).toFixed(6);

  console.log(`✅ Respuesta de Gemini recibida`);
  console.log(`📊 Tokens — Input: ${inputTokens} | Output: ${outputTokens} | Total: ${totalTokens}`);
  console.log(`💰 Costo estimado Gemini: $${costUSD} USD`);

  return {
    text: responseText,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens,
      costo_usd: parseFloat(costUSD),
      modelo: 'gemini-2.5-flash',
      modo: 'cloud',
    },
  };
}

// ─── Detectar si el documento es un contrato ──────────────────────────────────
async function detectDocumentType(text) {
  if (!genAI) throw new Error('GEMINI_API_KEY no está configurada');

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const sample = text.slice(0, 10000); // Solo primeras 10k chars para detección rápida

  const prompt = `Analiza el siguiente texto y determina si es un CONTRATO LEGAL o no.

Responde ÚNICAMENTE con este JSON:
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

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  const cleaned = responseText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  return JSON.parse(cleaned);
}

// Parse and clean Gemini JSON response
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

  res.json({
    status: 'ok',
    database: dbStatus,
    gemini: process.env.GEMINI_API_KEY ? 'configured' : 'not configured',
    vision: process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'configured' : 'not configured',
    gcs: process.env.GCS_BUCKET_NAME ? `configured (${process.env.GCS_BUCKET_NAME})` : 'not configured (modo inline, máx 5 páginas)',
    ai_mode: process.env.AI_MODE === 'local' ? `local (${process.env.LOCAL_MODEL || 'deepseek-r1:32b'})` : 'cloud (gemini-2.5-flash)',
  });
});

// Get all contracts
app.get('/api/contracts', generalLimiter, async (req, res) => {
  try {
    console.log('📋 Obteniendo historial de contratos...');
    const result = await pool.query('SELECT * FROM registros ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error al obtener contratos:', err.message);
    res.status(500).json({ error: 'Error al obtener los contratos' });
  }
});

// Upload and analyze contract
// Upload and analyze contract
app.post('/api/contracts/upload', uploadLimiter, upload.single('contrato'), async (req, res) => {
  try {
    const { requisicion } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No se recibió ningún archivo PDF' });
    if (!requisicion) return res.status(400).json({ error: 'El número de requisición es requerido' });

    console.log(`\n📄 Procesando contrato: ${file.originalname} | Requisición: ${requisicion}`);

    // ── Step 1: Extraer texto con pdf-parse ──────────────────────────────────
    let extractedText = '';
    let tipoDocumento = 'digital';
    let visionData = null;

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

      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return res.status(422).json({
          error: 'El documento parece ser una imagen escaneada. Configura Google Vision API para habilitar OCR.',
        });
      }

      const ocrResult = await extractTextWithVision(file.buffer, file.originalname);
      extractedText = ocrResult.text;

      const visionPages = ocrResult.pages || 0;
      const visionCostUSD = visionPages <= VISION_FREE_TIER_PAGES
        ? 0
        : (visionPages * VISION_COST_PER_PAGE).toFixed(6);

      visionData = {
        paginas: visionPages,
        costo_usd: parseFloat(visionCostUSD),
        modo: process.env.GCS_BUCKET_NAME ? 'gcs' : 'inline',
      };

      console.log(`📊 Vision — Páginas: ${visionPages} | Costo: $${visionCostUSD} USD | Modo: ${visionData.modo}`);

      if (!extractedText || extractedText.trim().length < 10) {
        return res.status(422).json({
          error: 'No se pudo extraer texto del documento escaneado. Verifica que el PDF contenga texto legible.',
        });
      }
    }

    // ── Step 3: Detectar tipo de documento (siempre con Gemini) ─────────────
    console.log('🔍 Detectando tipo de documento...');
    let docDetection;
    try {
      docDetection = await detectDocumentType(extractedText);
      console.log(`📄 Tipo detectado: ${docDetection.tipo_documento} | Es contrato: ${docDetection.es_contrato}`);
    } catch (detErr) {
      console.warn('⚠️  No se pudo detectar tipo de documento:', detErr.message);
      docDetection = { es_contrato: true, tipo_documento: 'Contrato', descripcion: null, datos_relevantes: null };
    }

    // Si NO es contrato → responder sin guardar en DB
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

    // ── Step 4: Analizar con IA (local u cloud según AI_MODE) ────────────────
    const aiMode = process.env.AI_MODE || 'cloud';
    if (aiMode !== 'local' && aiMode !== 'cloud') {
      return res.status(500).json({ error: `AI_MODE inválido: "${aiMode}". Usa "local" o "cloud".` });
    }
    console.log(`🧠 Modo IA: ${aiMode.toUpperCase()}`);

    let aiResult;
    if (aiMode === 'local') {
      try {
        aiResult = await analyzeWithOllama(extractedText);
        JSON.parse(aiResult.text); // validar que sea JSON
        console.log('✅ Modelo local respondió correctamente');
      } catch (localErr) {
        console.warn(`⚠️  Modelo local falló (${localErr.message}) → usando Gemini como fallback`);
        aiResult = await analyzeWithGemini(extractedText);
        await saveTrainingExample(extractedText, aiResult.text);
      }
    } else {
      aiResult = await analyzeWithGemini(extractedText);
      await saveTrainingExample(extractedText, aiResult.text);
    }

    // ── Step 5: Parsear respuesta de IA ──────────────────────────────────────
    let geminiData;
    try {
      geminiData = parseAIResponse(aiResult.text);
    } catch (parseErr) {
      console.error('❌ Error al parsear respuesta de IA:', aiResult.text);
      return res.status(500).json({ error: 'Error al procesar la respuesta de IA. Intenta de nuevo.' });
    }

    // ── Step 6: Normalizar fechas ─────────────────────────────────────────────
    const fechaInicio = normalizeDate(geminiData.fecha_inicio);
    const fechaFin    = normalizeDate(geminiData.fecha_fin);

    // ── Step 7: Guardar en PostgreSQL ─────────────────────────────────────────
    console.log('💾 Guardando en PostgreSQL...');
    const insertResult = await pool.query(
      `INSERT INTO registros
        (requisicion, proveedor, contratante, inicio, fin, tipo_sla, descripcion_sla,
         penalizacion, terminacion_anticipada, notas, tipo_documento, estado, tokens, vision_pages)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completado',$12,$13)
       RETURNING *`,
      [
        requisicion,
        geminiData.Proveedor              || null,
        geminiData.Contratante            || null,
        fechaInicio,
        fechaFin,
        geminiData.SLA?.tipo_de_SLA       || null,
        geminiData.SLA?.descripcion       || null,
        geminiData.Penalizacion_sla       || null,
        geminiData.TerminacionAnticipada === true,
        geminiData.notas                  || null,
        tipoDocumento,
        JSON.stringify(aiResult.tokens),
        visionData ? JSON.stringify(visionData) : null,
      ]
    );

    const savedRecord = insertResult.rows[0];
    console.log(`✅ Contrato guardado con ID: ${savedRecord.id}`);

    // ── Step 8: Retornar resultado ────────────────────────────────────────────
    res.json({
      success: true,
      es_contrato: true,
      tipo_documento: tipoDocumento,                          // digital / ocr
      tipo_documento_detectado: docDetection.tipo_documento, // ej: "Contrato de Servicios"
      descripcion_documento: docDetection.descripcion,
      datos_relevantes: docDetection.datos_relevantes,
      consumo: {
        tokens: aiResult.tokens,
        vision: visionData,
      },
      data: {
        id: savedRecord.id,
        requisicion: savedRecord.requisicion,
        proveedor: savedRecord.proveedor,
        contratante: savedRecord.contratante,
        fecha_inicio: savedRecord.inicio,
        fecha_fin: savedRecord.fin,
        SLA: {
          tipo_de_SLA: savedRecord.tipo_sla,
          descripcion: savedRecord.descripcion_sla,
        },
        TerminacionAnticipada: savedRecord.terminacion_anticipada,
        Penalizacion_sla: savedRecord.penalizacion,
        notas: savedRecord.notas,
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
// Dashboard stats
app.get('/api/stats', generalLimiter, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int                                                                      AS total_contratos,
        COUNT(*) FILTER (WHERE tipo_documento = 'ocr')::int                               AS total_ocr,
        COUNT(*) FILTER (WHERE tipo_documento = 'digital')::int                           AS total_digital,
        COALESCE(SUM((tokens::jsonb->>'total')::numeric), 0)                              AS total_tokens,
        COALESCE(SUM((tokens::jsonb->>'input')::numeric), 0)                              AS total_tokens_input,
        COALESCE(SUM((tokens::jsonb->>'output')::numeric), 0)                             AS total_tokens_output,
        COALESCE(SUM((tokens::jsonb->>'costo_usd')::numeric), 0)                          AS total_costo_usd,
        COALESCE(SUM((vision_pages::jsonb->>'paginas')::numeric), 0)                      AS total_vision_pages,
        COALESCE(SUM((vision_pages::jsonb->>'costo_usd')::numeric), 0)                    AS total_vision_costo_usd,
        COALESCE(AVG((tokens::jsonb->>'total')::numeric), 0)                              AS avg_tokens_por_contrato,
        COALESCE(AVG((tokens::jsonb->>'costo_usd')::numeric), 0)                          AS avg_costo_por_contrato,
        COALESCE(AVG((vision_pages::jsonb->>'paginas')::numeric), 0)                      AS avg_paginas_por_contrato,
        MIN(created_at)                                                                    AS primer_contrato,
        MAX(created_at)                                                                    AS ultimo_contrato
      FROM registros
      WHERE estado = 'completado'
    `);

    const porDia = await pool.query(`
      SELECT
        TO_CHAR(DATE(created_at), 'YYYY-MM-DD')                                                                    AS dia,
        COUNT(*)::int                                                                      AS contratos,
        COALESCE(SUM((tokens::jsonb->>'total')::numeric), 0)                              AS tokens,
        COALESCE(SUM((tokens::jsonb->>'costo_usd')::numeric), 0)                          AS costo_usd,
        COALESCE(SUM((vision_pages::jsonb->>'costo_usd')::numeric), 0)                    AS vision_costo_usd
      FROM registros
      WHERE estado = 'completado'
      GROUP BY DATE(created_at)
      ORDER BY dia DESC
      LIMIT 30
    `);

    const porModelo = await pool.query(`
      SELECT
        tokens::jsonb->>'modelo'                                                           AS modelo,
        tokens::jsonb->>'modo'                                                             AS modo,
        COUNT(*)::int                                                                      AS contratos,
        COALESCE(SUM((tokens::jsonb->>'total')::numeric), 0)                              AS tokens_total,
        COALESCE(SUM((tokens::jsonb->>'costo_usd')::numeric), 0)                          AS costo_usd
      FROM registros
      WHERE estado = 'completado' AND tokens IS NOT NULL
      GROUP BY tokens::jsonb->>'modelo', tokens::jsonb->>'modo'
    `);

    const stats = result.rows[0];
    const diasActivo = porDia.rows.length || 1;
    const promedioContratosPerDia = parseFloat((stats.total_contratos / diasActivo).toFixed(2));
    const avgPaginasPorContrato   = parseFloat(stats.avg_paginas_por_contrato) || 0;

    // Proyección de páginas OCR en 30 días
    const proyMensualContratos  = Math.round(promedioContratosPerDia * 30);
    const proyMensualTokens     = Math.round(parseFloat(stats.avg_tokens_por_contrato) * promedioContratosPerDia * 30);
    const proyMensualPaginas    = Math.round(avgPaginasPorContrato * proyMensualContratos);

    // Costo IA proyectado
    const proyMensualCostoIA    = parseFloat((parseFloat(stats.avg_costo_por_contrato) * proyMensualContratos).toFixed(4));

    // Costo Vision con tier gratuito (1000 páginas/mes gratis)
    const VISION_FREE           = 1000;
    const VISION_PRICE          = 0.0015; // USD por página
    const paginasPagas          = Math.max(0, proyMensualPaginas - VISION_FREE);
    const proyMensualCostoVision = parseFloat((paginasPagas * VISION_PRICE).toFixed(4));

    // Costo total proyectado
    const proyMensualCostoTotal  = parseFloat((proyMensualCostoIA + proyMensualCostoVision).toFixed(4));

    // Cuántos contratos agotan el free tier
    const contratosHastaFreeTier = avgPaginasPorContrato > 0
      ? Math.floor(VISION_FREE / avgPaginasPorContrato)
      : null;


    res.json({
      resumen: {
        total_contratos: stats.total_contratos,
        total_ocr: stats.total_ocr,
        total_digital: stats.total_digital,
        total_tokens: parseFloat(stats.total_tokens),
        total_tokens_input: parseFloat(stats.total_tokens_input),
        total_tokens_output: parseFloat(stats.total_tokens_output),
        total_costo_usd: parseFloat(stats.total_costo_usd).toFixed(6),
        total_vision_pages: parseFloat(stats.total_vision_pages),
        total_vision_costo_usd: parseFloat(stats.total_vision_costo_usd).toFixed(6),
        avg_tokens_por_contrato: Math.round(stats.avg_tokens_por_contrato),
        avg_costo_por_contrato: parseFloat(stats.avg_costo_por_contrato).toFixed(6),
        avg_paginas_por_contrato: Math.round(stats.avg_paginas_por_contrato),
        primer_contrato: stats.primer_contrato,
        ultimo_contrato: stats.ultimo_contrato,
      },
      proyeccion: {
        promedio_contratos_dia:          promedioContratosPerDia,
        proyeccion_mensual_contratos:    proyMensualContratos,
        proyeccion_mensual_tokens:       proyMensualTokens,
        proyeccion_mensual_paginas_ocr:  proyMensualPaginas,
        proyeccion_mensual_costo_ia:     proyMensualCostoIA.toFixed(4),
        proyeccion_mensual_costo_vision: proyMensualCostoVision.toFixed(4),
        proyeccion_mensual_costo_total:  proyMensualCostoTotal.toFixed(4),
        vision_free_tier_paginas:        VISION_FREE,
        vision_paginas_pagas:            paginasPagas,
        contratos_hasta_free_tier:       contratosHastaFreeTier,
        supera_free_tier:                proyMensualPaginas > VISION_FREE,
      },
      por_dia: porDia.rows,
      por_modelo: porModelo.rows,
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
    console.log(`\n🚀 Backend corriendo en http://localhost:${PORT}`);
    console.log(`📊 Gemini:  ${process.env.GEMINI_API_KEY ? '✅ configurado' : '❌ no configurado'}`);
    console.log(`👁️  Vision:  ${process.env.GOOGLE_APPLICATION_CREDENTIALS ? '✅ configurado' : '❌ no configurado'}`);
    console.log(`☁️  GCS:     ${process.env.GCS_BUCKET_NAME ? `✅ bucket: ${process.env.GCS_BUCKET_NAME}` : '⚠️  no configurado (modo inline, máx 5 páginas)'}`);
    console.log(`🧠 Modo IA: ${process.env.AI_MODE === 'local' ? '✅ LOCAL (Ollama)' : '☁️  CLOUD (Gemini)'}`);
    console.log(`🤖 Modelo:  ${process.env.AI_MODE === 'local' ? (process.env.LOCAL_MODEL || 'deepseek-r1:32b') : 'gemini-2.5-flash'}`);
  });
}

start();

