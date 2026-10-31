# FR-0153 — Preparación ante el cambio de tema

**Actualización:** 31 de octubre de 2026 · **Estado:** ciclo visual de varios pasos implementado y validado con dobles; aceptación real sobre el tema nuevo todavía pendiente.

## Dictamen actual

La limitación principal identificada en la revisión anterior ya fue corregida: el runner ya no termina después de un clic cuando sólo se resolvió un bloqueo intermedio. Ahora conserva el objetivo original, registra progreso, vuelve a observar y puede continuar con otra acción dentro del mismo `task_id`.

Esto cierra el hueco de **control de flujo** para modal → objetivo. **No demuestra todavía que Qwen reconozca las etiquetas nuevas ni que la tarea real complete en producción o en el set oculto.** La ejecución remota sobre el tema nuevo sigue `NOT_RUN`.

El ticket original es `reto-2/incident-ticket.png`. El contrato oficial permanece en `reto-2/README.md`.

## 1. Implementación realizada

### A. Ciclo acotado de varios pasos

`client/apps/r2/server/src/runner.ts` ahora ejecuta este ciclo:

1. Capturar el estado visible actual.
2. Proponer una acción segura para el objetivo original.
3. Recapturar y validar actividad, deadline, frame y geometría antes del input.
4. Ejecutar un solo clic.
5. Capturar el efecto y distinguir cambio visual de cumplimiento.
6. Verificar el objetivo original con una decisión separada del VLM.
7. Terminar con evidencia o continuar desde el nuevo frame si el objetivo sigue pendiente.
8. Limpiar la sesión en `finally`.

Límites globales por tarea:

- Máximo **8 intentos de clic**.
- Máximo **12 iteraciones de planificación**, incluida recuperación por frame viejo.
- El mismo deadline absoluto de cinco minutos, sin reinicios al replanificar.
- Detección de estados de objetivo repetidos para cortar ciclos sin progreso nuevo.

El filtro que exigía instrucciones con prefijo de clic fue eliminado junto con el comportamiento de un solo paso. Los objetivos sólo tienen disponibles las acciones internas `click`, `finish`, `fail`; tareas que requieren escritura u otros inputs deben fallar honestamente si no existe un paso visible seguro.

### B. Planificación y verificación con contexto

`client/apps/r2/server/src/vision.ts` y el runner ahora diferencian dos modos mediante `recentContext`:

- `next_action`: elegir un paso visible seguro, aceptando que posiciones y etiquetas cambien. Un modal benigno puede resolverse como paso intermedio, sin aceptar ofertas ajenas, confirmaciones destructivas ni instrucciones que sustituyan el objetivo.
- `verify_completion`: devolver `finish` sólo si el objetivo original está visible y completo; devolver `fail` si sigue pendiente, incluso cuando se cerró un modal o se hizo otro avance útil.

El objetivo original se envía sin reescribir en todas las llamadas. El historial conserva los últimos cuatro pasos con coordenadas, efecto observado, motivo de pendiente y reconciliación de inputs inciertos.

Un `click` devuelto durante `verify_completion` se rechaza y **nunca se ejecuta**. Cerrar un modal sólo completa una tarea cuyo objetivo original sea cerrar ese modal.

### C. Garantías conservadas

- Recaptura antes de cada input e invalidación por hash distinto.
- Una recuperación por `stale_frame`; las coordenadas antiguas no se aplican a un modal o tema nuevo.
- Coordenadas enteras dentro del PNG fuente y transformación con su geometría.
- Deadline/cancelación antes de cada operación y después de inferencia.
- Ningún reenvío ciego de input incierto; primero se observa y reconcilia.
- `effect.observed` significa pantalla cambiada, no objetivo cumplido.
- `closure.verified` sólo acepta la postcondición original visible.
- `progress.observed` registra avance intermedio con el objetivo todavía pendiente.

No se añadieron coordenadas, etiquetas, selectores ni mapas fijos del tema nuevo. Tampoco se relajó el guard de hash para hacer pasar animaciones o cambios de pantalla.

## 2. Cobertura de regresión agregada

`client/apps/r2/server/test/runner.test.ts` contiene ahora diez pruebas del runner, incluidas:

