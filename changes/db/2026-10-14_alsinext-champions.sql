-- Nombre: Alsinext — AI Champions
-- Fecha: 2026-10-14
-- Dominio: alsinext
-- Descripción: Crea alsinext_champions con los AI Champions de las mesas 1 a 6 de la jornada (nombre y apellido) y una descripción de su fuerte en español e inglés: la temática de su mesa, las herramientas y cómo implementa la IA en su trabajo diario. Solo nombre y descripción (sin número de mesa, ni correo ni otros datos personales). Se insertan con id fijo (1–12) para que aplicarlo dos veces falle en vez de duplicar filas.
-- Archivos afectados: ninguno (solo base de datos; todavía no la usa ninguna ruta).
-- Dependencias y orden de aplicación: aplicar sobre alsina_portal; no depende de otras tablas.
-- Estado: pendiente
-- SQL:
USE alsina_portal;

CREATE TABLE IF NOT EXISTS alsinext_champions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  description_es VARCHAR(500) NOT NULL,
  description_en VARCHAR(500) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO alsinext_champions (id, name, description_es, description_en) VALUES
-- Mesa 1: reuniones, correos, Outlook y gestión documental
(1, 'Lluis Orteu',
 'Su fuerte son las reuniones, los correos, Outlook y la gestión documental, donde implementa la IA en su trabajo diario: pasa transcripciones de comité a actas con acuerdos y responsables, resume hilos de correo largos y prepara la respuesta, y resume contratos con sus riesgos, con Copilot en Teams, Outlook y Word y Claude para documentos largos.',
 'Their strength is meetings, email, Outlook and document management, where they use AI in their daily work: turning committee transcripts into minutes with decisions and owners, summarising long email threads and drafting the reply, and summarising contracts with their risks, using Copilot in Teams, Outlook and Word and Claude for long documents.'),
(2, 'Alba Giancola',
 'Su fuerte son las reuniones, los correos, Outlook y la gestión documental, donde implementa la IA en su trabajo diario: pasa transcripciones de comité a actas con acuerdos y responsables, resume hilos de correo largos y prepara la respuesta, y resume contratos con sus riesgos, con Copilot en Teams, Outlook y Word y Claude para documentos largos.',
 'Their strength is meetings, email, Outlook and document management, where they use AI in their daily work: turning committee transcripts into minutes with decisions and owners, summarising long email threads and drafting the reply, and summarising contracts with their risks, using Copilot in Teams, Outlook and Word and Claude for long documents.'),
-- Mesa 2: informes y presentaciones con datos de varias fuentes (Power BI, Office, Word, Excel)
(3, 'Juan Crespo',
 'Su fuerte son los informes y presentaciones que consolidan datos de varias fuentes, donde implementa la IA en su trabajo diario: convierte dashboards y CSV en tablas consolidadas y presentaciones de seguimiento en plantilla Alsina, comenta desviaciones y verifica las cifras, con Claude (Cowork), Copilot en Excel, Power BI, Office, Word y Excel.',
 'Their strength is reports and presentations that consolidate data from several sources, where they use AI in their daily work: turning dashboards and CSV files into consolidated tables and tracking decks in the Alsina template, commenting on deviations and checking the figures, using Claude (Cowork), Copilot in Excel, Power BI, Office, Word and Excel.'),
(4, 'Francisca Ugarte',
 'Su fuerte son los informes y presentaciones que consolidan datos de varias fuentes, donde implementa la IA en su trabajo diario: convierte dashboards y CSV en tablas consolidadas y presentaciones de seguimiento en plantilla Alsina, comenta desviaciones y verifica las cifras, con Claude (Cowork), Copilot en Excel, Power BI, Office, Word y Excel.',
 'Their strength is reports and presentations that consolidate data from several sources, where they use AI in their daily work: turning dashboards and CSV files into consolidated tables and tracking decks in the Alsina template, commenting on deviations and checking the figures, using Claude (Cowork), Copilot in Excel, Power BI, Office, Word and Excel.'),
-- Mesa 3: proyectos y skills
(5, 'Paco Benavente',
 'Su fuerte son los proyectos y skills, donde implementa la IA en su trabajo diario: convierte una petición que funciona (como el redactor de ofertas o la conciliación) en una herramienta para todo el equipo, con instrucciones, plantilla de salida y ejemplos, y la prueba con casos nuevos antes de compartirla, con los proyectos y skills de Claude.',
 'Their strength is projects and skills, where they use AI in their daily work: turning a prompt that works (such as the quote writer or the reconciliation) into a tool for the whole team, with instructions, an output template and examples, and testing it with new cases before sharing it, using Claude projects and skills.'),
