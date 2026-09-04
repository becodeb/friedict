-- ============================================================================
-- friedict — el paso destructivo: se van las columnas de quórum por
-- predicción
-- ----------------------------------------------------------------------------
-- ¡ATENCIÓN, DESPLIEGUE! Sacá un backup de la base ANTES de que este archivo
-- corra contra producción. Es el único artefacto que puede devolver
-- `qualification_percent` / `close_percent` / `minimum_participants` después
-- de esto — ver deploy/README.md § Mantenimiento y proposal.md § Rollback Plan.
--
-- Para cuando este archivo corre, nada en SQL, en el servidor ni en el
-- cliente lee ya estas tres columnas: 700_/705_/710_ movieron toda la lógica
-- a `groups.close_request_quorum` / `qualification_enabled` /
-- `qualification_percent`, y 710_ ya promovió cada fila 'proposed'
-- preexistente a 'active'. Se van, en un archivo aparte, sólo ellas:
--
--   - predictions.qualification_percent — reemplazada por
--     groups.qualification_percent.
--   - predictions.close_percent — reemplazada por groups.close_request_quorum
--     (de porcentaje a quórum absoluto).
--   - predictions.minimum_participants — llevaba desde 100_schema.sql sin
--     lectores desde 600_quorum_and_open_close.sql; nunca se le encontró
--     una razón para seguir viva.
--
-- Lo que NO se toca: qualification_deadline se queda (nullable desde 700_,
-- como rastro de auditoría de filas anteriores) y close_request_count
-- también (sigue siendo el contador vivo de pedidos de cierre de CADA
-- predicción, ortogonal al quórum que ahora vive en el grupo).
-- ============================================================================
alter table public.predictions
  drop column qualification_percent,
  drop column close_percent,
  drop column minimum_participants;
