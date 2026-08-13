Como un analista tecnológico legal especializado en contratos en español y gestión de riesgo de proveedores, analiza el siguiente texto y evalúa los aspectos de riesgo y operación. Responde con JSON usando exactamente esta estructura:
{
  "proceso_critico": "SI o NO — ¿el proveedor soporta procesos de negocio identificados como críticos?",
  "criticidad_servicio": "MUY BAJA, BAJA, MEDIA, ALTA o MUY ALTA — criticidad del servicio para la operación del banco",
  "nivel_dependencia": "ALTA, MEDIA o BAJA — nivel de dependencia del banco hacia este proveedor",
  "informacion_critica": "SI o NO — ¿el proveedor procesa o almacena información crítica y/o confidencial de la entidad?",
  "tipo_informacion": "string — tipo de información almacenada (ej: Datos financieros, Datos personales, Credenciales, Logs, Configuraciones, No aplica), o null",
  "detalle_informacion": "string — breve detalle del tipo de información almacenado, o null",
  "planes_contingencia": "SI o NO — ¿se menciona que el proveedor cuenta con planes de contingencia para garantizar la continuidad del servicio?",
  "pruebas_continuidad": "SI o NO — ¿se menciona que el banco es informado del resultado de pruebas de continuidad realizadas por el proveedor?",
  "planes_alternos_banco": "SI o NO — ¿se menciona que la entidad cuenta con planes alternos en caso el proveedor no pueda continuar prestando el servicio?",
  "nube": "string — tipo de nube si aplica (AWS, Azure, GCP, Oracle Cloud, Nube privada, On-premise, Híbrido, No especificado)",
  "activo_ciberespacio": "SI o NO — ¿el servicio constituye un activo en el ciberespacio (software, plataforma, infraestructura digital)?",
  "categoria_activo": "string — categoría del activo (Software, Hardware, Plataforma SaaS, Infraestructura, Servicio profesional, Licenciamiento, Otro), o null",
  "esquema_conectividad": "string — esquema de conectividad (VPN, Internet, Red privada, API, No especificado)"
}

INSTRUCCIONES IMPORTANTES:
- Responde ÚNICAMENTE con el JSON, sin explicaciones adicionales.
- Para criticidad_servicio, evalúa según el impacto que tendría la interrupción del servicio en la operación del banco:
  - MUY ALTA: Servicios core bancarios (procesamiento de transacciones, core banking, seguridad perimetral).
  - ALTA: Servicios de infraestructura crítica (bases de datos, servidores, antivirus/EDR, firewalls).
  - MEDIA: Servicios de soporte operativo (licenciamiento, monitoreo, gestión de identidades).
  - BAJA: Servicios de consultoría, capacitación o proyectos puntuales.
  - MUY BAJA: Servicios administrativos sin impacto operativo.
- Para nivel_dependencia, evalúa si el banco puede operar sin el proveedor a corto plazo:
  - ALTA: Sin el proveedor, el servicio se detiene y no hay alternativa inmediata.
  - MEDIA: Existe alternativa pero la migración tomaría semanas/meses.
  - BAJA: El servicio puede ser reemplazado fácilmente o es puntual.
- Para activo_ciberespacio, responde SI si el servicio involucra software, plataformas digitales, licencias de software o infraestructura tecnológica.
- Si un dato no se encuentra explícitamente en el texto, usa tu mejor criterio basado en el tipo de servicio descrito.
