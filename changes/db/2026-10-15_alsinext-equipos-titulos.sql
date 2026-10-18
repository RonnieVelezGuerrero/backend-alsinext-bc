-- Nombre: Alsinext — título del proyecto de cada equipo
-- Fecha: 2026-10-15
-- Dominio: alsinext
-- Descripción: Crea alsinext_equipos_titulos para la spec 006 del frontend (RF-13f). Una fila por equipo: team_id (el mismo identificador de alsinext_equipos), title_es («Proyecto …») y title_en («Project …»), generados por la IA a partir de las respuestas del equipo (sin nombres ni correos). Como mucho 60 caracteres cada uno. La clave primaria garantiza un solo título por equipo; un título guardado no se cambia. Sin clave foránea: en alsinext_equipos el team_id se repite (una fila por persona). No modifica alsinext_equipos.
-- Archivos afectados: backend/src/modules/alsinext/alsinext.pairTeams.js, backend/src/modules/alsinext/alsinext.routes.js, backend/src/modules/alsinext/alsinext.logic.js
-- Dependencias y orden de aplicación: aplicar sobre alsina_portal después de 2026-10-14_alsinext-equipos.sql.
-- Estado: pendiente
-- SQL:
USE alsina_portal;

CREATE TABLE IF NOT EXISTS alsinext_equipos_titulos (
  team_id INT NOT NULL PRIMARY KEY,
  title_es VARCHAR(60) NOT NULL,
  title_en VARCHAR(60) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