(6, 'Carolina Figueira',
 'Su fuerte son los proyectos y skills, donde implementa la IA en su trabajo diario: convierte una petición que funciona (como el redactor de ofertas o la conciliación) en una herramienta para todo el equipo, con instrucciones, plantilla de salida y ejemplos, y la prueba con casos nuevos antes de compartirla, con los proyectos y skills de Claude.',
 'Their strength is projects and skills, where they use AI in their daily work: turning a prompt that works (such as the quote writer or the reconciliation) into a tool for the whole team, with instructions, an output template and examples, and testing it with new cases before sharing it, using Claude projects and skills.'),
-- Mesa 4: desarrollo de software, HTML y web
(7, 'Raúl Limones',
 'Su fuerte es el desarrollo de software, HTML y web, donde implementa la IA en su trabajo diario: construye en minutos web apps de una página a partir de una especificación, como calculadoras de material por m² o comparadores de sistemas, con Claude Code y los artefactos de Claude.',
 'Their strength is software development, HTML and web, where they use AI in their daily work: building one-page web apps from a specification in minutes, such as material-per-m² calculators or system comparators, using Claude Code and Claude artifacts.'),
(8, 'Jordi Gaya',
 'Su fuerte es el desarrollo de software, HTML y web, donde implementa la IA en su trabajo diario: construye en minutos web apps de una página a partir de una especificación, como calculadoras de material por m² o comparadores de sistemas, con Claude Code y los artefactos de Claude.',
 'Their strength is software development, HTML and web, where they use AI in their daily work: building one-page web apps from a specification in minutes, such as material-per-m² calculators or system comparators, using Claude Code and Claude artifacts.'),
-- Mesa 5: digitalizar y automatizar procesos
(9, 'Jordi Soteras',
 'Su fuerte es digitalizar y automatizar procesos, donde implementa la IA en su trabajo diario: pasa fotos de hojas manuscritas de patio a tablas y encadena pasos como leer una carpeta de albaranes, extraer sus campos, consolidarlos en Excel y generar el aviso, con Claude con imágenes y carpetas (Cowork) y Claude Code.',
 'Their strength is digitising and automating processes, where they use AI in their daily work: turning photos of handwritten yard sheets into tables and chaining steps such as reading a folder of delivery notes, extracting their fields, consolidating them in Excel and generating the alert, using Claude with images and folders (Cowork) and Claude Code.'),
(10, 'Antonio Rodríguez',
 'Su fuerte es digitalizar y automatizar procesos, especialmente con Cowork y archivos, donde implementa la IA en su trabajo diario: pasa fotos de hojas manuscritas de patio a tablas y encadena pasos como leer una carpeta de albaranes, extraer sus campos, consolidarlos en Excel y generar el aviso, con Claude con imágenes y carpetas (Cowork) y Claude Code.',
 'Their strength is digitising and automating processes, especially with Cowork and files, where they use AI in their daily work: turning photos of handwritten yard sheets into tables and chaining steps such as reading a folder of delivery notes, extracting their fields, consolidating them in Excel and generating the alert, using Claude with images and folders (Cowork) and Claude Code.'),
-- Mesa 6: deep research
(11, 'Marc Prades',
 'Su fuerte es la investigación a fondo (deep research) de mercado, competencia, proveedores de productos nuevos y nuevas formas de trabajar, donde implementa la IA en su trabajo diario: prepara informes de competidores por país, busca proveedores con tablas comparativas y programa informes semanales, con Claude con búsqueda web e investigación profunda.',
 'Their strength is deep research into markets, competitors, suppliers for new products and new ways of working, where they use AI in their daily work: preparing competitor reports by country, finding suppliers with comparison tables and scheduling weekly reports, using Claude with web search and deep research.'),
(12, 'Carles Rocamora',
 'Su fuerte es la investigación a fondo (deep research) de mercado, competencia, proveedores de productos nuevos y nuevas formas de trabajar, donde implementa la IA en su trabajo diario: prepara informes de competidores por país, busca proveedores con tablas comparativas y programa informes semanales, con Claude con búsqueda web e investigación profunda.',
 'Their strength is deep research into markets, competitors, suppliers for new products and new ways of working, where they use AI in their daily work: preparing competitor reports by country, finding suppliers with comparison tables and scheduling weekly reports, using Claude with web search and deep research.');
