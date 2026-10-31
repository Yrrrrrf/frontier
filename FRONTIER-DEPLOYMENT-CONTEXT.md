# FRONTIER R2 — Contexto para despliegue y validación real

Fecha: 31 de octubre de 2026 · zona del participante: America/Mexico_City.
Responsable: Fernando / Yrrrrrf.
Repositorio indicado por Fernando: https://github.com/Yrrrrrf/frontier

## 0. Arranque de la nueva instancia

**La siguiente fase es revisar el checkout actual, poner el agente en una URL HTTPS pública y probar tareas reales por ese mismo entrypoint.** Ya existe un prototipo funcional. Fernando pide partir del supuesto de que las correcciones funcionales de `FR-0153-READINESS.md` están aplicadas y funcionando.

No reinicies la discusión de arquitectura ni vuelvas a presentar el límite histórico de un clic como si siguiera necesariamente abierto. Comprueba brevemente el código actual y los resultados existentes; después avanza hacia el despliegue. Si encuentras una regresión concreta que lo impida, corrige ese bloqueo y continúa.

Este documento es un handoff de trabajo. Su creación **no inspeccionó un commit posterior a las correcciones, no desplegó un servicio y no ejecutó nuevas tareas reales**. “Correcciones hechas” es el punto de partida solicitado por Fernando, no un resultado inventado de esta sesión.

### Autoridad de las fuentes

1. Reglas y contrato oficiales actuales del reto, incluido `reto-2/README.md` y el contrato del entrypoint que muestra la plataforma.
2. Checkout y configuración reales del repositorio: HEAD, scripts, código y evidencia reciente.
3. Supuesto de continuidad del usuario: prototipo funcional y correcciones de FR-0153 completadas.
4. Este contexto para orientar la fase operativa.
5. Exports y documentos antiguos como antecedentes, no como descripción definitiva del HEAD actual.

El último código revisado antes de esas correcciones fue el export `frontier-20261031_151639.txt`. Úsalo sólo como referencia histórica si necesitas comparar. No reconstruyas el proyecto desde ese export si ya tienes el checkout actualizado.

## 1. Qué estamos construyendo

Un agente recibe una tarea y acceso a un escritorio remoto. Devuelve rápidamente un `task_id`; ejecuta el trabajo en segundo plano y permite consultar el estado y un resumen por HTTP.

El ciclo principal es:

**Tarea → captura actual → modelo visual local → propuesta estructurada → guards → acción → nueva captura → verificar avance/objetivo → continuar o terminar.**

- **TypeScript / Node:** contrato HTTP, autenticación, estado de tareas, coordinación, plazo, cancelación, recuperación, validación y ejecución.
- **Playwright + noVNC:** conexión al visor, autenticación del escritorio, captura del canvas remoto y envío de inputs permitidos.
- **Ollama + Qwen3-VL:** interpreta capturas y propone acciones; el mismo modelo puede valorar el efecto observado.
- **Cliente Svelte + SDK existente:** observabilidad y consumo del servicio. No ejecuta la inferencia ni mantiene viva la tarea.
- **RTX 4060 del participante:** host previsto para inferencia local. La disponibilidad real del host y de su GPU se comprueba al preparar el despliegue.

El agente debe funcionar aunque el dashboard esté cerrado. Interactúa con la aplicación por su representación visual y los inputs permitidos; no obtiene el DOM, selectores, árboles de accesibilidad o APIs internas de la aplicación objetivo. Los selectores usados para operar el transporte noVNC no equivalen a selectores de la app remota.

No se necesita añadir por defecto otro modelo planificador, otro verificador, un backend Python ni una plataforma de colas para completar esta fase.

## 2. Estado asumido al entregar este contexto

### Base conocida antes del último ajuste

El servidor ya tenía contrato compartido, Bearer auth, readiness local, tarea asíncrona, deadline absoluto, cancelación, guards de frame/geometría, validación de propuestas, clasificación de fallos de Ollama y trazas sanitizadas. Había también un dashboard de observabilidad.

### Cambios de FR-0153 verificados localmente

