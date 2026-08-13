const { loadSIBPrompts } = require("./promptLoader");

/**
 * Ejecuta una pasada contra el modelo local MLX.
 */
async function runPass(systemPrompt, contractText, passName) {
  const apiUrl =
    process.env.LLAMA_API_URL || "http://localhost:8080/v1/chat/completions";
  const apiKey = process.env.MODEL_API_KEY || "";
  const model = process.env.LOCAL_MODEL || "./contratos_qwen7b";

  console.log(`  🔄 ${passName}...`);

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Texto del contrato:\n${contractText}` },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${passName} — llama-server error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const rawText = (data.choices[0].message.content || "")
    .replace(/<\|im_end\|>/g, "")
    .replace(/<\|im_start\|>/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  const tokens = {
    input: data.usage?.prompt_tokens || 0,
    output: data.usage?.completion_tokens || 0,
  };

  console.log(
    `  ✅ ${passName} — Tokens: ${tokens.input}+${tokens.output} = ${tokens.input + tokens.output}`
  );

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    console.error(`  ❌ ${passName} — JSON inválido:`, rawText.slice(0, 200));
    parsed = {};
  }

  return { parsed, tokens, raw: rawText };
}

/**
 * Análisis SIB completo: 3 pasadas + merge.
 * Retorna el JSON unificado con todos los campos del formulario SIB.
 */
async function analyzeSIB(contractText) {
  const prompts = loadSIBPrompts();

  console.log("🏛️  Análisis SIB — 3 pasadas");

  // Ejecutar las 3 pasadas en secuencia
  const [r1, r2, r3] = await Promise.all([
    runPass(prompts.datosBase, contractText, "Paso 1: Datos base"),
    runPass(prompts.clausulas, contractText, "Paso 2: Cláusulas"),
    runPass(prompts.riesgo, contractText, "Paso 3: Riesgo"),
  ]);

  // Merge de resultados
  const merged = {
    // ── Paso 1: Datos base ──
    fecha_suscripcion: r1.parsed.fecha_suscripcion || null,
    fecha_ultima_renovacion: r1.parsed.fecha_ultima_renovacion || null,
    fecha_vencimiento: r1.parsed.fecha_vencimiento || null,
    Contratante: r1.parsed.Contratante || null,
    Proveedor: r1.parsed.Proveedor || null,
    descripcion_servicio: r1.parsed.descripcion_servicio || null,
    descripcion_proceso: r1.parsed.descripcion_proceso || null,
    Monto: r1.parsed.Monto || null,
    Moneda: r1.parsed.Moneda || null,
    contrato_suscrito: r1.parsed.contrato_suscrito || "SI",
    entidad_intragrupo: r1.parsed.entidad_intragrupo || "NO",
    autorizacion_subcontratacion: r1.parsed.autorizacion_subcontratacion || "NO",
    tipo_mantenimiento: r1.parsed.tipo_mantenimiento || "Terceros",

    // ── Paso 2: Cláusulas ──
    sla_servicio_formal: r2.parsed.sla_servicio_formal || "NO",
    sla_servicio_descripcion: r2.parsed.sla_servicio_descripcion || null,
    sla_incidentes_formal: r2.parsed.sla_incidentes_formal || "NO",
    sla_incidentes_descripcion: r2.parsed.sla_incidentes_descripcion || null,
    confidencialidad: r2.parsed.confidencialidad || "NO",
    acceso_sib: r2.parsed.acceso_sib || "NO",
    evaluacion_servicio_banco: r2.parsed.evaluacion_servicio_banco || "NO",
    continuidad_servicio: r2.parsed.continuidad_servicio || "NO",
    terminacion_anticipada: r2.parsed.terminacion_anticipada || "NO",
    obligaciones_post_terminacion: r2.parsed.obligaciones_post_terminacion || "NO",
    penalizaciones_incumplimiento: r2.parsed.penalizaciones_incumplimiento || "NO",
    penalizaciones_detalle: r2.parsed.penalizaciones_detalle || null,
    evaluacion_cumplimiento_sla: r2.parsed.evaluacion_cumplimiento_sla || "NO",

    // ── Paso 3: Riesgo y operación ──
    proceso_critico: r3.parsed.proceso_critico || "NO",
    criticidad_servicio: r3.parsed.criticidad_servicio || "MEDIA",
    nivel_dependencia: r3.parsed.nivel_dependencia || "MEDIA",
    informacion_critica: r3.parsed.informacion_critica || "NO",
    tipo_informacion: r3.parsed.tipo_informacion || null,
    detalle_informacion: r3.parsed.detalle_informacion || null,
    planes_contingencia: r3.parsed.planes_contingencia || "NO",
    pruebas_continuidad: r3.parsed.pruebas_continuidad || "NO",
    planes_alternos_banco: r3.parsed.planes_alternos_banco || "NO",
    nube: r3.parsed.nube || "No especificado",
    activo_ciberespacio: r3.parsed.activo_ciberespacio || "NO",
    categoria_activo: r3.parsed.categoria_activo || null,
    esquema_conectividad: r3.parsed.esquema_conectividad || "No especificado",
  };

  // Tokens totales
  const totalTokens = {
    input: r1.tokens.input + r2.tokens.input + r3.tokens.input,
    output: r1.tokens.output + r2.tokens.output + r3.tokens.output,
    total:
      r1.tokens.input +
      r1.tokens.output +
      r2.tokens.input +
      r2.tokens.output +
      r3.tokens.input +
      r3.tokens.output,
    costo_usd: 0,
    modelo: process.env.LOCAL_MODEL || "./contratos_qwen7b",
    modo: "local",
    pasadas: 3,
    detalle: {
      paso1: r1.tokens,
      paso2: r2.tokens,
      paso3: r3.tokens,
    },
  };

  console.log(
    `🏛️  Análisis SIB completo — Tokens totales: ${totalTokens.total}`
  );

  return { data: merged, tokens: totalTokens };
}

module.exports = { analyzeSIB };