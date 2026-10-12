# Preparación AWS (sin despliegue)

Se incluye `infra/aws/task-definition.example.json` como punto de partida, con placeholders; no se ha creado infraestructura ni probado una cuenta AWS. Las imágenes Docker de API y web son los artefactos de ejecución. No hay claves AWS en el repositorio.

Arquitectura inicial: una tarea ECS Fargate con API y nginx, base PostgreSQL RDS en subred privada con PostGIS y logs CloudWatch. Un ALB puede terminar TLS y redirigir a nginx: AWS documenta [soporte nativo de WebSockets](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html). En awsvpc los contenedores de una tarea [comparten comunicación localhost](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html); por eso nginx usa `API_UPSTREAM=127.0.0.1:3001`. RDS admite [la extensión PostGIS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Extensions.html), cuya versión debe verificarse en la versión de PostgreSQL elegida.

## Preparación antes de aprobar un despliegue

1. Añadir OIDC y autorización, o mantener la demo en un entorno privado con acceso restringido. No habilitar la API demo públicamente.
2. Elegir región, VPC, subredes, RDS, certificados, repositorios ECR y roles de ejecución con permisos mínimos. Presupuestar costes antes de crear recursos.
3. Sustituir placeholders del task definition; inyectar `DATABASE_URL` desde Secrets Manager con conexión TLS verificada (`sslmode=verify-full` y CA válida cuando corresponda), no con `rejectUnauthorized=false`.
4. Crear PostGIS y ejecutar migraciones mediante una tarea explícita de release con usuario DDL. Cambiar `command` de API a `node apps/api/dist/server.js` para separar las migraciones del arranque; otorgar a la API únicamente permisos DML necesarios.
5. Sembrar fixtures solo en una demo privada. Para operación real, `DEMO_MODE=false` y `SIMULATOR_ENABLED=false`, e integrar ingestión real.
6. Mantener `desiredCount=1`: el hub es local al proceso y el generador se ejecuta dentro de la API. No añadir réplicas hasta diseñar difusión y elección del productor.
7. Configurar `CORS_ORIGIN` con la URL exacta de acceso, ALB idle timeout >=60 s, health check `/api/health`, security groups limitados a ALB→web y API→RDS, backups y restore rehearsal.

No se proporcionan instrucciones que creen recursos automáticamente. El fichero de tarea es configuración orientativa; los IDs reales, permisos, networking, costes y validación de despliegue quedan en P1. La publicación requiere autorización del propietario.