- El runner continúa durante varios pasos bajo un presupuesto total y un límite de pasos.
- Conserva el objetivo original, en vez de confundir un paso intermedio con éxito.
- Puede resolver el modal inicial permitido y continuar después de recapturar.
- Lleva contexto breve de acciones/efectos a las siguientes decisiones.
- Separa decisión de siguiente paso y comprobación de la postcondición original.
- Trabaja con controles movidos y etiquetas cambiadas a partir de la pantalla actual.
- Conserva guards, cancelación y protección contra resultados/input tardíos.
- Si un input pudo haberse aplicado, observa antes de decidir el siguiente movimiento; no lo duplica a ciegas.
- El ciclo modal → objetivo tiene regresiones con dobles; las referencias independientes del tema nuevo y su validación real siguen pendientes. El rectángulo histórico no debe reutilizarse como referencia del tema nuevo.

Verificar estos puntos mediante una revisión dirigida y las pruebas existentes; no volver a implementarlos por inercia. La adaptación de interfaz se confirma con resultados de tareas, no sólo porque exista un bucle.

### Caché y Laya

La optimización discutida es: mapa de pantalla validado → selección determinista para objetivos inequívocos o Laya para candidatos ambiguos → `controlId` → región vigente → misma propuesta y mismos guards.

En el último export revisado no existían una caché visual ni Laya integrado. Las correcciones obligatorias de FR-0153 no convierten estos experimentos opcionales en requisitos de entrega. Revisa su estado actual sin asumir que están implementados ni bloquear el despliegue por su ausencia.

Si ya existen, deben tener fallback a visión y no reutilizar mapas sobre un tema, modal, sesión o geometría incompatibles. Si no existen, continúa con la ruta visual funcional. No introduzcas Python/uv/Laya sólo para publicar el agente.

## 3. Mapa de código para orientarse

Estas rutas existían en el último export. Confirma su ubicación actual antes de editar.

| Ruta | Responsabilidad |
| --- | --- |
| `client/apps/r2/server/src/main.ts` | Composición del servidor, visión, runner, readiness, trazas y entorno. |
| `client/apps/r2/server/src/http.ts` | HTTP, autenticación, admisión, rutas oficiales y trazas de desarrollo. |
| `client/apps/r2/server/src/service.ts` | Registro de tareas, estados, plazo absoluto, cancelación y resultados terminales. |
| `client/apps/r2/server/src/runner.ts` | Ciclo del agente, observaciones, acciones, recuperación y cierre del escritorio. |
| `client/apps/r2/server/src/vision.ts` | Ollama `/api/chat`, imagen/prompt, schema, parseo, métricas y errores. |
| `client/apps/r2/server/src/vnc.ts` | Transporte noVNC, capturas, transformación de coordenadas, inputs y cleanup. |
| `client/apps/r2/server/src/trace.ts` | Eventos y resúmenes acotados, redacción de secretos y persistencia JSONL. |
| `client/apps/r2/server/src/validate-desktop.ts` | Sonda de acceso/captura real. |
| `client/apps/r2/server/src/validate-vision.ts` | Sonda independiente de percepción; no sustituye una ejecución real. |
| `client/apps/r2/server/test/` | Pruebas del servidor y de los límites de sus componentes. |
| `client/sdk/core/src/schemas/frontier.ts` | DTOs oficiales y tipos de observabilidad. |
| `client/sdk/api/src/frontier.ts` | Cliente tipado del contrato del agente. |
| `client/apps/r2/src/routes/+page.svelte` | Dashboard operativo. |
| `CURRENT-CONTEXT.md`, `VALIDATION.md`, `OBSERVABILITY.md` | Instrucciones y evidencia que deben contrastarse con el código actual. |

## 4. Contrato que debe sobrevivir al despliegue

El contrato conocido tenía `GET /health`, `POST /tasks` y `GET /tasks/{task_id}`. Confirma métodos, status codes, payloads y autenticación exactos en las instrucciones oficiales actuales; no deduzcas esos detalles sólo de este resumen.

Entrada conocida de creación:

```json
{
  "tarea": "<objetivo real del caso de práctica>",
  "escritorio": {
    "url": "<acceso remoto autorizado>",
    "password": "<credencial del escritorio>"
  }
}
```

Respuesta de aceptación conocida:

```json
{ "task_id": "<identificador>" }
```

Consulta de una tarea:

```json
{ "estado": "en_curso", "resumen": "<resumen>" }
```

Estados públicos: `en_curso`, `terminada`, `fallida`. Mantenerlos sin extensiones incompatibles. El Bearer de equipo y la contraseña del escritorio son credenciales diferentes.

Límites de diseño conocidos: respuesta inicial inferior a dos segundos y hasta cinco minutos de ejecución por tarea. Ratificar su definición exacta en el contrato oficial. El presupuesto total no se reinicia al recuperar un modal, esperar capacidad o refrescar visión/caché.

