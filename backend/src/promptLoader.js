const fs = require("fs");
const path = require("path");

const PROMPTS_DIR = path.resolve(__dirname, "prompts");

// Cache por archivo
const cache = {};

/**
 * Carga un prompt por nombre de archivo.
 * Si no se pasa nombre, carga el prompt original (contract_prompt.md) para demos/backward compat.
 */
function loadPrompt(promptName) {
  const filename = promptName || "contract_prompt.md";
  const filePath = path.join(PROMPTS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt no encontrado: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (!cache[filename] || cache[filename].mtimeMs !== stat.mtimeMs) {
    cache[filename] = {
      content: fs.readFileSync(filePath, "utf-8"),
      mtimeMs: stat.mtimeMs,
    };
  }

  return cache[filename].content;
}

/**
 * Carga los 3 prompts del análisis SIB.
 */
function loadSIBPrompts() {
  return {
    datosBase: loadPrompt("sib_paso1_datos_base.md"),
    clausulas: loadPrompt("sib_paso2_clausulas.md"),
    riesgo: loadPrompt("sib_paso3_riesgo.md"),
  };
}

/**
 * Lista todos los prompts disponibles.
 */
function listPrompts() {
  return fs
    .readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({
      name: f,
      path: path.join(PROMPTS_DIR, f),
      size: fs.statSync(path.join(PROMPTS_DIR, f)).size,
    }));
}

module.exports = { loadPrompt, loadSIBPrompts, listPrompts };