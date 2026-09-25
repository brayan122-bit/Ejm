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
   corresponde al modelo, falta de autorización de descuento (o firma en papel por verificar), y si es un lote de **carga masiva** por Excel.
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
| 3 (Mixto) | Según cada inscripción individual | Nómina **o** La empresa paga **o** Cofinanciado | 5 % solo sobre las inscripciones de Modelo 2 |

El porcentaje se cambia con la variable `DESCUENTO_MODELO_2`.

En empresas de **Modelo 3 (Mixto)**, el formulario pide la forma de pago inscripción por inscripción.
El servidor aplica el descuento separando las filas según `modelo_aplicado` (1 o 2).

## Roles

| Rol | Qué puede hacer |
|---|---|
| `empresa_usuario` | Ver conciliación, personas activas y solicitudes de **su** empresa; enviar altas y bajas |
| `empresa_admin` | Todo lo de `empresa_usuario`, más gestionar los usuarios de su empresa (crear, activar/rechazar pendientes) |
| `validador` | Revisar y validar solicitudes de todas las empresas, ver y descargar el consolidado, cargar consolidado inicial |
| `maestro` | Todo lo anterior, más crear empresas (dominios, modelo y productos) y gestionar todos los usuarios |

La empresa de cada envío se toma de la sesión en el servidor: ningún usuario de empresa puede ver
ni enviar datos de otra, aunque cambie `empresa_id` en la URL o en el cuerpo de la petición.

## Dominios corporativos de correo

Cada empresa puede tener una lista de dominios corporativos registrados (p. ej. `acme.com.co`).

- **Si la empresa tiene dominios registrados**: solo correos de esos dominios pueden iniciar sesión
  como usuarios de esa empresa. Intentar ingresar con un dominio ajeno devuelve el mismo mensaje
  genérico que una contraseña incorrecta (no se revela el motivo).
- **Si la empresa no tiene dominios registrados**: no se aplica ninguna restricción de dominio;
  cualquier correo válido puede ser usuario de esa empresa.
- Los dominios se configuran en `/admin` → *Empresas* → *Editar* → campo **Dominios corporativos**.
- **Después de migrar** desde una versión anterior: ninguna empresa tiene dominios registrados
  inicialmente, por lo que el acceso funciona igual que antes. El maestro debe registrar los dominios
  de cada empresa cuando corresponda.
- No se admiten dominios públicos (`gmail.com`, `hotmail.com`, etc.) ni puede el mismo dominio
  pertenecer a dos empresas distintas.

## Auto-registro (solicitar acceso)

Un colaborador puede solicitar acceso desde la pantalla de ingreso sin que el maestro cree su cuenta:

1. Hace clic en **¿No tiene cuenta? Solicitar acceso**.
2. Escribe su correo corporativo, nombre completo y una contraseña.
3. El servidor deduce la empresa por el dominio del correo.
4. La respuesta es **siempre genérica**: "Si su empresa está registrada, su solicitud quedará
   pendiente de aprobación." No se revela si la empresa existe ni si el dominio es público.
5. El usuario queda en estado **pendiente** y no puede iniciar sesión hasta ser aprobado.
6. El `empresa_admin` (o el `maestro`) ve los pendientes en el panel y puede aprobarlos o rechazarlos.

## Variables de entorno en Vercel

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Base de datos Neon |
| `SESSION_SECRET` | Sí | Texto aleatorio de **mínimo 32 caracteres** para firmar las sesiones. Si se cambia, todos deben volver a ingresar |
| `ADMIN_EMAIL` | Sí | Correo del maestro principal |
| `ADMIN_PASSWORD` | Sí | Contraseña del maestro principal (mínimo 12 caracteres, con letras y números). Sirve también para recuperar el acceso si se pierde el usuario maestro |
| `DESCUENTO_MODELO_2` | No | Porcentaje de descuento del modelo 2 (por defecto 5) |
| `BLOB_READ_WRITE_TOKEN` | Sí | Token del Vercel Blob Store para guardar PDFs y soportes. Para el Blob Store debes crear el almacén en Vercel, enlazar el proyecto y verificar que la variable BLOB_READ_WRITE_TOKEN esté presente. |

