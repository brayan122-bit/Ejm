# Altas y bajas Asistencias

Formulario de Enel Bienestar 360 para asesores, publicado en Vercel con base de datos Neon (Postgres).

## Qué hay en el proyecto

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Formulario con dos pestañas: **Nueva inscripción** y **Bajas** |
| `admin.html` | Panel `/admin` (con contraseña) con pestañas **Inscripciones** y **Bajas**, cada una con su propio Excel (CSV) |
| `api/inscripcion.js` | Guarda las inscripciones en la tabla `inscripciones` |
| `api/baja.js` | Guarda las bajas en la tabla `bajas` (separada) |
| `api/admin.js` | Entrega inscripciones y bajas al panel |
| `api/_db.js` | Conexión a Neon y creación automática de tablas |

## Variables de entorno en Vercel

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Base de Neon de las inscripciones (y de las bajas si no se define la siguiente) |
| `ADMIN_PASSWORD` | Sí | Contraseña del panel `/admin` (mínimo 12 caracteres) |
| `BAJAS_DATABASE_URL` | No | Si se define, las bajas se guardan en **otra base de datos** distinta |

Las tablas se crean solas la primera vez que llega un registro.

## Bajas

La pestaña **Bajas** pide: empresa, asesor, titular, documento, asistencia, plan, valor mensual y motivo (opcional).
Asistencia y plan se eligen de listas desplegables que salen del mismo `CATALOGO` del formulario de inscripción,
así que si se agrega un plan nuevo hay que añadirlo también en `api/baja.js` (el servidor rechaza planes que no existan).