El entrypoint a entregar es el **servicio HTTP del agente**, en el formato que exija el contrato; no la URL del dashboard, de Ollama ni del visor noVNC. No entregar `/health` como URL base sin comprobar qué espera la plataforma.

## 5. Lo que muestra la captura de entrega

Estado observado en la imagen adjunta, no consulta en vivo de la plataforma:

| Campo | Estado en la captura | Próximo paso |
| --- | --- | --- |
| Repo público | `https://github.com/Yrrrrrf/frontier`, entregado a las 12:07 por Fernando. | Comprobar accesibilidad y que el commit correcto esté disponible. No reemplazar la URL por rutina. |
| Entrypoint | Vacío, pendiente de validación. | Obtener una URL HTTPS estable y probar por ella el contrato completo. |
| Set oculto | 0 de 3 corridas usadas; 3 restantes. | Verificar el cupo actual antes de una evaluación candidata. |
| Video | Enlace público vacío; duración máxima de dos minutos. | Grabar resultado real y explicación del incidente, comprobar acceso y entregar el enlace. |
| Progreso | 1 de 3 campos listos. | La plataforma sólo marca como entregados los campos que pasan su validación. |

La captura muestra cierre a las **19:00** y una cuenta regresiva. Es información de esa captura: comprobar el plazo vigente en la plataforma y no reutilizar su contador como reloj actual.

La plataforma advierte que el entrypoint debe seguir disponible durante el debrief para poder ejecutar la evaluación. Esto condiciona el despliegue: publicar una URL durante unos minutos no basta.

## 6. Destino del despliegue

### Ruta inicial preferida por simplicidad

Mantener juntos el agente, el navegador/controlador y Ollama en el host que ya ejecuta la inferencia correctamente. Exponer **sólo la API del agente** mediante un ingreso HTTPS estable compatible con ese host: proxy inverso o túnel existente, según los recursos y acceso disponibles.

Recorrido de red esperado:

**Evaluador → HTTPS público → API Node → runner → Ollama local + escritorio remoto.**

Usar un proceso supervisado o un mecanismo equivalente que mantenga el servicio y el ingreso activos sin depender de una terminal que se cierre. En NixOS, aprovechar la configuración y herramientas disponibles; no migrar de sistema ni desplegar una pila nueva por preferencia.

Si el host personal no puede permanecer encendido/conectado hasta el debrief, elegir un host disponible que pueda ejecutar de verdad las dependencias de inferencia y navegador. Publicar sólo el frontend en hosting estático no resuelve el backend. No trasladar la inferencia a una máquina sin comprobar memoria, modelo y latencia.

No fijar proveedor, dominio, GPU remota, contenedores o servicios de pago antes de conocer los recursos existentes. La decisión mínima es: **qué máquina ejecuta el trabajo y cómo el evaluador llega a su API durante toda la ventana necesaria**.

### Puntos que comprobar en la ruta elegida

- HTTPS válido, host/ruta correctos y acceso desde otra red sin VPN privada del participante.
- El ingreso no agrega login interactivo, página intersticial o redirecciones que rompan al evaluador.
- El proxy preserva `Authorization`, métodos, JSON y rutas.
- Crear una tarea responde rápido; el trabajo continúa fuera del request inicial y se consulta por polling.
- El host del agente puede acceder tanto al escritorio remoto como al Ollama configurado.
- Ollama permanece en una red privada/loopback; no se publica su puerto como entrypoint.
- El equipo y el túnel/proxy permanecen disponibles después de cerrar el dashboard y durante el debrief.
- La capacidad de GPU/navegador y la admisión de tareas son compatibles con la concurrencia oficial. Revisar esto sin añadir una plataforma de colas si no hace falta.

## 7. Configuración de ejecución conocida

| Variable | Uso conocido | Comprobación de despliegue |
| --- | --- | --- |
| `TEAM_TOKEN` | Bearer del contrato de equipo. | Configurarlo por un mecanismo de secretos/entorno; no commitearlo. |
| `PORT` | Puerto HTTP; antes 3000 por defecto. | Debe coincidir con el destino del proxy/túnel. |
| `OLLAMA_BASE_URL` | Ollama; antes `http://127.0.0.1:11434`. | Resuelve desde el proceso real del agente, no sólo desde la shell de desarrollo. |
| `VISION_MODEL` | Antes `qwen3-vl:2b`. | Modelo instalado, carga/inferencia funcional y presupuesto compatible. |
| `CHROMIUM_EXECUTABLE` | Ruta opcional al navegador; importante en el host NixOS usado. | Ejecutable y librerías disponibles para el usuario del servicio. |
| `FRONTIER_UI_ORIGINS` | Orígenes permitidos del dashboard, separados por comas. | Configurar el origen público sólo si se publica el dashboard. CORS no reemplaza Bearer auth. |
| `DESKTOP_URL`, `DESKTOP_PASSWORD` | Variables de las sondas manuales. | No confundirlas con una sesión fija para todas las tareas: cada petición aporta su escritorio. |

