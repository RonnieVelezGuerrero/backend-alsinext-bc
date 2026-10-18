-- Nombre: Alsinext — administrador de la vista de emparejamiento
-- Fecha: 2026-10-14
-- Dominio: alsinext
-- Descripción: Crea alsinext_admin, las cuentas propias de Alsinext (independientes del portal) que protegen la vista de emparejamiento de la spec 006 del frontend. Guarda el usuario (único), solo el hash bcrypt de la contraseña (nunca la contraseña) e is_admin. Las cuentas se crean desde «Crear cuenta» en el Login de la web (o con `npm run alsinext:admin -- <usuario>`) y nacen sin permiso (is_admin = 0); el responsable da el permiso en la base de datos: UPDATE alsinext_admin SET is_admin = 1 WHERE username = '<usuario>';
-- Archivos afectados: backend/src/modules/alsinext/alsinext.access.js, backend/src/modules/alsinext/alsinext.adminCreate.js, backend/src/modules/alsinext/alsinext.routes.js
-- Dependencias y orden de aplicación: aplicar sobre alsina_portal; no depende de otras tablas. Requiere JWT_SECRET propio (≥ 32 caracteres) en el .env del backend.
-- Estado: pendiente
-- SQL:
USE alsina_portal;

CREATE TABLE IF NOT EXISTS alsinext_admin (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_alsinext_admin_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
