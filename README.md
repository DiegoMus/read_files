# Contract Reader 📄

Aplicación web fullstack para leer contratos PDF de forma inteligente usando **Gemini 2.5 Flash** y **Google Cloud Vision OCR**.

---

## Arquitectura del flujo

```
PDF entra
   │
   ▼
¿Tiene texto extraíble? (pdf-parse)
   │
   ├── SÍ (PDF digital)
   │   └── Extrae texto gratis → Gemini 2.5 Flash
   │
   └── NO (escaneado/imagen)
       └── ¿Tiene GOOGLE_VISION_API_KEY configurada?
           ├── SÍ → Google Cloud Vision OCR → Gemini 2.5 Flash
           └── NO → Rechazar con mensaje claro al usuario
```

---

## Prerrequisitos

- **Node.js 18+** (recomendado 20+)
- **PostgreSQL** corriendo localmente o accesible via URL
- **Cuenta en Google AI Studio** para obtener el API key de Gemini
- *(Opcional)* **Cuenta en Google Cloud** con Vision API habilitada para OCR de PDFs escaneados

---

## Estructura del proyecto

```
read_files/
├── backend/          ← Node.js + Express
│   ├── server.js
│   ├── package.json
│   └── .env.example
├── frontend/         ← React + Vite + Tailwind CSS
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Upload.jsx
│   │   │   └── Historial.jsx
│   │   ├── components/
│   │   │   └── Navbar.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── .env.example
├── .env.example
└── README.md
```

---

## Instalación y configuración

### 1. Backend

```bash
cd backend
npm install
```

Crea el archivo `.env` basándote en `.env.example`:

```bash
cp .env.example .env
```

Edita el `.env` y configura las variables:

```env
PORT=3001
DATABASE_URL=postgresql://postgres:tu_password@localhost:5432/postgres
GEMINI_API_KEY=tu_api_key_de_gemini
GOOGLE_VISION_API_KEY=tu_api_key_de_google_vision  # opcional
```

Inicia el servidor:

```bash
npm start
# o en modo desarrollo con auto-reload:
npm run dev
```

El backend crea la tabla `registros` automáticamente si no existe.

### 2. Frontend

```bash
cd frontend
npm install
```

Crea el archivo `.env` basándote en `.env.example`:

```bash
cp .env.example .env
```

Edita si tu backend corre en un puerto diferente:

```env
VITE_API_URL=http://localhost:3001
```

Inicia el servidor de desarrollo:

```bash
npm run dev
```

Abre http://localhost:5173 en tu navegador.

---

## Configuración de API Keys

### Gemini API Key (obligatorio)

1. Ve a [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Crea un nuevo API key
3. Cópialo en `backend/.env` como `GEMINI_API_KEY`

### Google Cloud Vision API Key (opcional — para PDFs escaneados)

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea o selecciona un proyecto
3. Habilita la **Cloud Vision API**
4. Ve a "Credenciales" → "Crear credenciales" → "Clave de API"
5. Cópiala en `backend/.env` como `GOOGLE_VISION_API_KEY`

> **Sin esta clave**, los PDFs escaneados (imágenes) serán rechazados con un mensaje claro al usuario.

---

## Cómo funciona la optimización de tokens

El sistema evita enviar el binario del PDF a Gemini (que sería costoso). En su lugar:

| Tipo de PDF | Proceso | Costo tokens |
|-------------|---------|--------------|
| PDF digital | `pdf-parse` extrae texto gratis → solo texto a Gemini | 🟢 Bajo |
| PDF escaneado | Vision OCR → texto → solo texto a Gemini | 🟡 Medio |
| PDF escaneado sin Vision | Rechazado ❌ | — |

---

## Costos estimados por tipo de documento

| Tipo | Tokens aprox. entrada | Costo aprox. (Gemini 2.5 Flash) |
|------|-----------------------|--------------------------------|
| PDF digital (10 páginas) | ~3,000–8,000 tokens | ~$0.001–$0.004 USD |
| PDF escaneado con OCR | ~3,000–8,000 tokens | ~$0.001–$0.004 USD + Vision |
| Vision OCR (por página) | — | ~$0.0015 USD/página |

> Los precios son estimados y pueden variar. Consulta la documentación de Google para tarifas actualizadas.

---

## Endpoints del API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/health` | Estado del servidor, DB y APIs |
| `GET` | `/api/contracts` | Lista todos los contratos |
| `POST` | `/api/contracts/upload` | Sube y analiza un PDF |

---

## Base de datos

La tabla `registros` se crea automáticamente:

```sql
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
);
```