Leer el entorno real y las opciones del HEAD actual. Una instalación de `playwright-core` no descarga por sí misma el navegador del host; comprobar la configuración que ya funcione. Evitar cambiar de versión/runtime durante la entrega sin un bloqueo comprobado.

El readiness histórico comprobaba que el ejecutable existiera y que Ollama listara el modelo. Eso no demuestra una inferencia visual ni la conectividad hacia el escritorio. Usar una tarea real para validar la cadena completa.

El estado de tareas del último snapshot estaba en RAM y las trazas JSONL en disco. Comprobar si sigue así. No reiniciar procesos durante tareas/evaluación ni prometer recuperación de tareas tras reinicio que no existe. Mantener logs/evidencia necesarios sin introducir una base de datos por defecto.

## 8. Plan de ejecución para la siguiente instancia

### G0 — Revisar el checkout actual y elegir un candidato

1. Leer instrucciones del proyecto y contrato oficial. Inspeccionar branch/HEAD, cambios locales y scripts disponibles sin sobrescribir trabajo ajeno.
2. Identificar las correcciones de FR-0153 y su evidencia. Hacer revisión dirigida de runner, prompt, verificación y referencias del tema nuevo.
3. Identificar prácticas oficiales, reset de sesión y restricciones de inputs. Confirmar que las primitivas actuales cubren las tareas que se van a probar.
4. Ejecutar una vez las comprobaciones existentes adecuadas al candidato. Usar lockfiles y scripts del proyecto; no actualizar dependencias por rutina.
5. Elegir host e ingreso público con los recursos reales. Registrar el commit candidato.

**Salida:** candidato reproducible, capacidades/limitaciones identificadas y ruta de publicación concreta. No invertir esta fase en otra auditoría general si no aparece un bloqueo de entrega.

### G1 — Arranque operativo local

1. Configurar el entorno del proceso real; arrancar Ollama, navegador requerido y agente.
2. Comprobar inferencia con imagen y disponibilidad real del modelo/GPU cuando corresponda; reutilizar la evidencia reciente si sigue aplicando al mismo entorno.
3. Comprobar `/health` y autenticación según contrato. Verificar que un fallo de dependencias no se presente como disponibilidad completa.
4. Arrancar el dashboard sólo si ayuda a observar el flujo.

Scripts históricos del servidor: `npm start`, `npm run validate`, `npm run validate:desktop`, `npm run validate:vision`. Confirmarlos en `client/apps/r2/server/package.json` antes de usarlos.

**Salida:** proceso arrancable bajo su entorno de servicio y una cadena local de dependencias funcional.

### G2 — Tarea real por el contrato local

1. Usar un escritorio/caso de práctica autorizado desde un estado inicial conocido.
2. Enviar una tarea por `POST /tasks`; medir la respuesta inicial.
3. Consultar el mismo `task_id` durante la ejecución y hasta un terminal dentro del plazo.
4. Confirmar el resultado visible real, no sólo una traza de input o un texto de `finish`.
5. Incluir el caso del tema nuevo: modal inicial → recuperación → continuación → postcondición original. Comprobar etiqueta/posición cambiadas cuando el caso lo permita.
6. Verificar un fallo controlado relevante y que no se emitan inputs después de terminar/cancelar.

**Salida:** al menos una tarea completa con evidencia correlacionada y cobertura real del incidente que se pretende declarar resuelto. Reparar el primer bloqueo observado y repetir sólo los casos afectados.

### G3 — Publicar y probar desde fuera

1. Poner el ingreso HTTPS delante del mismo agente candidato y mantenerlo supervisado.
2. Desde un cliente externo a su localhost/red privada, comprobar autenticación y salud.
3. Crear y consultar una tarea real por **la URL pública**. No sustituir esta prueba con la ejecución local de G2.
4. Cerrar el dashboard/terminal de desarrollo que no sean necesarios y confirmar que el servicio sigue accesible y conserva la tarea.
5. Comprobar acceso al repo público y que identifica el código usado en la prueba. Registrar el SHA y la configuración no secreta.

