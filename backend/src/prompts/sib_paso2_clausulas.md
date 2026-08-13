Como un analista tecnológico legal especializado en contratos en español, analiza el siguiente texto y determina si el contrato contiene las siguientes cláusulas. Responde con JSON usando exactamente esta estructura:
{
  "sla_servicio_formal": "SI o NO — ¿existen acuerdos formales de SLA del servicio?",
  "sla_servicio_descripcion": "string — descripción breve del SLA de servicio si existe, o null",
  "sla_incidentes_formal": "SI o NO — ¿existen acuerdos formales de SLA de incidentes (tiempos de respuesta, severidades)?",
  "sla_incidentes_descripcion": "string — descripción breve del SLA de incidentes si existe, o null",
  "confidencialidad": "SI o NO — ¿existen acuerdos formales de confidencialidad o cláusulas de no divulgación?",
  "acceso_sib": "SI o NO — ¿los contratos contemplan cláusulas que garanticen el libre acceso de la SIB (Superintendencia de Bancos) a las instalaciones y recursos del proveedor?",
  "evaluacion_servicio_banco": "SI o NO — ¿el contrato contempla que la entidad bancaria puede evaluar el servicio contratado, con acceso a documentación, instalaciones y sistemas del proveedor?",
  "continuidad_servicio": "SI o NO — ¿el contrato incluye cláusulas que aseguren la continuidad de la prestación del servicio?",
  "terminacion_anticipada": "SI o NO — ¿el contrato incluye cláusulas de terminación anticipada?",
  "obligaciones_post_terminacion": "SI o NO — ¿el contrato incluye obligaciones posteriores a la terminación (devolución de datos, transición, etc.)?",
  "penalizaciones_incumplimiento": "SI o NO — ¿el contrato incluye penalizaciones por incumplimiento contractual?",
  "penalizaciones_detalle": "string — detalle de las penalizaciones si existen (montos, porcentajes, horas de capacitación, etc.), o null",
  "evaluacion_cumplimiento_sla": "SI o NO — ¿se establece un mecanismo de evaluación del cumplimiento de los SLA?"
}

INSTRUCCIONES IMPORTANTES:
- Responde ÚNICAMENTE con el JSON, sin explicaciones adicionales.
- Responde "SI" solo si la cláusula se encuentra explícitamente en el texto del contrato.
- No asumas ni inferas — si no hay evidencia textual clara, responde "NO".
- Para las descripciones, sé breve y concreto (máximo 2 líneas).
- Para terminación anticipada, busca variantes como: terminación/rescisión/finalización anticipada, resolución del contrato, etc.
- Para acceso_sib, busca menciones a "Superintendencia", "SIB", "ente regulador", "autoridades supervisoras" o similares.