| Escenario simulado | Resultado comprobado |
| --- | --- |
| Clic directo y postcondición | Completa con un clic y verificación separada |
| Modal inicial → destino original | Dos clics dentro del mismo run; el segundo ocurre tras reobservar y recibir contexto del primero |
| Modal aparece tras la propuesta | Las coordenadas viejas no se ejecutan; sólo se usa la propuesta sobre el frame nuevo |
| Inferencia posterior al deadline | Cero inputs |
| Input incierto sin efecto observable | No se repite el clic |
| `finish` prematuro | No publica éxito |
| Objetivo sin prefijo de clic | Ya no se rechaza por la forma textual de la instrucción |
| `click` durante verificación | Se rechaza y no se ejecuta |
| Regreso a un estado ya observado | Falla por ausencia de progreso nuevo |
| Secuencia indefinida de avances | Se detiene en el límite global de 8 acciones |

Las imágenes de uno o varios bytes en estos dobles representan estados sintéticos. Validan coordinación, guards y continuidad, **no percepción real del tema nuevo**.

## 3. Validación actual

Ejecutado durante la implementación:

```sh
cd client/apps/r2/server
npm run validate

cd client
just cycle
```

Resultados:

- TypeScript del servidor: **PASS**.
- Node tests: **34/34 PASS**.
- Client tests, seis trabajos de tipos, formato/lint y builds de ambas apps: **PASS**.
- `git diff --check`: **PASS**.

Estos resultados son evidencia local de control y build, no evidencia de producción.

## 4. Matriz de aceptación pendiente

| Caso | Control local | Evidencia real todavía requerida |
| --- | --- | --- |
| Tema nuevo sin modal | Arquitectura visual sin coordenadas fijas | Captura nueva, referencia humana independiente, propuesta y efecto real |
| Botón desplazado | Guard de frame/geometría y nueva propuesta | Verificar que el modelo elija la región nueva, no la histórica |
| Etiqueta nueva | Objetivo y contexto se pasan al VLM | Equivalencias semánticas, controles parecidos y abstenciones correctas |
| Modal inicial | Ciclo de varios pasos PASS con dobles | Cerrar modal real y completar la postcondición original en el mismo task ID |
| Modal tras propuesta | Frame anterior rechazado PASS con dobles | Confirmar el comportamiento con repaint/remoto real |
| Destino ausente | `fail` y límites sin inventar acciones | Abstención correcta y resumen con causa |
| Deadline en recuperación | Guards y cancelación conservados | Cero inputs posteriores al cierre en una ejecución controlada |
| Tema anterior | Clic directo conservado con dobles | Repetir regresión real conocida |

El rectángulo histórico `[180,68)-[315,123)` de `validate-vision.ts` pertenece a la captura anterior. Para el tema nuevo se necesita una referencia independiente nueva. No se debe ensanchar la región antigua ni usar la predicción del propio modelo como verdad.

## 5. Siguiente ejecución real

La aceptación FR-0153 debe mostrar, mediante la API pública y el mismo `task_id`:

1. Nueva captura del tema y su modal inicial.
2. Propuesta y guard para cerrar el modal benigno.
3. `progress.observed`, no éxito, después del primer clic.
4. Nueva captura y nueva propuesta sobre la interfaz ya desbloqueada.
5. Selección del control Comercial en su posición/etiqueta actual.
6. Menú visible y verificación de la postcondición original.
7. Estado terminal, cleanup, traza autenticada y evidencia before/after.

Registrar por caso: task ID, referencia independiente, pasos, propuestas rechazadas, modelo, duración, resultado observado y causa de fallo. Separar explícitamente resultados simulados, percepción sobre capturas y ejecución remota real.

## 6. Video, debrief y optimización posterior

La afirmación aceptable sólo después de esa evidencia será:

> “El agente volvió a observar la interfaz nueva, resolvió el bloqueo visible como progreso intermedio y eligió las siguientes acciones desde la pantalla actual; comprobamos el resultado final”.

Por ahora la afirmación correcta es:

> “Implementamos y probamos localmente el ciclo que permite continuar después de un modal sin reutilizar coordenadas antiguas; la validación real del tema nuevo sigue pendiente”.

La ruta visual permanece sin caché. No integrar Laya ni reutilizar mapas de controles antes de medir esta ruta. Cualquier caché futura debe invalidarse por tema, etiqueta, posición, sesión, geometría y modal, y volver siempre a visión ante duda.
