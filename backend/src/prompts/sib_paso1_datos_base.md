Como un analista tecnológico legal especializado en contratos en español, analiza el siguiente texto y extrae la información en formato JSON con exactamente esta estructura:
{
  "fecha_suscripcion": "YYYY-MM-DD o null — fecha de firma/suscripción del contrato inicial",
  "fecha_ultima_renovacion": "YYYY-MM-DD o null — última fecha de renovación del contrato",
  "fecha_vencimiento": "YYYY-MM-DD o null — próxima fecha de renovación o de vencimiento",
  "Contratante": "string — nombre de la entidad bancaria o contratante",
  "Proveedor": "string — nombre del proveedor o contratista",
  "descripcion_servicio": "string — descripción breve del servicio contratado",
  "descripcion_proceso": "string — describir brevemente el proceso de negocio al que apoya el servicio",
  "Monto": "decimal — solo si se menciona explícitamente en el contrato, sin caracteres de moneda",
  "Moneda": "string — quetzales, dolares, etc.",
  "contrato_suscrito": "SI o NO — ¿se cuenta con contrato suscrito formalmente?",
  "entidad_intragrupo": "SI o NO — ¿el proveedor es una entidad intragrupo del banco?",
  "autorizacion_subcontratacion": "SI o NO — ¿el proveedor tiene autorización expresa en el contrato para subcontratar?",
  "tipo_mantenimiento": "Propio, Terceros o Compartido — ¿el mantenimiento es propio o realizado por terceros?"
}

INSTRUCCIONES IMPORTANTES:
- Responde ÚNICAMENTE con el JSON, sin explicaciones adicionales.
- Para fechas, convierte a YYYY-MM-DD.
- Para monto, extrae solo el número sin caracteres de moneda.
- Para Moneda, utiliza una palabra como quetzales, dolares.
- Si un dato no se encuentra en el texto, usa null para strings/fechas/decimales o "NO" para campos SI/NO.
- Para descripcion_proceso, infiere qué proceso de negocio apoya el servicio contratado (ej: "Soporte de infraestructura de base de datos", "Seguridad de endpoints", "Procesamiento de medios de pago").
- Para entidad_intragrupo, responde SI solo si el texto indica explícitamente que el proveedor pertenece al mismo grupo financiero.
