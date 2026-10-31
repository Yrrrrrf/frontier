# Frontier Reto 2 — Correcciones y fallbacks implementados

**Fecha de actualización:** 2026-10-31 · **Estado:** correcciones implementadas y validadas localmente; aceptación real del primer clic y E1 todavía pendiente.

Este documento describe el estado actual del servidor y sus fallbacks. Las instrucciones operativas están en `VALIDATION.md`, el handoff resumido en `CURRENT-CONTEXT.md`, y el modelo de trazas en `OBSERVABILITY.md`. El contrato oficial sigue siendo `reto-2/README.md` y tiene prioridad.

## 1. Alcance actual

El servidor vive en `client/apps/r2/server`. Se conservaron:

- Node/TypeScript, noVNC mediante Playwright y Ollama local.
- Los DTO y estados oficiales `en_curso`, `terminada`, `fallida`.
- Bearer en `/health`, `POST /tasks`, `GET /tasks/{task_id}` y la ruta adicional de trazas.
- Un único deadline monotónico de cinco minutos por tarea.
- Operación por píxeles del canvas noVNC, sin DOM ni APIs internas de SIGECOM.
- Acciones internas `click`, `finish`, `fail`; visión permanece libre de efectos laterales.

El runner actual admite objetivos ejecutables mediante **clics visibles y varios pasos acotados**. Conserva el objetivo original y el historial reciente, puede cerrar modales benignos como progreso intermedio y continúa hasta verificar la postcondición original. No admite escritura de texto ni es todavía un agente general para E1 o aplicaciones desconocidas.

## 2. Arquitectura implementada

| Archivo | Estado actual |
| --- | --- |
| `client/sdk/core/src/schemas/frontier.ts` | DTO oficiales y tipos separados para trazas de solo lectura |
| `client/apps/r2/server/src/main.ts` | Composición real de Ollama, noVNC, runner, preflight y `MemoryTraceSink` persistente |
| `client/apps/r2/server/src/http.ts` | Auth, validación, readiness/admisión, rutas oficiales, trazas autenticadas y CORS explícito para r2 |
| `client/apps/r2/server/src/service.ts` | Estado RAM, deadline absoluto, cancelación, transición terminal única y resultados tardíos descartados |
| `client/apps/r2/server/src/runner.ts` | Bucle acotado de login/captura/inferencia/guard/clic/observación/verificación/cleanup, con recuperación de modales y hasta 8 acciones/12 iteraciones |
| `client/apps/r2/server/src/vision.ts` | Transporte Ollama acotado, lectura streaming, clasificación de errores y validación de acciones |
| `client/apps/r2/server/src/vnc.ts` | Driver noVNC con señal/deadline, geometría de frame fuente, clic y cleanup idempotente |
| `client/apps/r2/server/src/trace.ts` | Eventos correlacionados, metadata, redacción por tarea, memoria acotada y JSONL |
| `client/apps/r2/src/routes/+page.svelte` | Dashboard en vivo para inspeccionar estado, metadata y eventos |

No existe un worker `vision/` separado. Ollama propone; el runner autoriza y ejecuta; `TaskService` posee el estado público y la transición terminal.

## 3. Corrección A — Readiness real y composición

Implementado:

- `main.ts` construye el runner real en lugar de depender del placeholder.
- El preflight comprueba acceso ejecutable a Chromium y disponibilidad del modelo configurado mediante Ollama `/api/tags`.
- Readiness comienza en falso, se almacena en caché y se refresca periódicamente cada 30 segundos; `/health` no ejecuta inferencias.
- Mientras no existe composición o el preflight no está sano, `/health` responde 503 y un nuevo `POST /tasks` responde 503 sin registrar trabajo.
- El polling de tareas ya registradas permanece disponible aunque readiness se degrade.
- Las credenciales/URL de un escritorio remoto pertenecen a la tarea, no al preflight global.

Preflight saludable significa que las dependencias locales básicas están disponibles; no demuestra que un objetivo remoto pueda completarse.

## 4. Corrección B — Deadline, cancelación y cleanup

Implementado:

- Deadline único calculado desde recepción HTTP con `performance.now()` y reloj inyectable en pruebas.
- Comprobación `now() >= deadlineMs` antes de ejecutar y después de éxito/error del runner, incluida la frontera exacta.
- La transición terminal se publica antes de llamar a los listeners de aborto.
- `#finish` es la puerta única; resultados tardíos no reabren el estado y generan `late_result.discarded` si existe traza.
- Shutdown cierra tareas abiertas como `fallida`, cancela timers y conserva resultados terminales.
- Login, captura, inferencia e input reciben señal y tiempo restante, con reserva inicial de cleanup de 2 segundos.
- La cancelación alcanza la sesión noVNC; el cierre intenta liberar input y cerrar contexto/browser de forma acotada e idempotente.
- Un cleanup tardío o fallido no reabre ni sustituye un terminal ya publicado.

Un guard de JavaScript no promete rollback de un clic nativo ya enviado ni interrupción de CPU síncrona bloqueante. Por eso el runner vuelve a comprobar actividad antes de cada efecto y distingue efectos inciertos.

## 5. Corrección C — Ollama durante headers y cuerpo

Implementado:

