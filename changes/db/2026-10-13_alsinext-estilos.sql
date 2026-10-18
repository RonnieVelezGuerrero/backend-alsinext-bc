-- Nombre: Alsinext — estilos de foto (copia con efecto)
-- Fecha: 2026-10-13
-- Dominio: alsinext
-- Descripción: Añade a alsinext_compromisos el nombre de la copia de la foto con efecto (styled_filename) y el estilo sorteado (style: retrofuturista, holograma, vhs, popart o setenta). La copia se guarda en uploads/alsinext; la original se conserva. Los registros anteriores quedan con ambos campos a NULL y se muestran con su foto original.
-- Archivos afectados: backend/src/modules/alsinext/alsinext.routes.js, backend/src/modules/alsinext/alsinext.logic.js
-- Dependencias y orden de aplicación: aplicar sobre alsina_portal después de 2026-10-12_alsinext.sql.
-- Estado: pendiente
-- SQL:
USE alsina_portal;

ALTER TABLE alsinext_compromisos
  ADD COLUMN styled_filename VARCHAR(255) NULL AFTER image_filename,
  ADD COLUMN style VARCHAR(32) NULL AFTER styled_filename;
