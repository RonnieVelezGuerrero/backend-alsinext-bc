-- Nombre: Alsinext — foto de los AI Champions
-- Fecha: 2026-10-14
-- Dominio: alsinext
-- Descripción: Añade a alsinext_champions la columna photo para la foto de cada champion. Es opcional (NULL) porque las fotos aún no están; el responsable la rellenará directamente en la base de datos. VARCHAR(500) admite tanto un nombre de archivo como una URL.
-- Archivos afectados: ninguno (solo base de datos; todavía no la usa ninguna ruta).
-- Dependencias y orden de aplicación: aplicar sobre alsina_portal después de 2026-10-14_alsinext-champions.sql.
-- Estado: pendiente
-- SQL:
USE alsina_portal;

ALTER TABLE alsinext_champions
  ADD COLUMN photo VARCHAR(500) NULL AFTER name;
