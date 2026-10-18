-- Nombre: Alsinext — equipos con los AI Champions
-- Fecha: 2026-10-14
-- Dominio: alsinext
-- Descripción: Crea alsinext_equipos para el emparejamiento de la spec 006 del frontend. Una fila por participante: team_id (identificador del equipo, 1, 2, 3… en orden de presentación), champion_id (el champion del equipo) y email (correo del participante, normalizado). El correo es único: cada persona está en un solo equipo. Los champions no tienen correo; de ellos solo se guarda champion_id. Los equipos son de 2 personas, o de 3 cuando el número de participantes es impar.
-- Archivos afectados: backend/src/modules/alsinext/alsinext.pairTeams.js, backend/src/modules/alsinext/alsinext.demo.js, backend/src/modules/alsinext/alsinext.routes.js
-- Dependencias y orden de aplicación: aplicar sobre alsina_portal después de 2026-10-14_alsinext-champions.sql (clave foránea a alsinext_champions).
-- Estado: pendiente
-- SQL:
USE alsina_portal;

CREATE TABLE IF NOT EXISTS alsinext_equipos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  team_id INT NOT NULL,
  champion_id INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_alsinext_equipos_email (email),
  KEY idx_alsinext_equipos_team (team_id),
  CONSTRAINT fk_alsinext_equipos_champion
    FOREIGN KEY (champion_id) REFERENCES alsinext_champions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
