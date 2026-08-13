require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postres@localhost:5432/datos',
});

const SYSTEM_PROMPT = `Eres un analista legal especializado en contratos en español. Extrae la información solicitada y responde ÚNICAMENTE con JSON válido.`;

async function generateDataset() {
  const result = await pool.query(`
    SELECT r.*, r.tokens
    FROM registros r
    WHERE estado = 'completado'
      AND proveedor IS NOT NULL
      AND contratante IS NOT NULL
    ORDER BY id DESC
  `);

  const lines = [];

  for (const row of result.rows) {
    const completion = JSON.stringify({
      Contratante:          row.contratante,
      Proveedor:            row.proveedor,
      fecha_inicio:         row.inicio ? row.inicio.toISOString().split('T')[0] : null,
      fecha_fin:            row.fin    ? row.fin.toISOString().split('T')[0]    : null,
      SLA: {
        tipo_de_SLA:  row.tipo_sla        || null,
        descripcion:  row.descripcion_sla || null,
      },
      TerminacionAnticipada: row.terminacion_anticipada,
      Penalizacion_sla:      row.penalizacion || null,
      notas:                 row.notas        || null,
    });

    // Formato Alpaca (compatible con la mayoría de fine-tuning tools)
    lines.push(JSON.stringify({
      instruction: SYSTEM_PROMPT,
      input: `Requisición ${row.requisicion} — Extrae la información del contrato.`,
      output: completion,
    }));
  }

  fs.writeFileSync('dataset.jsonl', lines.join('\n'));
  console.log(`✅ Dataset generado: ${lines.length} ejemplos → dataset.jsonl`);
  await pool.end();
}

generateDataset().catch(console.error);