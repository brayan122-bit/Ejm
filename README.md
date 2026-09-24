# Asistencias Bienestar 360 · Altas, bajas y conciliación

Plataforma para convenios corporativos, publicada en Vercel con base de datos Neon (Postgres).
Las empresas inscriben (altas) y retiran (bajas) colaboradores; el equipo de validación revisa cada
solicitud; la base de conciliación (consolidado) se actualiza sola y se descarga para el CRM.

## Flujo

1. **La empresa ingresa** (`/login`) y llega a su portal (`/portal`). Solo ve la información de su empresa.
2. **Diligencia el formulario** de alta (`/`) o de baja (pestaña *Bajas*: se busca por cédula y se eligen las asistencias a cancelar).
3. Cada envío queda como **solicitud pendiente** del mes.
4. **El equipo de validación** (`/admin`) revisa las solicitudes del mes. El sistema marca alertas automáticas:
   duplicados, personas ya activas, productos no habilitados, campos vacíos, fechas inválidas, forma de pago que no
   corresponde al modelo y falta de autorización de descuento (o firma en papel por verificar).
5. El validador marca cada registro como **válido** o **inválido** (con motivo).
   - Alta válida → entra al consolidado. Baja válida → sale del consolidado.
   - Si se revierte una validación, el consolidado vuelve a como estaba.
6. La empresa ve en su portal los **inválidos del mes** con el motivo, corrige y reenvía el formulario.
   El registro aparece como *Reenviada* cuando llega la corrección.
7. El consolidado corregido se descarga desde `/admin` → *Consolidado* → **Descargar para CRM (CSV)**.

Todo se filtra por **mes** (hora de Colombia). No se borra nada: el selector de mes muestra el actual por defecto
y permite consultar meses anteriores.

## Modelos de pago

| Modelo | Quién paga | Formas de pago permitidas en el formulario | Descuento |
|---|---|---|---|
| 1 | El colaborador, por nómina | Nómina | No |
| 2 | La empresa paga todo o cofinancia | La empresa paga · Cofinanciado | 5 % sobre el valor mensual total |

El porcentaje se cambia con la variable `DESCUENTO_MODELO_2`.

## Roles

| Rol | Qué puede hacer |
|---|---|
| Empresa | Ver su conciliación, sus personas activas y sus solicitudes; enviar altas y bajas de **su** empresa |
| Validador | Revisar y validar solicitudes de todas las empresas, ver y descargar el consolidado, cargar el consolidado inicial |
| Administrador | Todo lo anterior, más crear empresas (modelo y productos habilitados) y usuarios |

La empresa de cada envío se toma de la sesión en el servidor: un usuario de empresa no puede ver ni enviar datos de otra.

## Variables de entorno en Vercel

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Base de datos Neon |
| `SESSION_SECRET` | Sí | Texto aleatorio de **mínimo 32 caracteres** para firmar las sesiones. Si se cambia, todos deben volver a ingresar |
| `ADMIN_EMAIL` | Sí | Correo del administrador principal |
| `ADMIN_PASSWORD` | Sí | Contraseña del administrador principal (mínimo 12 caracteres). Sirve también para recuperar el acceso |
| `DESCUENTO_MODELO_2` | No | Porcentaje de descuento del modelo 2 (por defecto 5) |

Para generar `SESSION_SECRET` puede usar, por ejemplo, un generador de contraseñas de 40 caracteres.
Las tablas se crean solas la primera vez.

## Primera puesta en marcha

1. Configure las variables en Vercel (*Settings → Environment Variables*) y vuelva a desplegar.
2. Ingrese en `/login` con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
3. En **Empresas**, cree cada empresa con su NIT, modelo y productos habilitados.
4. En **Usuarios**, cree el usuario de cada empresa. El sistema muestra una contraseña temporal una sola vez:
   entréguela por un canal seguro y pida que la cambien (*Cambiar contraseña*).
5. En **Consolidado → Cargar consolidado inicial**, suba el CSV de las personas que ya tienen asistencias
   (hay una plantilla descargable). Un archivo por empresa.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Formulario de alta (con PDF) y de baja por cédula |
| `login.html` | Ingreso |
| `portal.html` | Portal de la empresa: conciliación, personas activas y solicitudes del mes |
| `admin.html` | Validación, consolidado, empresas y usuarios |
| `app.css`, `app.js` | Estilos y utilidades compartidas de ingreso, portal y administración |
| `api/sesion.js` | Ingreso, salida, cambio de contraseña y datos de la sesión |
| `api/inscripcion.js` | Recibe las altas |
| `api/baja.js` | Busca asistencias activas por cédula y recibe las bajas |
| `api/portal.js` | Datos del portal de la empresa |
| `api/admin.js` | Validación, consolidado, importación, empresas y usuarios |
| `api/_catalogo.js` | Catálogo de productos, modelos, validaciones automáticas y cálculo de conciliación |
| `api/_auth.js`, `api/_db.js` | Sesiones, contraseñas, conexión y tablas |

## Tablas

`empresas`, `usuarios`, `solicitudes` (altas y bajas, con `periodo` = mes) y `consolidado` (activos y retirados).
Las tablas anteriores `inscripciones` y `bajas` ya no se usan; se conservan por si necesita consultar lo que hubiera.

## Agregar o cambiar planes

El catálogo existe en dos lugares y deben coincidir: `CATALOGO` en `index.html` y `CATALOGO` en `api/_catalogo.js`.
Después de agregar un plan, habilítelo en las empresas que corresponda.