Para generar `SESSION_SECRET` puede usar, por ejemplo, un generador de contraseñas de 40 caracteres.
Las tablas y migraciones se aplican automáticamente la primera vez que el servidor recibe una petición.

## Primera puesta en marcha

1. Configure las variables en Vercel (*Settings → Environment Variables*) y vuelva a desplegar.
2. Ingrese en `/login` con `ADMIN_EMAIL` y `ADMIN_PASSWORD`. El sistema crea el usuario maestro automáticamente si no existe.
3. En **Empresas**, cree cada empresa con su NIT, modelo y productos habilitados.
   - (Opcional) Registre los dominios corporativos de correo para habilitar el control de acceso por dominio y el auto-registro.
4. En **Usuarios**, cree los usuarios de cada empresa con su rol (`empresa_admin` o `empresa_usuario`).
   El sistema muestra una contraseña temporal una sola vez: entréguela por un canal seguro y pida que la cambien (*Cambiar contraseña*).
5. En **Consolidado → Cargar consolidado inicial**, suba el CSV de las personas que ya tienen asistencias
   (hay una plantilla descargable). Un archivo por empresa.

## Migración desde versión anterior

El esquema se migra automáticamente en la primera petición al servidor. Las migraciones:

- **001**: Añade columnas `dominios` (jsonb) y `modelo` 3 (Mixto) a `empresas`; columna `estado_acceso` a `usuarios`.
- **002**: Añade columna `modelo_aplicado` a `solicitudes`.
- **003**: Migra roles viejos: `admin` → `maestro`, `empresa` → `empresa_admin`.
- **004**: Añade `modelo_aplicado` y `origen_tipo` a `solicitudes`; restricción de rol en `usuarios`.
- **005**: Rellena `consolidado.modelo_aplicado` usando el modelo de la empresa (retrocompatibilidad).
- **006**: Crea la tabla `archivos` para soporte y PDFs en Vercel Blob (preparación Etapa 3).

Ninguna migración se aplica dos veces: el sistema lleva un registro en la tabla `schema_migraciones`.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Formulario de alta (con PDF) y de baja por cédula |
| `login.html` | Ingreso y solicitud de acceso (auto-registro) |
| `portal.html` | Portal de la empresa: conciliación, personas activas y solicitudes |
| `admin.html` | Validación, consolidado, empresas y usuarios |
| `app.css`, `app.js` | Estilos y utilidades compartidas de ingreso, portal y administración |
| `api/sesion.js` | Ingreso, salida, cambio de contraseña, datos de sesión y auto-registro |
| `api/inscripcion.js` | Recibe las altas |
| `api/baja.js` | Busca asistencias activas por cédula y recibe las bajas |
| `api/portal.js` | Datos del portal de la empresa |
| `api/admin.js` | Validación, consolidado, importación, empresas, dominios y usuarios |
| `api/_catalogo.js` | Catálogo de productos, modelos, validaciones automáticas y cálculo de conciliación |
| `api/_auth.js`, `api/_db.js` | Sesiones, contraseñas, conexión, migraciones y tablas |
| `tests/aislamiento.js` | Suite auto-contenida de pruebas de aislamiento y regresión (requiere Node ≥ 20) |

## Tablas

`empresas`, `usuarios`, `solicitudes` (altas y bajas, con `periodo` = mes), `consolidado` (activos y retirados),
`archivos` (soporte y PDFs, preparada para Etapa 3) y `schema_migraciones` (historial de migraciones).

Las tablas anteriores `inscripciones` y `bajas` ya no se usan; se conservan por si necesita consultar lo que hubiera.

## Agregar o cambiar planes

El catálogo existe en dos lugares y deben coincidir: `CATALOGO` en `index.html` y `CATALOGO` en `api/_catalogo.js`.
Después de agregar un plan, habilítelo en las empresas que corresponda.