**Salida:** URL HTTPS base comprobada, tarea pública completa, latencias y plan de permanencia hasta el debrief.

### G4 — Práctica oficial y evaluación candidata

Leer las herramientas oficiales del reto. La documentación histórica menciona E1 y un endpoint de práctica `/__check`; confirmar su existencia, semántica y ámbito antes de usarlo. Usar una comprobación de práctica para evaluar el resultado cuando las reglas lo permitan, separada del mecanismo del agente que actúa por pantalla.

Antes de pulsar “Validar entrypoint”, averiguar qué comprueba, cómo se autentica y si dispara/consume una corrida oculta. No utilizar el set oculto para depurar DNS, certificados, tokens, paths o procesos que aún no están levantados.

Priorizar prácticas repetibles y evidencia externa. Para cada corrida oculta candidata, registrar versión, configuración, resultado y cupo restante; no gastar automáticamente las tres en reintentos idénticos. El número de corridas disponible debe consultarse de nuevo: “3 restantes” es lo que mostraba la captura.

**Salida:** candidato evaluable, fallos accionables y consumo de corridas identificado, con resultados reales diferenciados de las pruebas propias.

### G5 — Entrega y permanencia

1. Confirmar el estado real de los tres campos de la plataforma.
2. Mantener el repo público con las instrucciones mínimas para ejecutar/reproducir el candidato y sin secretos.
3. Entregar/validar la URL del agente en el formato oficial.
4. Grabar un video público de máximo dos minutos que muestre el resultado real y explique el incidente.
5. Comprobar el enlace del video sin depender de una sesión iniciada y el estado validado de la entrega.
6. Mantener host, agente, modelo e ingreso disponibles durante la evaluación y el debrief; evitar cambios de última hora sobre un candidato ya comprobado.

**Salida:** los tres campos aceptados por la plataforma, evidencia y servicio aún operativo. No declarar entrega completa sólo porque los enlaces se escribieron en formularios.

## 9. Evidencia mínima a registrar

| Prueba | Evidencia útil | Criterio de éxito |
| --- | --- | --- |
| Contrato local | Comando/script o reporte sin secretos; payloads de estructura válida y timings. | Métodos, auth, DTOs y límites oficiales. |
| Dependencias | Modelo y runtime efectivos, arranque e inferencia con imagen. | El proceso de servicio puede usarlos realmente. |
| Tarea local | task ID, estado inicial, acciones, observación final y duración. | Resultado solicitado, no sólo cambio de pantalla. |
| FR-0153 | Tema nuevo, bloqueo, recuperación y objetivo final. | Continúa tras el modal y usa controles actuales. |
| HTTPS externo | Base URL, cliente externo, status/timings y task ID público. | Se completa por la ruta que usará el evaluador. |
| Permanencia | Mecanismo de supervisión, periodo de disponibilidad acordado y acceso posterior. | La URL no depende del dashboard abierto ni desaparece al cerrar una shell. |
| Entrega | Commit candidato, campos aceptados, video accesible y cupo de evaluación. | La plataforma reconoce la entrega y puede evaluar el servicio. |

No incluir tokens, contraseñas, imágenes base64 ni URLs firmadas en reportes/commits. Las trazas sanitizadas sirven para correlacionar; no prueban por sí solas la corrección del resultado. Retener evidencia visual de práctica sólo dentro de las reglas del reto y sin credenciales visibles.

## 10. Alcance y disciplina de cambios

- Conservar arquitectura, SDK, DTOs, layout y scripts que ya funcionan. Hacer sólo ajustes necesarios para ejecutar, exponer, medir o corregir un bloqueo real.
- Mantener tipado estricto y convenciones existentes; no añadir `any`, estado duplicado o dependencias por conveniencia marginal.
- Leer las recetas antes de ejecutarlas. `just cycle` históricamente hacía limpieza/preparación del workspace; no usarlo automáticamente si puede borrar lockfiles/caches o perjudicar un entorno candidato. Elegir los checks existentes apropiados.
- No sustituir el pipeline por otro ni modificar configuración de Vite como efecto secundario de publicar el backend.
- No ampliar la UI como condición para probar el servicio. Un dashboard publicado es opcional si el contrato del reto sólo exige la API.
- Posponer tuning de modelo, caché, Laya, nuevos lenguajes y rediseños hasta que haya una entrega funcional o una medición concreta que los haga necesarios.
- Si aparece saturación, limitar/admitir trabajo conforme al contrato y al plazo; no inventar nuevos estados públicos. No serializar silenciosamente tareas cuya espera agote el presupuesto oficial.
- No confundir “publicado”, “salud accesible”, “tarea completada” y “entrega aceptada”: son comprobaciones distintas.