- El mismo deadline cubre `fetch()` y lectura del cuerpo streaming.
- Se registra la primera causa de aborto: timeout interno o cancelación del padre.
- Timeout de tarea/padre no se reclasifica como `invalid_input`.
- El cuerpo se corta al superar 1 MiB y se clasifica como `invalid_response`.
- Envelope/content ausente o JSON de envelope inválido se separa de acción JSON inválida, campos extra, kind desconocido o coordenadas fuera de bounds.
- `finish.evidence` y `fail.reason` tienen `maxLength: 500` tanto en schema como en validación runtime.
- Timer/listener se liberan en `finally` para todas las salidas.

Política actual de inferencia: máximo dos llamadas por propuesta cuando el error es recuperable. Cancelación, input inválido o segundo fallo detiene el intento. No se cambia automáticamente a otro modelo.

## 6. Runner y fallbacks operativos

| Frontera | Política implementada |
| --- | --- |
| Objetivo que requiere inputs no implementados | El modelo solo puede proponer `click`, `finish` o `fail`; debe fallar honestamente si no hay paso visible seguro |
| Progreso intermedio/modal | Registra `progress.observed`, conserva contexto y continúa sin marcar éxito por cerrar el modal |
| Ausencia de progreso | Detiene estados de objetivo repetidos y aplica máximo 8 acciones/12 iteraciones sin reiniciar el deadline |
| Login noVNC | Hasta dos intentos solo cuando el error de transporte es recuperable; credenciales fallidas no se insisten ciegamente |
| Captura | Hasta dos intentos; registra dimensiones/hash y evita inferencia sin frame válido |
| Inferencia | Máximo dos llamadas según taxonomía de error y budget restante |
| Frame/propuesta | Se recaptura antes del input; cambio de hash invalida la propuesta y permite una recuperación acotada |
| Guard | Exige tarea activa, budget, frame fuente y geometría válidos inmediatamente antes del input |
| Input incierto | Intenta observar/cleanup; nunca repite automáticamente una mutación cuyo efecto es desconocido |
| Post-frame | Cambio de hash registra `effect.observed`, pero todavía no prueba el objetivo |
| Cierre | Exige una propuesta visual `finish` separada sobre el post-frame; `finish` sin postcondición no publica éxito |
| Cleanup | Se ejecuta en `finally`; sus fallos se trazan sin alterar el terminal |

No se permiten coordenadas hardcodeadas de Comercial ni éxito genérico basado en abrir un menú. La lógica específica de Comercial sigue perteneciendo al validador smoke, no al planner general.

## 7. Observabilidad integrada

Las mismas fronteras emiten eventos con `taskId`, `iteration`, `frameId`/`actionId` cuando aplican, reloj monotónico, duración, estado y metadata sanitizada.

- Lectura adicional: `GET /tasks/{task_id}/trace`, con Bearer.
- Persistencia: JSONL bajo `client/apps/r2/server/artifacts/traces/`, ignorado por Git.
- Dashboard: `client/apps/r2/src/routes/+page.svelte`, con polling mientras la tarea está abierta.
- Secretos: password/URL del escritorio se registran como valores protegidos por tarea y se eliminan antes de memoria/JSONL; tokens no se almacenan en el navegador.
- CORS: solo orígenes r2 explícitos mediante `FRONTIER_UI_ORIGINS`.

`input.executed`, `effect.observed` y `closure.verified` representan afirmaciones diferentes. Una traza no sustituye evidencia real de la aplicación.

## 8. Evidencia actual

Validación local ejecutada:

```sh
cd client/apps/r2/server
npm install
npm run validate

cd client
just cycle
```

Resultados:

- TypeScript del servidor: **PASS**.
- Node tests: **34/34 PASS**.
- Client tests, seis trabajos de tipos, lint/formato y builds de ambas apps: **PASS**.
- r2 lint: **0 errores y 0 warnings**.
- `git diff --check`: **PASS**.

Las pruebas usan runners, reloj, fetch, streams y escritorios falsos. Demuestran regresiones de control, no éxito sobre SIGECOM real.

Evidencia real histórica, no repetida durante esta implementación:

- Login/captura noVNC 1280×800: PASS.
- Tres propuestas válidas dentro del rectángulo Comercial, `(192,120)`, aproximadamente 1.1 s por propuesta warm.

## 9. Pendiente de aceptación real

Siguen **NOT_RUN**:

- Ejecución real sobre el tema nuevo de FR-0153, incluido modal → Comercial.
- Clic real guardado y verificado.
- Tarea completa mediante API pública.
- E1 y escritura con `Ctrl+A` seguido de texto.
- Aplicación desconocida, deployment público y generalización.

El siguiente gate debe ejecutar una tarea explícita de un clic en Comercial mediante la API y conservar:

1. Login y captura fresca.
2. Propuesta válida y guards de deadline/frame/geometría.
3. `side_effect.before` y exactamente un clic.
4. Captura posterior con el menú visible.
5. Verificación visual separada, estado terminal y cleanup.
6. Evidencia before/after más la traza autenticada visible en r2.

Después de ese gate se puede añadir reemplazo de texto y ejecutar E1 con el endpoint práctico `/__check`. No se debe convertir un PASS de mocks, una propuesta visual o una traza de input en una afirmación de tarea real completada.
