require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const rateLimit = require('express-rate-limit');

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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en 15 minutos.' },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de análisis. Intenta de nuevo en 15 minutos.' },
});

app.use('/api/contracts', generalLimiter);

// Multer memory storage (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postres@localhost:5432/postgres',
});

// Gemini AI client
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// Initialize database table
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
        created_at             TIMESTAMP DEFAULT NOW()
      )
    `);
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

// Extract text via Google Cloud Vision OCR (REST API using API key)
async function extractTextWithVision(buffer) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_VISION_API_KEY not configured');

  console.log('🔍 Usando Google Cloud Vision para OCR...');
  const base64 = buffer.toString('base64');

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        }],
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vision API error: ${err}`);
  }

  const data = await response.json();
  const text = data.responses?.[0]?.fullTextAnnotation?.text || '';
  console.log(`✅ OCR completado. Caracteres extraídos: ${text.length}`);
  return text;
}

// Analyze text with Gemini 2.5 Flash
async function analyzeWithGemini(text) {
  if (!genAI) throw new Error('GEMINI_API_KEY no está configurada');

  console.log('🤖 Enviando texto a Gemini 2.5 Flash...');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `Como un analista tecnológico legal, analiza el siguiente texto de un contrato y extrae la información en formato JSON con exactamente esta estructura:
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
  "notas": "string con observaciones adicionales relevantes o null"
}
Responde ÚNICAMENTE con el JSON, sin explicaciones adicionales.

Texto del contrato:
${text}`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  console.log('✅ Respuesta de Gemini recibida');
  return responseText;
}

// Parse and clean Gemini JSON response
function parseGeminiResponse(responseText) {
  // Remove markdown code blocks if present
  let cleaned = responseText
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
    vision: process.env.GOOGLE_VISION_API_KEY ? 'configured' : 'not configured',
  });
});

// Get all contracts
app.get('/api/contracts', generalLimiter, async (req, res) => {
  try {
    console.log('📋 Obteniendo historial de contratos...');
    const result = await pool.query(
      'SELECT * FROM registros ORDER BY id DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error al obtener contratos:', err.message);
    res.status(500).json({ error: 'Error al obtener los contratos' });
  }
});

// Upload and analyze contract
app.post('/api/contracts/upload', uploadLimiter, upload.single('contrato'), async (req, res) => {
  try {
    const { requisicion } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo PDF' });
    }
    if (!requisicion) {
      return res.status(400).json({ error: 'El número de requisición es requerido' });
    }

    console.log(`\n📄 Procesando contrato: ${file.originalname} | Requisición: ${requisicion}`);

    // Step 1: Try to extract text from PDF
    let extractedText = '';
    let tipoDocumento = 'digital';

    console.log('🔎 Extrayendo texto del PDF con pdf-parse...');
    try {
      const parsed = await pdfParse(file.buffer);
      extractedText = parsed.text || '';
      console.log(`📝 Texto extraído por pdf-parse: ${extractedText.length} caracteres`);
    } catch (parseErr) {
      console.warn('⚠️ pdf-parse falló:', parseErr.message);
      extractedText = '';
    }

    // Step 2: Determine document type and extract text accordingly
    if (extractedText.trim().length > 50) {
      console.log('✅ PDF digital detectado — usando texto extraído directamente');
      tipoDocumento = 'digital';
    } else {
      console.log('🖼️ PDF escaneado detectado — se requiere OCR');
      tipoDocumento = 'ocr';

      if (!process.env.GOOGLE_VISION_API_KEY) {
        return res.status(422).json({
          error: 'El documento parece ser una imagen escaneada. Por favor sube una versión digital del contrato, o configura Google Vision API para habilitar OCR.',
        });
      }

      extractedText = await extractTextWithVision(file.buffer);

      if (!extractedText || extractedText.trim().length < 10) {
        return res.status(422).json({
          error: 'No se pudo extraer texto del documento escaneado. Por favor verifica que el PDF contenga texto legible.',
        });
      }
    }

    // Step 3: Analyze with Gemini
    const geminiRaw = await analyzeWithGemini(extractedText);

    // Step 4: Parse Gemini response
    let geminiData;
    try {
      geminiData = parseGeminiResponse(geminiRaw);
    } catch (parseErr) {
      console.error('❌ Error al parsear respuesta de Gemini:', geminiRaw);
      return res.status(500).json({ error: 'Error al procesar la respuesta de Gemini. Intenta de nuevo.' });
    }

    // Step 5: Normalize dates
    const fechaInicio = normalizeDate(geminiData.fecha_inicio);
    const fechaFin = normalizeDate(geminiData.fecha_fin);

    // Step 6: Save to PostgreSQL
    console.log('💾 Guardando en PostgreSQL...');
    const insertResult = await pool.query(
      `INSERT INTO registros
        (requisicion, proveedor, contratante, inicio, fin, tipo_sla, descripcion_sla, penalizacion, terminacion_anticipada, notas, tipo_documento, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'completado')
       RETURNING *`,
      [
        requisicion,
        geminiData.Proveedor || null,
        geminiData.Contratante || null,
        fechaInicio,
        fechaFin,
        geminiData.SLA?.tipo_de_SLA || null,
        geminiData.SLA?.descripcion || null,
        geminiData.Penalizacion_sla || null,
        geminiData.TerminacionAnticipada === true,
        geminiData.notas || null,
        tipoDocumento,
      ]
    );

    const savedRecord = insertResult.rows[0];
    console.log(`✅ Contrato guardado con ID: ${savedRecord.id}`);

    // Step 7: Return result
    res.json({
      success: true,
      tipo_documento: tipoDocumento,
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
      return res.status(400).json({ error: 'El archivo excede el tamaño máximo de 10MB' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// Start server
async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`\n🚀 Backend corriendo en http://localhost:${PORT}`);
    console.log(`📊 Gemini: ${process.env.GEMINI_API_KEY ? '✅ configurado' : '❌ no configurado'}`);
    console.log(`👁️  Vision: ${process.env.GOOGLE_VISION_API_KEY ? '✅ configurado' : '❌ no configurado'}`);
  });
}

start();