## 11. Qué entregar al finalizar la fase operativa

1. Commit/SHA del candidato desplegado y cambios concretos hechos para operarlo.
2. URL HTTPS del agente y resultado de una tarea completada por ella desde fuera del host.
3. Instrucciones exactas de arranque/parada y configuración no secreta que corresponden al entorno elegido.
4. Reporte breve de tareas reales, timings, FR-0153, fallos y limitaciones pendientes.
5. Plan operativo hasta el debrief: qué procesos/equipo deben seguir activos y dónde consultar logs.
6. Estado de repo, entrypoint, video y corridas de evaluación. Distinguir entregado/validado de pendiente.

Actualizar el contexto del repositorio cuando exista nueva evidencia. El número histórico de tests o los resultados de una captura anterior no deben presentarse como resultados del candidato nuevo.

## 12. Evidencia actual y antecedentes

En el checkout actual:

- TypeScript del servidor y **34/34 tests PASS**, incluidos modal → objetivo, invalidación de coordenadas antiguas, límites de acciones y estados repetidos.
- `just cycle` del cliente **PASS**, con tests, seis trabajos de tipos y builds de ambas apps.
- El runner conserva el objetivo durante varios pasos y usa contexto `next_action`/`verify_completion`; estas pruebas son evidencia de control, no percepción real del tema nuevo.
- La ejecución real del tema nuevo, el clic remoto, la tarea completa y E1 siguen **NOT_RUN**.

Antecedentes reales no repetidos durante FR-0153:

- Login/captura reales de SIGECOM, Ollama 0.40.3, `qwen3-vl:2b`, RTX 4060 y 100% GPU tras inferencia.
- Tres propuestas sobre una misma captura histórica de Comercial, aproximadamente 1.1 s por inferencia caliente; no eran una tarea completa ni una prueba del tema nuevo.

No usar estos antecedentes para volver al punto de partida ni para afirmar adaptación real. El siguiente gate es ejecutar la cadena nueva con referencias independientes y después avanzar hacia despliegue.

## 13. Prompt listo para iniciar la siguiente instancia

```text
Continúa Frontier Reto 2 usando FRONTIER-DEPLOYMENT-CONTEXT.md como handoff.

Partimos de un prototipo funcional y de que las correcciones de
FR-0153-READINESS.md ya están aplicadas y funcionan. No vuelvas a proponer
la arquitectura ni a tratar el antiguo runner de un clic como estado actual
sin revisar el checkout. Lee el contrato oficial y las instrucciones del repo.

El objetivo ahora es poner el agente en una URL HTTPS pública estable,
probar tareas reales mediante ese entrypoint y dejar preparada/verificada
la entrega: repo público, entrypoint y video de máximo dos minutos.
El servicio debe permanecer disponible durante el debrief.

Empieza comprobando el HEAD actual, entorno, evidencia reciente y scripts.
Haz una revisión dirigida de las correcciones y ejecuta los checks relevantes.
Después avanza por G1–G5: dependencias, tarea real local, publicación,
prueba externa, práctica oficial y entrega. Usa el host con GPU que ya
funciona si es viable. No introduzcas nueva infraestructura ni dependencias
sin un bloqueo concreto. Si falta una credencial/recurso indispensable,
prepara todo lo independiente e identifica exactamente el dato pendiente.

La caché/Laya es opcional y no debe bloquear la publicación de la ruta visual.
Preserva el contrato, el SDK, guards, deadline y pipeline existentes.
No uses corridas ocultas para depurar conectividad: comprueba su mecanismo
y cupo antes de una evaluación candidata. Usa primero práctica y pruebas
externas repetibles. Conserva evidencia del resultado real, especialmente
la recuperación del modal y el objetivo final en el tema nuevo.

Entrega trabajo operativo y resultados, no otro plan solamente:
SHA del candidato, URL pública comprobada, pruebas y timings, instrucciones
de operación hasta el debrief y estado de los tres campos de entrega.
Marca con precisión qué está comprobado y qué falta.
```
