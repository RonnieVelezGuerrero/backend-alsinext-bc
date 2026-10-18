-- Nombre: Alsinext — compromisos con foto
-- Fecha: 2026-10-12
-- Dominio: alsinext
-- Descripción: Crea alsinext_compromisos para guardar el compromiso con la IA de cada usuario (correo, foto y nombre opcional). La foto se guarda en uploads/alsinext y aquí solo su nombre de archivo. Alsinext es pública (acceso por QR), por eso no se registra en apps ni en role_app_permissions.
-- Archivos afectados: backend/src/routes/index.js, backend/src/modules/alsinext/alsinext.routes.js, backend/.gitignore, backend/uploads/alsinext/.gitkeep
-- Dependencias y orden de aplicación: aplicar sobre alsina_portal; no depende de otras tablas.
-- Estado: pendiente
-- SQL:
USE alsina_portal;

CREATE TABLE IF NOT EXISTS alsinext_compromisos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(160) NULL,
  image_filename VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_alsinext_compromisos_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
