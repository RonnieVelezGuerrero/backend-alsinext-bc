-- Nombre: Alsinext — respuesta sobre el uso de la IA
-- Fecha: 2026-10-14
-- Dominio: alsinext
-- Descripción: Añade a alsinext_compromisos la columna ai_usage con la respuesta a «¿Cómo incorporarías la IA en tu espacio laboral?» (texto libre de 10 a 500 caracteres, spec 005 del frontend). El nombre se guarda en la columna name, que ya existe. Los registros anteriores quedan con ai_usage a NULL. Ni el nombre ni la respuesta salen en la lista pública de fotos.
-- Archivos afectados: backend/src/modules/alsinext/alsinext.routes.js, backend/src/modules/alsinext/alsinext.logic.js
-- Dependencias y orden de aplicación: aplicar sobre alsina_portal después de 2026-10-12_alsinext.sql y 2026-10-13_alsinext-estilos.sql.
-- Estado: pendiente
-- SQL:
USE alsina_portal;

ALTER TABLE alsinext_compromisos
  ADD COLUMN ai_usage VARCHAR(500) NULL AFTER name;
