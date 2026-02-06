import { pool } from '../db.js';
import bcrypt from "bcrypt";
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import PdfPrinter from 'pdfmake';
import fs from 'fs';
import path from 'path';

// Obtener tipos de documento
export const getTipoDocumentos = async (req, res) => {
    try {
        const result = await pool.query('SELECT "TMA_CODDOC", "TMA_NOMBRE" FROM "BDTMA_TIDO" ORDER BY "TMA_NOMBRE" ASC');
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al obtener los tipos de documentos" });
    }
};


export const checkExistence = async (req, res) => {
  try {
    const rawTipo = String(req.query.tipo || '').trim();
    const tipo = rawTipo.toUpperCase();
    const documento = String(req.query.documento || '').trim();
    if (!documento) return res.status(400).json({ exists: false, mensaje: 'Documento requerido' });

    // Detectar pasaporte (lado cliente puede enviar 'P' o '3')
    const isPassport = tipo === 'P' || tipo === '3' || tipo === '03';

    // Validación básica según tipo (si se proporcionó tipo)
    if (rawTipo) {
      if (isPassport) {
        if (!/^[A-Za-z0-9\-]{1,20}$/.test(documento)) {
          return res.status(400).json({ exists: false, mensaje: 'Formato de pasaporte inválido' });
        }
      } else {
        if (!/^\d{7,9}$/.test(documento)) {
          return res.status(400).json({ exists: false, mensaje: 'Documento inválido (solo dígitos, 7-9)' });
        }
      }
    } else {
      // Si no hay tipo, validar al menos formato dígitos largo típico o alfanumérico corto
      if (!/^[A-Za-z0-9\-]{1,20}$/.test(documento) && !/^\d{7,9}$/.test(documento)) {
        return res.status(400).json({ exists: false, mensaje: 'Documento con formato inválido' });
      }
    }

    // Si se envió tipo, buscar coincidencia exacta en número + tipo.
    // Para cubrir variantes (por ejemplo cliente envia '3' y DB guarda 'P'), generamos opciones.
    let result;
    if (rawTipo) {
      const tipoOpciones = [tipo];
      if (tipo === '3' || tipo === '03') tipoOpciones.push('P');
      if (tipo === 'P') tipoOpciones.push('3');
      const uniqTipos = Array.from(new Set(tipoOpciones)).map(String);

      // Important: casteamos el campo TMA_TIPODO a text para evitar errores de comparación entre integer/text
      const q = `SELECT "TMA_CEDULA","TMA_TIPODO","TMA_USUARI","TMA_CORREO"
                 FROM "BDTMA_USUA"
                 WHERE "TMA_CEDULA" = $1
                   AND "TMA_TIPODO"::text = ANY($2::text[])
                 LIMIT 1`;
      result = await pool.query(q, [documento, uniqTipos]);
    } else {
      // si no hay tipo, buscar cualquier registro con ese número
      const q = `SELECT "TMA_CEDULA","TMA_TIPODO","TMA_USUARI","TMA_CORREO"
                 FROM "BDTMA_USUA"
                 WHERE "TMA_CEDULA" = $1
                 LIMIT 1`;
      result = await pool.query(q, [documento]);
    }

    if (result.rows.length > 0) {
      return res.status(200).json({ exists: true, mensaje: 'Registro existente', dato: result.rows[0] });
    }
    return res.status(200).json({ exists: false, mensaje: 'No existe' });
  } catch (error) {
    console.error('checkExistence error:', error);
    return res.status(500).json({ exists: false, mensaje: 'Error al verificar existencia' });
  }
};
// ...existing code...

// Crear usuario// ...existing code...
export const createUser = async (req, res) => {
  try {
    const data = req.body || {};

    // Normalizar / trim
    const cedula = String(data.cedula || '').trim();
    const nombres = String(data.nombres || '').trim();
    const apellidos = data.apellidos ? String(data.apellidos).trim() : null;
    const direccion = data.direccion ? String(data.direccion).trim() : null;
    const telefono = data.telefono ? String(data.telefono).trim() : null;
    const sexo = data.sexo || null;
    const fecha_nac = data.fecha_nac || null;
    const usuario = String(data.usuario || '').trim();
    const contraseña = String(data.contraseña || '');
    const email = String((data.email || '').toLowerCase()).trim();
    const codcom = data.codcom || null;
    const tipodo = data.tipodo || null;
    const rol = data.rol || 'usuario';

    const errors = [];

    // Regex helpers
    const nameRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s'\-]+$/;
    const digitsRegex = /^\d+$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const tipodoNorm = String(tipodo || '').toUpperCase();

    // Validaciones para documento según tipo
    if (!cedula) {
      errors.push('Documento es obligatorio');
    } else {
      if (tipodoNorm === 'P') {
        // Pasaporte: permitir alfanumérico y guion, longitud razonable
        if (!/^[A-Za-z0-9\-]{3,7}$/.test(cedula)) {
          errors.push('Pasaporte inválido (3-20 caracteres, letras, números o guión)');
        }
      } else if (tipodoNorm === 'V' || tipodoNorm === 'E' ) {
        // Otros: solo dígitos 7-9
        if (!/^\d{7,9}$/.test(cedula)) {
          errors.push('Documento inválido (solo dígitos, 7-9 caracteres)');
        }
      }
    }

    // Validaciones resto de campos
    if (!nombres) errors.push('Nombres son obligatorios');
    else if (!nameRegex.test(nombres)) errors.push('Nombres inválidos (solo letras, espacios, - y \')');

    if (apellidos && !nameRegex.test(apellidos)) errors.push('Apellidos inválidos (solo letras, espacios, - y \')');

    if (!usuario) errors.push('Usuario es obligatorio');

    if (!email) errors.push('Correo es obligatorio');
    else if (!emailRegex.test(email)) errors.push('Correo inválido');

    if (!contraseña) errors.push('Contraseña es obligatoria');
    else if (contraseña.length < 6) errors.push('Contraseña debe tener al menos 6 caracteres');

    if (telefono && !digitsRegex.test(telefono)) errors.push('Teléfono inválido (solo dígitos)');

    if (fecha_nac) {
      const f = new Date(fecha_nac);
      const hoy = new Date();
      hoy.setHours(0,0,0,0);
      f.setHours(0,0,0,0);
      if (isNaN(f.getTime())) errors.push('Fecha de nacimiento inválida');
      else if (f > hoy) errors.push('Fecha de nacimiento no puede ser mayor a la fecha actual');
    }

    if (errors.length > 0) {
      return res.status(400).json({ codigo: 'VALIDATION_ERROR', errores: errors });
    }

    // Pre-check en BD para documento, usuario o correo existentes
    const conflict = await pool.query(
      `SELECT "TMA_CEDULA", "TMA_USUARI", "TMA_CORREO" FROM "BDTMA_USUA"
       WHERE "TMA_CEDULA" = $1 OR "TMA_USUARI" = $2 OR LOWER("TMA_CORREO") = LOWER($3) LIMIT 1`,
      [cedula, usuario, email]
    );
    if (conflict.rows.length > 0) {
      const row = conflict.rows[0];
      const detalles = [];
      if (row.TMA_CEDULA && String(row.TMA_CEDULA) === cedula) detalles.push('Documento ya registrado');
      if (row.TMA_USUARI && String(row.TMA_USUARI) === usuario) detalles.push('Usuario ya existe');
      if (row.TMA_CORREO && String(row.TMA_CORREO).toLowerCase() === email) detalles.push('Correo ya registrado');
      return res.status(409).json({ codigo: 'CONFLICT', mensaje: 'Conflicto de datos', detalles });
    }

    // Hash y creación
    const saltRounds = 10;
    const hash = await bcrypt.hash(contraseña, saltRounds);

    const result = await pool.query(
      `INSERT INTO "BDTMA_USUA" (
          "TMA_CEDULA", "TMA_NOMBRE", "TMA_APELLI", "TMA_DIRECC", "TMA_TELEFO", "TMA_SEXOTP", "TMA_FENACI",
          "TMA_USUARI", "TMA_CONTRA", "TMA_CORREO", "TMA_ROLE", "TMA_CODCOM", "TMA_TIPODO"
       ) VALUES (
          $1, INITCAP($2), INITCAP($3), INITCAP($4), $5, $6, $7, $8, $9, $10, $11, $12, $13
       ) RETURNING "TMA_CEDULA", "TMA_NOMBRE", "TMA_APELLI", "TMA_DIRECC", "TMA_TELEFO", "TMA_USUARI", "TMA_CORREO", "TMA_ROLE"`,
      [
        cedula,
        nombres,
        apellidos,
        direccion,
        telefono,
        sexo,
        fecha_nac,
        usuario,
        hash,
        email,
        rol,
        codcom,
        tipodo
      ]
    );

    return res.status(201).json({ mensaje: 'Usuario creado', usuario: result.rows[0] });
  } catch (error) {
    // Postgres unique violation
    if (error && error.code === '23505') {
      return res.status(409).json({ codigo: 'CONFLICT', mensaje: 'Valor duplicado en la base de datos', detalle: error.detail || null });
    }
    console.error("Error en createUser:", error);
    return res.status(500).json({ codigo: 'INTERNAL_ERROR', message: "Error al crear el usuario" });
  }
};


// Validar usuario (login)
export const validarUsuario = async (req, res) => {
    try {
        const { usuario, contraseña } = req.body;

        const result = await pool.query(
            'SELECT * FROM "BDTMA_USUA" WHERE "TMA_USUARI" = $1',
            [usuario]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }

        const usuarioDB = result.rows[0];

        // Validar la contraseña usando bcrypt
        const passwordCorrecta = await bcrypt.compare(contraseña, usuarioDB.TMA_CONTRA);

        if (!passwordCorrecta) {
            return res.status(401).json({ mensaje: "Contraseña incorrecta" });
        }

        // Si todo está bien, responde con éxito y el rol
        res.json({ 
            mensaje: "Inicio de sesión exitoso", 
            usuario: usuarioDB.TMA_USUARI, 
            rol: usuarioDB.TMA_ROLE 
        });

    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ mensaje: "Error interno del servidor" });
    }
};

// Obtener comunidades
export const getComunidades = async (req, res) => {
    try {
        const result = await pool.query('SELECT "TMA_CODCOM", "TMA_NOMBRE" FROM "BDTMA_COMU" ORDER BY "TMA_NOMBRE" ASC');
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al obtener las comunidades" });
    }
};






// Registrar noticia
export const crearNoticia = async (req, res) => {
    try {
        const { titulo, descripcion, fuente, codesa, imagen } = req.body;

        // Validación básica
        if (!titulo || !descripcion || !fuente || !codesa) {
            return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
        }

        let imagenBuffer = null;
        if (imagen) {
            imagenBuffer = Buffer.from(imagen, 'base64');
        }

        // Log para depuración
        console.log({ titulo, descripcion, fuente, codesa, imagen: imagen ? '[imagen recibida]' : null });

        const result = await pool.query(
            `INSERT INTO "BDTTR_NOTI" (
                "TTR_TITULO", "TTR_DESCRI", "TTR_FEPUBL", "TTR_FUENTE", "TTR_CODESA", "TTR_IMAGEN"
            ) VALUES (UPPER($1), $2, NOW(), $3, $4, $5) RETURNING *`,
            [titulo, descripcion, fuente, codesa, imagenBuffer]
        );

        return res.status(201).json({ mensaje: "Noticia publicada", noticia: result.rows[0] });
    } catch (error) {
        console.error("Error al registrar la noticia:", error);
        if (error.detail) console.error("Detalle:", error.detail);
        if (error.hint) console.error("Hint:", error.hint);
        return res.status(500).json({ mensaje: "Error al registrar la noticia", error: error.message });
    }
};

// Obtener todas las noticias (para mostrar en el blog)
export const obtenerNoticias = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT "TTR_CONOTI", "TTR_TITULO", "TTR_DESCRI", "TTR_FEPUBL", "TTR_FUENTE", "TTR_CODESA", 
            encode("TTR_IMAGEN", 'base64') as imagen
            FROM "BDTTR_NOTI"
            ORDER BY "TTR_CONOTI" DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error al obtener las noticias" });
    }
};

// desastres
export const getDesastres = async (req, res) => {
    try {
        const result = await pool.query('SELECT "TMA_CODESA", "TMA_NOMBRE" FROM "BDTMA_DESA" ORDER BY "TMA_NOMBRE" ASC');
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al obtener los desastres" });
    }
};

// Obtener todas las comunidades
export const getComunidad = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM "BDTMA_COMU" ORDER BY "TMA_CODCOM" ASC');
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al obtener las comunidades" });
    }
};

// Obtener todas las parroquias (para el select)
export const getParroquias = async (req, res) => {
    try {
        const result = await pool.query('SELECT "TMA_COPARR", "TMA_NOMBRE" FROM "BDTMA_PARR" ORDER BY "TMA_NOMBRE" ASC');
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al obtener las parroquias" });
    }
};

// Crear comunidad
export const crearComunidad = async (req, res) => {
    try {
        const { nombre, direccion, habita, coparr, latitud, longitud } = req.body;
        if (!nombre || !direccion || !habita || !coparr) {
            return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
        }
        const result = await pool.query(
            `INSERT INTO "BDTMA_COMU" (
                "TMA_NOMBRE", "TMA_DIRECC", "TMA_HABITA", "TMA_COPARR", "TMA_LATITU", "TMA_LONGIT"
            ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [nombre, direccion, habita, coparr, latitud, longitud]
        );
        res.status(201).json({ mensaje: "Comunidad creada", comunidad: result.rows[0] });
    } catch (error) {
        console.error("Error al crear comunidad:", error);
        res.status(500).json({ mensaje: "Error al crear comunidad", error: error.message });
    }
};

// Editar comunidad
export const editarComunidad = async (req, res) => {
    try {
        const { codcom } = req.params;
        const { nombre, direccion, habita, coparr, latitud, longitud } = req.body;
        const result = await pool.query(
            `UPDATE "BDTMA_COMU"
            SET "TMA_NOMBRE"=$1, "TMA_DIRECC"=$2, "TMA_HABITA"=$3, "TMA_COPARR"=$4, "TMA_LATITU"=$5, "TMA_LONGIT"=$6
            WHERE "TMA_CODCOM"=$7 RETURNING *`,
            [nombre, direccion, habita, coparr, latitud, longitud, codcom]
        );
        if (result.rowCount === 0) return res.status(404).json({ mensaje: "Comunidad no encontrada" });
        res.json({ mensaje: "Comunidad actualizada", comunidad: result.rows[0] });
    } catch (error) {
        console.error("Error al editar comunidad:", error);
        res.status(500).json({ mensaje: "Error al editar comunidad", error: error.message });
    }
};

// Eliminar comunidad
export const eliminarComunidad = async (req, res) => {
    try {
        const { codcom } = req.params;
        const result = await pool.query(
            `DELETE FROM "BDTMA_COMU" WHERE "TMA_CODCOM"=$1 RETURNING *`,
            [codcom]
        );
        if (result.rowCount === 0) return res.status(404).json({ mensaje: "Comunidad no encontrada" });
        res.json({ mensaje: "Comunidad eliminada" });
    } catch (error) {
        console.error("Error al eliminar comunidad:", error);
        res.status(500).json({ mensaje: "Error al eliminar comunidad", error: error.message });
    }
};

// Registrar afectación
export const crearAfectacion = async (req, res) => {
    try {
        const { codcom, feafec, codesa } = req.body;
        if (!codcom || !feafec || !codesa) {
            return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
        }
        const result = await pool.query(
            `INSERT INTO "BDTTR_AFEC" ("TTR_CODCOM", "TTR_FEAFEC", "TTR_CODESA")
             VALUES ($1, $2, $3) RETURNING *`,
            [codcom, feafec, codesa]
        );
        res.status(201).json({ mensaje: "Afectación registrada", afectacion: result.rows[0] });
    } catch (error) {
        console.error("Error al registrar afectación:", error);
        res.status(500).json({ mensaje: "Error al registrar afectación", error: error.message });
    }
};

// Obtener comunidades para el select
export const getComunidadesNombres = async (req, res) => {
    try {
        const result = await pool.query('SELECT "TMA_CODCOM", "TMA_NOMBRE" FROM "BDTMA_COMU" ORDER BY "TMA_NOMBRE" ASC');
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al obtener las comunidades" });
    }
};


// Obtener desastres para el select
export const getDesastresNombres = async (req, res) => {
    try {
        const result = await pool.query('SELECT "TMA_CODESA", "TMA_NOMBRE" FROM "BDTMA_DESA" ORDER BY "TMA_NOMBRE" ASC');
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al obtener los desastres" });
    }
};

//// damnificados y victimas ///

// Listar comunidades afectadas (afectaciones) para el select
export const getAfectaciones = async (req, res) => {
    try {
        // Puedes traer más datos si lo necesitas (ejemplo: nombre de la comunidad)
        const result = await pool.query(`
            SELECT a."TTR_COAFEC", c."TMA_NOMBRE" AS comunidad, a."TTR_FEAFEC"
            FROM "BDTTR_AFEC" a
            JOIN "BDTMA_COMU" c ON a."TTR_CODCOM" = c."TMA_CODCOM"
            ORDER BY a."TTR_FEAFEC" DESC
        `);
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al obtener las comunidades afectadas" });
    }
};


// Registrar damnificado
// Registrar damnificado (con tipo de documento y apellido)
export const crearDamnificado = async (req, res) => {
    try {
        const { nombre, apelli, fenaci, contac, coafec, esalud, cedula, tipodo } = req.body;
        if (!nombre || !apelli || !fenaci || !contac || !coafec || !esalud || !tipodo) {
            return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
        }

  // Validar que la cédula no esté en víctimas
        if (cedula) {
            const victima = await pool.query(
                `SELECT 1 FROM "BDTTR_VICT" WHERE "TTR_CEDULA" = $1 LIMIT 1`,
                [cedula]
            );
            if (victima.rows.length > 0) {
                return res.status(400).json({ mensaje: "No se puede registrar como damnificado: la cédula pertenece a una víctima." });
            }

        // Validar que no exista ya como damnificado en la misma afectación
            const damnificado = await pool.query(
                `SELECT 1 FROM "BDTTR_DAMN" WHERE "TTR_CEDULA" = $1 AND "TTR_COAFEC" = $2 LIMIT 1`,
                [cedula, coafec]
            );
            if (damnificado.rows.length > 0) {
                return res.status(400).json({ mensaje: "Ya existe un damnificado con esa cédula en esta afectación." });
            }
            
            
        }

        const result = await pool.query(
            `INSERT INTO "BDTTR_DAMN" (
                "TTR_NOMBRE", "TTR_APELLI", "TTR_FENACI", "TTR_CONTAC", "TTR_COAFEC", "TTR_ESALUD", "TTR_CEDULA", "TTR_TIPODO"
            ) VALUES (INITCAP($1), INITCAP($2), $3, $4, $5, INITCAP($6), $7, $8) RETURNING *`,
            [nombre, apelli, fenaci, contac, coafec, esalud, cedula, tipodo]
        );
        res.status(201).json({ mensaje: "Damnificado registrado", damnificado: result.rows[0] });
    } catch (error) {
        console.error("Error al registrar damnificado:", error);
        res.status(500).json({ mensaje: "Error al registrar damnificado", error: error.message });
    }
};

// Registrar víctima (con apellido)
// ...existing code...
export const crearVictima = async (req, res) => {
    try {
        const { cedula, tipodo, nombre, apelli, coafec } = req.body;
        if (!cedula || tipodo === undefined || tipodo === null || !nombre || !apelli || !coafec) {
            return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
        }

        // Asegurar que tipodo sea entero (la columna es integer)
        const tipodoInt = Number.isInteger(Number(tipodo)) ? parseInt(tipodo, 10) : null;
        if (tipodoInt === null) {
            return res.status(400).json({ mensaje: "Tipo de documento inválido (debe ser numérico)" });
        }

        // Validar que no exista ya como víctima en la misma afectación
        const victima = await pool.query(
            `SELECT 1 FROM "BDTTR_VICT" WHERE "TTR_CEDULA" = $1 AND "TTR_COAFEC" = $2 LIMIT 1`,
            [cedula, coafec]
        );
        if (victima.rows.length > 0) {
            return res.status(400).json({ mensaje: "Ya existe una víctima con ese n° de documento en esta afectación." });
        }

        const result = await pool.query(
            `INSERT INTO "BDTTR_VICT" (
                "TTR_CEDULA", "TTR_TIPODO", "TTR_NOMBRE", "TTR_APELLI", "TTR_COAFEC"
            ) VALUES ($1, $2, INITCAP($3), INITCAP($4), $5) RETURNING *`,
            [cedula, tipodoInt, nombre, apelli, coafec]
        );
        res.status(201).json({ mensaje: "Víctima registrada", victima: result.rows[0] });
    } catch (error) {
        console.error("Error al registrar víctima:", error);
        res.status(500).json({ mensaje: "Error al registrar víctima", error: error.message });
    }
};

export const listarDamnificados = async (req, res) => {
    try {
        const { page = 1, search = "" } = req.query;
        const limit = 10;
        const offset = (page - 1) * limit;
        const searchQuery = `%${search}%`;

        // Total count
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM "BDTTR_DAMN" WHERE "TTR_NOMBRE" ILIKE $1 OR "TTR_APELLI" ILIKE $1 OR "TTR_CEDULA" ILIKE $1`,
            [searchQuery]
        );
        const total = parseInt(countResult.rows[0].count);

        // Data
        const result = await pool.query(
            `SELECT * FROM "BDTTR_DAMN"
             WHERE "TTR_NOMBRE" ILIKE $1 OR "TTR_APELLI" ILIKE $1 OR "TTR_CEDULA" ILIKE $1
             ORDER BY "TTR_CODAMN" DESC
             LIMIT $2 OFFSET $3`,
            [searchQuery, limit, offset]
        );
        res.json({ data: result.rows, total });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al listar damnificados" });
    }
};

// Editar damnificado
export const editarDamnificado = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, apelli, fenaci, contac, coafec, esalud, cedula, tipodo } = req.body;
        const result = await pool.query(
            `UPDATE "BDTTR_DAMN"
             SET "TTR_NOMBRE"=INITCAP($1), "TTR_APELLI"=INITCAP($2), "TTR_FENACI"=$3, "TTR_CONTAC"=$4, "TTR_COAFEC"=$5, "TTR_ESALUD"=$6, "TTR_CEDULA"=$7, "TTR_TIPODO"=$8
             WHERE "TTR_CODAMN"=$9 RETURNING *`,
            [nombre, apelli, fenaci, contac, coafec, esalud, cedula, tipodo, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ message: "No encontrado" });
        res.json({ mensaje: "Damnificado actualizado", damnificado: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al editar damnificado" });
    }
};

// Eliminar damnificado
export const eliminarDamnificado = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `DELETE FROM "BDTTR_DAMN" WHERE "TTR_CODAMN"=$1 RETURNING *`,
            [id]
        );
        if (result.rowCount === 0) return res.status(404).json({ message: "No encontrado" });
        res.json({ mensaje: "Damnificado eliminado" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al eliminar damnificado" });
    }
};

// Listar víctimas with búsqueda y paginación
export const listarVictimas = async (req, res) => {
    try {
        const { page = 1, search = "" } = req.query;
        const limit = 10;
        const offset = (page - 1) * limit;
        const searchQuery = `%${search}%`;

        // Total count
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM "BDTTR_VICT" WHERE "TTR_NOMBRE" ILIKE $1 OR "TTR_APELLI" ILIKE $1 OR "TTR_CEDULA" ILIKE $1`,
            [searchQuery]
        );
        const total = parseInt(countResult.rows[0].count);

        // Data
        const result = await pool.query(
            `SELECT * FROM "BDTTR_VICT"
             WHERE "TTR_NOMBRE" ILIKE $1 OR "TTR_APELLI" ILIKE $1 OR "TTR_CEDULA" ILIKE $1
             ORDER BY "TTR_COVICT" DESC
             LIMIT $2 OFFSET $3`,
            [searchQuery, limit, offset]
        );
        res.json({ data: result.rows, total });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al listar víctimas" });
    }
};

// Editar víctima
export const editarVictima = async (req, res) => {
    try {
        const { id } = req.params;
        const { cedula, tipodo, nombre, apelli, coafec } = req.body;
        const result = await pool.query(
            `UPDATE "BDTTR_VICT"
             SET "TTR_CEDULA"=$1, "TTR_TIPODO"=$2, "TTR_NOMBRE"=INITCAP($3), "TTR_APELLI"=INITCAP($4), "TTR_COAFEC"=$5
             WHERE "TTR_COVICT"=$6 RETURNING *`,
            [cedula, tipodo, nombre, apelli, coafec, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ message: "No encontrado" });
        res.json({ mensaje: "Víctima actualizada", victima: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al editar víctima" });
    }
};

// Eliminar víctima
export const eliminarVictima = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `DELETE FROM "BDTTR_VICT" WHERE "TTR_COVICT"=$1 RETURNING *`,
            [id]
        );
        if (result.rowCount === 0) return res.status(404).json({ message: "No encontrado" });
        res.json({ mensaje: "Víctima eliminada" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al eliminar víctima" });
    }
};


// Listar zonas afectadas con latitud y longitud
export const getZonasAfectadas = async (req, res) => {
    try {
        // Trae las comunidades afectadas, su nombre, latitud y longitud
        const result = await pool.query(`
            SELECT c."TMA_NOMBRE" as nombre, c."TMA_LATITU" as lat, c."TMA_LONGIT" as lng, a."TTR_COAFEC"
            FROM "BDTTR_AFEC" a
            JOIN "BDTMA_COMU" c ON a."TTR_CODCOM" = c."TMA_CODCOM"
            GROUP BY c."TMA_NOMBRE", c."TMA_LATITU", c."TMA_LONGIT", a."TTR_COAFEC"
            ORDER BY a."TTR_FEAFEC" DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al obtener las zonas afectadas" });
    }
};

// Registrar pérdida


// Obtener tipos de pérdidas
export const getTiposPerdida = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT "TTR_COTIPO", "TTR_NOMBRE" FROM "BDTTR_TIPE" ORDER BY "TTR_NOMBRE"`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error al obtener tipos de pérdida:", error);
        res.status(500).json({ mensaje: "Error al obtener tipos de pérdida" });
    }
};

// Registrar varias pérdidas (con datos personales)// ...existing code...
export const crearPerdidas = async (req, res) => {
    try {
        const { coafec, perdidas, coddoc, cedula, nombre, apelli } = req.body;
        if (!coafec || !coddoc || !cedula || !nombre || !apelli || !Array.isArray(perdidas) || perdidas.length === 0) {
            return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
        }
        // Validar cada pérdida (ahora aceptamos descri opcional)
        for (const p of perdidas) {
            if (!p.cotipo || (p.vaesti === undefined || p.vaesti === null)) {
                return res.status(400).json({ mensaje: "Faltan datos en una de las pérdidas" });
            }
            // normalizar descripción si existe
            if (p.descri && typeof p.descri !== 'string') {
                return res.status(400).json({ mensaje: "Descripción de pérdida inválida" });
            }
        }
        // Insertar cada pérdida incluyendo TTR_DESCRI
        const results = [];
        for (const p of perdidas) {
            const descri = p.descri ? String(p.descri).trim() : null;
            const result = await pool.query(
                `INSERT INTO "BDTTR_PERD" (
                    "TTR_COAFEC", "TTR_COTIPO", "TTR_VAESTI", "TTR_CODDOC",
                    "TTR_CEDULA", "TTR_NOMBRE", "TTR_APELLI", "TTR_DESCRI"
                ) VALUES ($1, $2, $3, $4, $5, INITCAP($6), INITCAP($7), $8) RETURNING *`,
                [coafec, p.cotipo, p.vaesti, coddoc, cedula, nombre, apelli, descri]
            );
            results.push(result.rows[0]);
        }
        res.status(201).json({ mensaje: "Pérdidas registradas", perdidas: results });
    } catch (error) {
        console.error("Error al registrar pérdidas:", error);
        res.status(500).json({ mensaje: "Error al registrar pérdidas", error: error.message });
    }
};
// ...existing code...

// Listar tipos de documento
export const getTiposDocument = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT "TMA_CODDOC", "TMA_NOMBRE" FROM "BDTMA_TIDO" ORDER BY "TMA_NOMBRE"`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error al obtener tipos de documento:", error);
        res.status(500).json({ mensaje: "Error al obtener tipos de documento" });
    }
};

// listar perdidas

// Listar pérdidas con búsqueda y paginación
export const listarPerdidas = async (req, res) => {
    try {
        const { page = 1, search = "" } = req.query;
        const limit = 10;
        const offset = (page - 1) * limit;
        const searchQuery = `%${search}%`;

        // Total count
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM "BDTTR_PERD" p
            LEFT JOIN "BDTTR_AFEC" a ON p."TTR_COAFEC" = a."TTR_COAFEC"
            LEFT JOIN "BDTMA_COMU" c ON a."TTR_CODCOM" = c."TMA_CODCOM"
            WHERE p."TTR_NOMBRE" ILIKE $1 OR p."TTR_APELLI" ILIKE $1 OR p."TTR_CEDULA" ILIKE $1 OR c."TMA_NOMBRE" ILIKE $1`,
            [searchQuery]
        );
        const total = parseInt(countResult.rows[0].count);

        // Data
        const result = await pool.query(
            `SELECT p.*, t."TTR_NOMBRE" as tipo_perdida, d."TMA_NOMBRE" as tipo_documento, c."TMA_NOMBRE" as comunidad
            FROM "BDTTR_PERD" p
            LEFT JOIN "BDTTR_TIPE" t ON p."TTR_COTIPO" = t."TTR_COTIPO"
            LEFT JOIN "BDTMA_TIDO" d ON p."TTR_CODDOC" = d."TMA_CODDOC"
            LEFT JOIN "BDTTR_AFEC" a ON p."TTR_COAFEC" = a."TTR_COAFEC"
            LEFT JOIN "BDTMA_COMU" c ON a."TTR_CODCOM" = c."TMA_CODCOM"
            WHERE p."TTR_NOMBRE" ILIKE $1 OR p."TTR_APELLI" ILIKE $1 OR p."TTR_CEDULA" ILIKE $1 OR c."TMA_NOMBRE" ILIKE $1
            ORDER BY p."TTR_COPERD" DESC
            LIMIT $2 OFFSET $3`,
            [searchQuery, limit, offset]
        );
        res.json({ data: result.rows, total });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al listar pérdidas" });
    }
};

// Editar pérdida
export const editarPerdida = async (req, res) => {
    try {
        const { id } = req.params;
        const { coafec, cotipo, vaesti, coddoc, cedula, nombre, apelli } = req.body;
        const result = await pool.query(
            `UPDATE "BDTTR_PERD"
             SET "TTR_COAFEC"=$1, "TTR_COTIPO"=$2, "TTR_VAESTI"=$3, "TTR_CODDOC"=$4, "TTR_CEDULA"=$5, "TTR_NOMBRE"=INITCAP($6), "TTR_APELLI"=INITCAP($7)
             WHERE "TTR_COPERD"=$8 RETURNING *`,
            [coafec, cotipo, vaesti, coddoc, cedula, nombre, apelli, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ message: "No encontrado" });
        res.json({ mensaje: "Pérdida actualizada", perdida: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al editar pérdida" });
    }
};

// Eliminar pérdida
export const eliminarPerdida = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `DELETE FROM "BDTTR_PERD" WHERE "TTR_COPERD"=$1 RETURNING *`,
            [id]
        );
        if (result.rowCount === 0) return res.status(404).json({ message: "No encontrado" });
        res.json({ mensaje: "Pérdida eliminada" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al eliminar pérdida" });
    }
};

export const getDashboardData = async (req, res) => {
    try {
        // Total víctimas (con cédula válida)
        const victimas = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE "TTR_CEDULA" IS NOT NULL AND "TTR_CEDULA" != '') AS fallecidos
            FROM "BDTTR_VICT"
        `);

        // Desastre más frecuente
        const desastreFrecuente = await pool.query(`
            SELECT d."TMA_NOMBRE", COUNT(*) as cantidad
            FROM "BDTTR_AFEC" a
            JOIN "BDTMA_DESA" d ON a."TTR_CODESA" = d."TMA_CODESA"
            GROUP BY d."TMA_NOMBRE"
            ORDER BY cantidad DESC
            LIMIT 1
        `);

        // Desastres por tipo (cantidad, fallecidos)
        const desastresPorTipo = await pool.query(`
            SELECT 
                d."TMA_NOMBRE" as tipo,
                COUNT(a."TTR_COAFEC") as cantidad,
                COUNT(v."TTR_COVICT") FILTER (WHERE v."TTR_CEDULA" IS NOT NULL AND v."TTR_CEDULA" != '') as fallecidos
            FROM "BDTTR_AFEC" a
            JOIN "BDTMA_DESA" d ON a."TTR_CODESA" = d."TMA_CODESA"
            LEFT JOIN "BDTTR_VICT" v ON v."TTR_COAFEC" = a."TTR_COAFEC"
            GROUP BY d."TMA_NOMBRE"
            ORDER BY cantidad DESC
        `);

        // Estados de salud de damnificados (agrupados)
        const estadosSalud = await pool.query(`
            SELECT "TTR_ESALUD" as estado, COUNT(*) as cantidad
            FROM "BDTTR_DAMN"
            GROUP BY "TTR_ESALUD"
            ORDER BY cantidad DESC
        `);

        // Víctimas fatales (como estado adicional)
        const victimasFatales = await pool.query(`
            SELECT COUNT(*) as cantidad
            FROM "BDTTR_VICT"
            WHERE "TTR_CEDULA" IS NOT NULL AND "TTR_CEDULA" != ''
        `);

        // Pérdidas por tipo
        const perdidasPorTipo = await pool.query(`
            SELECT t."TTR_NOMBRE" as tipo, COUNT(p."TTR_COPERD") as cantidad
            FROM "BDTTR_PERD" p
            JOIN "BDTTR_TIPE" t ON p."TTR_COTIPO" = t."TTR_COTIPO"
            GROUP BY t."TTR_NOMBRE"
            ORDER BY cantidad DESC
        `);

        // Unimos damnificados y víctimas fatales para la gráfica
        const estadosSaludGrafica = [
            ...estadosSalud.rows.map(r => ({
                estado: r.estado,
                cantidad: Number(r.cantidad)
            })),
            { estado: 'Fallecidos', cantidad: Number(victimasFatales.rows[0].cantidad) }
        ];

        res.json({
            resumen: {
                fallecidos: Number(victimas.rows[0].fallecidos),
                desastreMasFrecuente: desastreFrecuente.rows[0]?.TMA_NOMBRE || 'N/A'
            },
            desastresPorTipo: desastresPorTipo.rows.map(r => ({
                tipo: r.tipo,
                cantidad: Number(r.cantidad),
                fallecidos: Number(r.fallecidos)
            })),
            estadosSalud: estadosSaludGrafica,
            perdidasPorTipo: perdidasPorTipo.rows.map(r => ({
                tipo: r.tipo,
                cantidad: Number(r.cantidad)
            }))
        });
    } catch (error) {
        console.error("Error en dashboard:", error);
        res.status(500).json({ mensaje: "Error al obtener datos del dashboard", error: error.message });
    }
};
// Registrar donante
export const registrarDonante = async (req, res) => {
  try {
    const data = req.body || {};

    // Normalizar / trim y extracción de campos
    const nombre = String(data.nombre || '').trim();
    const contac = String(data.contac || '').trim();
    const tipodn = data.tipodn || null;
    const cedula = String(data.cedula || '').trim();
    const coddoc = data.coddoc || null;

    const errors = [];

    // Regex helpers
    const nameRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s'\-]+$/;
    const digitsRegex = /^\d+$/;

    // Validaciones
    if (!cedula) errors.push('Cédula es obligatoria');
    /*else if (!digitsRegex.test(cedula)) errors.push('Cédula inválida (solo dígitos)');*/
    // opcional: longitud mínima/ máxima de cédula
    // if (cedula.length < 6) errors.push('Cédula demasiado corta');

    if (!nombre) errors.push('Nombre es obligatorio');
    else if (!nameRegex.test(nombre)) errors.push("Nombre inválido (solo letras, espacios, guión o apóstrofe)");

    if (!contac) errors.push('Contacto es obligatorio');
    if (!tipodn) errors.push('Tipo de donante es obligatorio');
    if (!coddoc) errors.push('Tipo de documento es obligatorio');

    if (errors.length > 0) {
      return res.status(400).json({ codigo: 'VALIDATION_ERROR', errores: errors });
    }

    // Pre-check para evitar duplicados por cédula
    const exists = await pool.query(
      `SELECT 1 FROM "BDTMA_DONT" WHERE "TMA_CEDULA" = $1 LIMIT 1`,
      [cedula]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ codigo: 'CONFLICT', mensaje: 'Ya existe un donante con esa cédula' });
    }

    const result = await pool.query(
      `INSERT INTO "BDTMA_DONT" 
       ("TMA_NOMBRE", "TMA_CONTAC", "TMA_TIPODN", "TMA_CEDULA", "TMA_CODDOC")
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre, contac, tipodn, cedula, coddoc]
    );

    res.status(201).json({ mensaje: "Donante registrado", donante: result.rows[0] });
  } catch (error) {
    console.error("Error al registrar donante:", error);
    if (error && error.code === '23505') {
      return res.status(409).json({ mensaje: "Registro duplicado", detail: error.detail || null });
    }
    if (error && error.code === '23503') {
      return res.status(400).json({ mensaje: "Clave foránea inválida", detail: error.detail || null });
    }
    res.status(500).json({ mensaje: "Error al registrar donante", error: error.message });
  }
};



// Obtener tipos de donante para select
export const getTiposDonante = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT "TTR_TIPODN", "TTR_NOMBRE" FROM "BDTTR_TDON" ORDER BY "TTR_NOMBRE"`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error al obtener tipos de donante:", error);
        res.status(500).json({ mensaje: "Error al obtener tipos de donante" });
    }
};

/// donacion

// Registrar donación
// Registrar donación
export const registrarDonacion = async (req, res) => {
    try {
        const { cantidad, fedona, coafec, codont, tipodo, descri } = req.body;
        if (!cantidad || !fedona || !coafec || !codont || !tipodo) {
            return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
        }
        const result = await pool.query(
            `INSERT INTO "BDTTR_DONA"
            ("TTR_CANTID", "TTR_FEDONA", "TTR_COAFEC", "TTR_CODONT", "TTR_TIPODO", "TTR_DESCRI")
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [cantidad, fedona, coafec, codont, tipodo, descri || null]
        );
        res.status(201).json({ mensaje: "Donación registrada", donacion: result.rows[0] });
    } catch (error) {
        console.error("Error al registrar donación:", error);
        res.status(500).json({ mensaje: "Error al registrar donación", error: error.message });
    }
};

// Listar donantes registrados
export const listarDonantes = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT "TMA_CODONT", "TMA_NOMBRE", "TMA_CEDULA" FROM "BDTMA_DONT" ORDER BY "TMA_NOMBRE"`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error al listar donantes:", error);
        res.status(500).json({ mensaje: "Error al listar donantes" });
    }
};

// Obtener tipos de donación (estilos) para select
export const getTiposEstiloDonacion = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT "TTR_ESTIDO", "TTR_NOMBRE" FROM "BDTTR_ESTIDO" ORDER BY "TTR_NOMBRE"`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error al obtener tipos de donación:", error);
        res.status(500).json({ mensaje: "Error al obtener tipos de donación" });
    }
};


// Listar donaciones realizadas
export const listarDonaciones = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT d."TTR_CODONA", d."TTR_CANTID", d."TTR_FEDONA", d."TTR_DESCRI",
                   d."TTR_COAFEC", a."TTR_FEAFEC", c."TMA_NOMBRE" as comunidad,
                   d."TTR_CODONT", don."TMA_NOMBRE" as donante, don."TMA_CEDULA" as cedula_donante,
                   d."TTR_TIPODO", est."TTR_NOMBRE" as tipo_donacion
            FROM "BDTTR_DONA" d
            LEFT JOIN "BDTTR_AFEC" a ON d."TTR_COAFEC" = a."TTR_COAFEC"
            LEFT JOIN "BDTMA_COMU" c ON a."TTR_CODCOM" = c."TMA_CODCOM"
            LEFT JOIN "BDTMA_DONT" don ON d."TTR_CODONT" = don."TMA_CODONT"
            LEFT JOIN "BDTTR_ESTIDO" est ON d."TTR_TIPODO" = est."TTR_ESTIDO"
            ORDER BY d."TTR_FEDONA" DESC, d."TTR_CODONA" DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("Error al listar donaciones:", error);
        res.status(500).json({ mensaje: "Error al listar donaciones" });
    }
};

export const editarDonacion = async (req, res) => {
    try {
        const { id } = req.params;
        const { cantidad, fedona, coafec, codont, tipodo, descri } = req.body;
        const result = await pool.query(
            `UPDATE "BDTTR_DONA"
             SET "TTR_CANTID"=$1, "TTR_FEDONA"=$2, "TTR_COAFEC"=$3, "TTR_CODONT"=$4, "TTR_TIPODO"=$5, "TTR_DESCRI"=$6
             WHERE "TTR_CODONA"=$7 RETURNING *`,
            [cantidad, fedona, coafec, codont, tipodo, descri, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ mensaje: "No encontrado" });
        res.json({ mensaje: "Donación actualizada", donacion: result.rows[0] });
    } catch (error) {
        console.error("Error al editar donación:", error);
        res.status(500).json({ mensaje: "Error al editar donación" });
    }
};

export const eliminarDonacion = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `DELETE FROM "BDTTR_DONA" WHERE "TTR_CODONA"=$1 RETURNING *`,
            [id]
        );
        if (result.rowCount === 0) return res.status(404).json({ mensaje: "No encontrado" });
        res.json({ mensaje: "Donación eliminada" });
    } catch (error) {
        console.error("Error al eliminar donación:", error);
        res.status(500).json({ mensaje: "Error al eliminar donación" });
    }
};


// ...existing code...
export const editarDonante = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, contac, tipodn, cedula, coddoc } = req.body;

        // Normalizar valores entrantes
        const cedulaStr = cedula === null || cedula === undefined ? null : String(cedula).trim();
        const coddocStr = coddoc === null || coddoc === undefined ? '' : String(coddoc).trim().toUpperCase();

        // Detectar pasaporte (acepta letras, números y guion)
        const isPassport = ['P', '3', '03'].includes(coddocStr);

        // Validar cedula según tipo de documento
        if (cedulaStr) {
            if (isPassport) {
                if (!/^[A-Za-z0-9-]{3,20}$/.test(cedulaStr)) {
                    return res.status(400).json({ mensaje: "Documento inválido para pasaporte (letras, números y guión, 3-20 caracteres)" });
                }
            } else {
                if (!/^\d{3,20}$/.test(cedulaStr)) {
                    return res.status(400).json({ mensaje: "Cédula inválida: solo dígitos permitidos" });
                }
            }
        }

        // tipodn: si la columna en BD es integer, convertir; si no, pasar tal cual
        const tipodnInt = (tipodn === null || tipodn === undefined) ? null : (Number.isInteger(Number(tipodn)) ? parseInt(tipodn, 10) : tipodn);

        const result = await pool.query(
            `UPDATE "BDTMA_DONT"
             SET "TMA_NOMBRE" = $1,
                 "TMA_CONTAC" = $2,
                 "TMA_TIPODN" = $3,
                 "TMA_CEDULA" = $4,
                 "TMA_CODDOC" = $5
             WHERE "TMA_CODONT" = $6
             RETURNING *`,
            [nombre, contac, tipodnInt, cedulaStr, coddocStr || null, id]
        );

        if (result.rowCount === 0) return res.status(404).json({ mensaje: "No encontrado" });
        res.json({ mensaje: "Donante actualizado", donante: result.rows[0] });
    } catch (error) {
        console.error("Error al editar donante:", error);
        res.status(500).json({ mensaje: "Error al editar donante", error: error.message });
    }
};
// Eliminar donante
export const eliminarDonante = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `DELETE FROM "BDTMA_DONT" WHERE "TMA_CODONT"=$1 RETURNING *`,
            [id]
        );
        if (result.rowCount === 0) return res.status(404).json({ mensaje: "No encontrado" });
        res.json({ mensaje: "Donante eliminado" });
    } catch (error) {
        console.error("Error al eliminar donante:", error);
        res.status(500).json({ mensaje: "Error al eliminar donante" });
    }
};

// Listar donantes con nombres de tipo de donante y tipo de documento
export const listarDonantesFull = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT d."TMA_CODONT",
                    d."TMA_NOMBRE",
                    d."TMA_CONTAC",
                    t."TTR_NOMBRE" AS tipo_donante,
                    d."TMA_CEDULA",
                    doc."TMA_NOMBRE" AS tipo_documento
             FROM "BDTMA_DONT" d
             LEFT JOIN "BDTTR_TDON" t ON d."TMA_TIPODN" = t."TTR_TIPODN"
             LEFT JOIN "BDTMA_TIDO" doc ON d."TMA_CODDOC" = doc."TMA_CODDOC"
             ORDER BY d."TMA_NOMBRE"`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error al listar donantes:", error);
        res.status(500).json({ mensaje: "Error al listar donantes" });
    }
};



export const eliminarNoticia = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM "BDTTR_NOTI" WHERE "TTR_CONOTI" = $1 RETURNING *`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ mensaje: "Noticia no encontrada" });
    }
    res.json({ mensaje: "Noticia eliminada correctamente" });
  } catch (error) {
    console.error("Error al eliminar noticia:", error);
    res.status(500).json({ mensaje: "Error al eliminar noticia", error: error.message });
  }
};



// Recuperación de contraseña


// Transporte global
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'gestion.desastres2025@gmail.com',
        pass: 'zvfx ripj vqzx xnyf'
    }
});

// Solicitar recuperación
export const solicitarRecuperacion = async (req, res) => {
    const { email } = req.body;
    try {
        const result = await pool.query('SELECT * FROM "BDTMA_USUA" WHERE "TMA_CORREO" = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Correo no registrado" });
        }
        const usuario = result.rows[0];

        const token = crypto.randomBytes(32).toString('hex');
        const expiracion = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

        await pool.query(
            'UPDATE "BDTMA_USUA" SET "TMA_RESETO" = $1, "TMA_RESETP" = $2 WHERE "TMA_CORREO" = $3',
            [token, expiracion, email]
        );

        const enlace = `https://sistema-de-gestion-desastres.netlify.app/restablecer/${token}`;

        await transporter.sendMail({
            from: '"Soporte" <gestion.desastres2025@gmail.com>',
            to: email,
            subject: "Recuperación de acceso",
            html: `<p>Hola tu nombre de usuario es: ${usuario.TMA_USUARI || ''},</p>
                   <p>Haz clic en el siguiente enlace para restablecer tu contraseña:</p>
                   <a href="${enlace}">${enlace}</a>
                   <p>Este enlace expirará en 1 hora.</p>`
        });

        res.json({ mensaje: "Correo de recuperación enviado" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error enviando correo de recuperación", error: error.message });
    }
};

// Restablecer contraseña
export const restablecerContrasena = async (req, res) => {
    const { token } = req.params;
    const { nuevaContrasena } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM "BDTMA_USUA" WHERE "TMA_RESETO" = $1 AND "TMA_RESETP" > NOW()',
            [token]
        );
        if (result.rows.length === 0) {
            return res.status(400).json({ mensaje: "Token inválido o expirado" });
        }
        const hash = await bcrypt.hash(nuevaContrasena, 10);

        await pool.query(
            'UPDATE "BDTMA_USUA" SET "TMA_CONTRA" = $1, "TMA_RESETO" = NULL, "TMA_RESETP" = NULL WHERE "TMA_RESETO" = $2',
            [hash, token]
        );
        res.json({ mensaje: "Contraseña restablecida correctamente" });
    } catch (error) {
        res.status(500).json({ mensaje: "Error al restablecer la contraseña", error: error.message });
    }
};

////
// Listar países
export const listarPaises = async (req, res) => {
    try {
        const result = await pool.query('SELECT "TMA_COPAIS", "TMA_NOMBRE" FROM "BDTMA_PAIS" ORDER BY "TMA_NOMBRE"');
        res.json(result.rows);
    } catch (error) {
        console.error("Error al listar países:", error);
        res.status(500).json({ mensaje: "Error al listar países", error: error.message });
    }
};

// Listar estados por país
export const listarEstadosPorPais = async (req, res) => {
    const { codpais } = req.params;
    try {
        const result = await pool.query(
            'SELECT "TMA_COESTA", "TMA_NOMBRE" FROM "BDTMA_ESTD" WHERE "TMA_COPAIS" = $1 ORDER BY "TMA_NOMBRE"',
            [codpais]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error al listar estados" });
    }
};

// Listar municipios por estado
export const listarMunicipiosPorEstado = async (req, res) => {
    const { coesta } = req.params;
    try {
        const result = await pool.query(
            'SELECT "TMA_COMUNI", "TMA_NOMBRE" FROM "BDTMA_MUNI" WHERE "TMA_COESTA" = $1 ORDER BY "TMA_NOMBRE"',
            [coesta]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error al listar municipios" });
    }
};

// Listar parroquias por municipio
export const listarParroquiasPorMunicipio = async (req, res) => {
    const { comuni } = req.params;
    try {
        const result = await pool.query(
            'SELECT "TMA_COPARR", "TMA_NOMBRE" FROM "BDTMA_PARR" WHERE "TMA_COMUNI" = $1 ORDER BY "TMA_NOMBRE"',
            [comuni]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error al listar parroquias" });
    }
};

// Listar comunidades por parroquia (para el select dependiente)
export const listarComunidadesPorParroquia = async (req, res) => {
    const { coparr } = req.params;
    try {
        const result = await pool.query(
            'SELECT "TMA_CODCOM", "TMA_NOMBRE" FROM "BDTMA_COMU" WHERE "TMA_COPARR" = $1 ORDER BY "TMA_NOMBRE"',
            [coparr]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error al listar comunidades" });
    }
};



// Listar todas las afectaciones
export const listarAfectaciones = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT "TTR_COAFEC", "TTR_CODCOM", "TTR_FEAFEC", "TTR_CODESA"
       FROM "BDTTR_AFEC"
       ORDER BY "TTR_COAFEC" DESC
       `

    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al listar afectaciones:', error);
    res.status(500).json({ mensaje: 'Error al listar afectaciones', error: error.message });
  }
};

export const obtenerUltimaAfectacion = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT "TTR_COAFEC", "TTR_CODCOM", "TTR_FEAFEC", "TTR_CODESA"
       FROM "BDTTR_AFEC"
       ORDER BY "TTR_COAFEC" DESC
       LIMIT 1`
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'No hay afectaciones registradas' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener la última afectación:', error);
    res.status(500).json({ mensaje: 'Error al obtener la última afectación', error: error.message });
  }
};

// Editar una afectación
export const editarAfectacion = async (req, res) => {
  const { id } = req.params;
  const { TTR_CODCOM, TTR_FEAFEC, TTR_CODESA } = req.body;
  try {
    const result = await pool.query(
      `UPDATE "BDTTR_AFEC"
       SET "TTR_CODCOM" = $1, "TTR_FEAFEC" = $2, "TTR_CODESA" = $3
       WHERE "TTR_COAFEC" = $4
       RETURNING *`,
      [TTR_CODCOM, TTR_FEAFEC, TTR_CODESA, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ mensaje: 'Afectación no encontrada' });
    }
    res.json({ mensaje: 'Afectación actualizada', afectacion: result.rows[0] });
  } catch (error) {
    console.error('Error al editar afectación:', error);
    res.status(500).json({ mensaje: 'Error al editar afectación', error: error.message });
  }
};

// Eliminar una afectación
export const eliminarAfectacion = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM "BDTTR_AFEC" WHERE "TTR_COAFEC" = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ mensaje: 'Afectación no encontrada' });
    }
    res.json({ mensaje: 'Afectación eliminada' });
  } catch (error) {
    console.error('Error al eliminar afectación:', error);
    res.status(500).json({ mensaje: 'Error al eliminar afectación', error: error.message });
  }
};
// ...existing code...
export const generarPdfAfectacion = async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Obtener datos de la afectación
    const afectacionResult = await pool.query(
      `SELECT a."TTR_COAFEC", a."TTR_FEAFEC", c."TMA_NOMBRE" as comunidad, d."TMA_NOMBRE" as desastre
       FROM "BDTTR_AFEC" a
       JOIN "BDTMA_COMU" c ON a."TTR_CODCOM" = c."TMA_CODCOM"
       JOIN "BDTMA_DESA" d ON a."TTR_CODESA" = d."TMA_CODESA"
       WHERE a."TTR_COAFEC" = $1`,
      [id]
    );
    if (afectacionResult.rows.length === 0) {
      return res.status(404).json({ mensaje: "Afectación no encontrada" });
    }
    const afectacion = afectacionResult.rows[0];

    // 2. Damnificados
    const damnificadosResult = await pool.query(
      `SELECT "TTR_NOMBRE", "TTR_APELLI", "TTR_CEDULA", "TTR_FENACI", "TTR_CONTAC", "TTR_ESALUD"
       FROM "BDTTR_DAMN"
       WHERE "TTR_COAFEC" = $1`,
      [id]
    );

    // 3. Víctimas
    const victimasResult = await pool.query(
      `SELECT "TTR_NOMBRE", "TTR_APELLI", "TTR_CEDULA"
       FROM "BDTTR_VICT"
       WHERE "TTR_COAFEC" = $1`,
      [id]
    );

    // 4. Pérdidas (incluye la descripción TTR_DESCRI)
    const perdidasResult = await pool.query(
      `SELECT p."TTR_NOMBRE", p."TTR_APELLI", p."TTR_CEDULA",
              t."TTR_NOMBRE" as tipo_perdida,
              p."TTR_VAESTI",
              p."TTR_DESCRI"
       FROM "BDTTR_PERD" p
       JOIN "BDTTR_TIPE" t ON p."TTR_COTIPO" = t."TTR_COTIPO"
       WHERE p."TTR_COAFEC" = $1`,
      [id]
    );

    // 5. Afectados de BDTTR_HERI
    const afectadosResult = await pool.query(
      `SELECT "TTR_NOMBRE", "TTR_APELLI", "TTR_CEDULA", "TTR_TELEFO"
       FROM "BDTTR_HERI"
       WHERE "TTR_COAFEC" = $1`,
      [id]
    );

    // Agregar afectados al PDF
    const afectados = afectadosResult.rows.map(afectado => ({
      nombre: afectado.TTR_NOMBRE,
      apellido: afectado.TTR_APELLI,
      cedula: afectado.TTR_CEDULA,
      telefono: afectado.TTR_TELEFO
    }));

    // 6. Construir el documento PDF en horizontal y con fuente más pequeña para la descripción
    const docDefinition = {
      pageOrientation: 'landscape',
      pageMargins: [20, 20, 20, 20],
      content: [
        // Membrete con espacio para logos
        {
          columns: [
            {
              image: 'src/assets/logodesastres-removebg-preview.png',
              width: 73,
              height: 70,
              alignment: 'left'
            },
            {
              stack: [
                { text: 'República Bolivariana De Venezuela', style: 'membrete', alignment: 'center' },
                { text: 'Ministerio del Poder Popular para Relaciones Interiores, Justicia y Paz', style: 'membrete', alignment: 'center' },
                { text: 'Dirección Nacional De Protección Civil y Administración de Desastres', style: 'membrete', alignment: 'center' },
                { text: 'Sistema de Gestión De Desastres Naturales', style: 'membrete', alignment: 'center' }
              ]
            },
            {
              image: 'src/assets/gobierno.png',
              width: 71,
              height: 70,
              alignment: 'right'
            }
          ],
          margin: [0, 0, 0, 8]
        },

        { text: `REPORTE DE AFECTACIÓN`, style: 'header', alignment: 'center', margin: [0, 0, 0, 8] },

        // Datos de la afectación
        {
          table: {
            widths: ['auto', '*', 'auto', 120],
            body: [
              [
                { text: 'Comunidad:', bold: true, fillColor: '#eeeeee', alignment: 'right' },
                { text: afectacion.comunidad, alignment: 'left', colSpan: 3, border: [false, true, false, true] }, {}, {}
              ],
              [
                { text: 'Desastre:', bold: true, fillColor: '#eeeeee', alignment: 'right' },
                { text: afectacion.desastre, alignment: 'left', border: [false, true, false, true] },
                { text: 'Fecha:', bold: true, fillColor: '#eeeeee', alignment: 'right' },
                { text: afectacion.TTR_FEAFEC ? new Date(afectacion.TTR_FEAFEC).toLocaleDateString('es-VE') : '', alignment: 'left', border: [false, true, false, true] }
              ]
            ]
          },
          layout: {
            fillColor: (rowIndex) => rowIndex === 0 ? '#f5f5f5' : null,
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#bbb',
            vLineColor: () => '#bbb',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 4,
            paddingBottom: () => 4
          },
          margin: [0, 0, 0, 12]
        },

        // Damnificados
        { text: 'Damnificados', style: 'subheader', margin: [0, 6, 0, 6] },
        damnificadosResult.rows.length === 0
          ? { text: 'No hay damnificados registrados.', italics: true, margin: [0, 0, 0, 8] }
          : {
              table: {
                headerRows: 1,
                widths: ['auto', 150, 150, 90, 110, 90],
                body: [
                  [
                    { text: 'N°Doc', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Nombre', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Apellido', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Nacimiento', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Contacto', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Salud', bold: true, fillColor: '#e3e3e3', alignment: 'center' }
                  ],
                  ...damnificadosResult.rows.map(d => [
                    { text: d.TTR_CEDULA, alignment: 'center' },
                    { text: d.TTR_NOMBRE, alignment: 'center' },
                    { text: d.TTR_APELLI, alignment: 'center' },
                    { text: d.TTR_FENACI ? new Date(d.TTR_FENACI).toLocaleDateString('es-VE') : '', alignment: 'center' },
                    { text: d.TTR_CONTAC, alignment: 'center' },
                    { text: d.TTR_ESALUD, alignment: 'center' }
                  ])
                ]
              },
              layout: {
                hLineWidth: () => 1,
                vLineWidth: () => 1,
                hLineColor: () => '#bbb',
                vLineColor: () => '#bbb',
                paddingLeft: () => 6,
                paddingRight: () => 6,
                paddingTop: () => 4,
                paddingBottom: () => 4
              },
              margin: [0, 0, 0, 12]
            },

        // Víctimas
        { text: 'Víctimas', style: 'subheader', margin: [0, 6, 0, 6] },
        victimasResult.rows.length === 0
          ? { text: 'No hay víctimas registradas.', italics: true, margin: [0, 0, 0, 8] }
          : {
              table: {
                headerRows: 1,
                widths: ['auto', 170, 170],
                body: [
                  [
                    { text: 'N°Doc', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Nombre', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Apellido', bold: true, fillColor: '#e3e3e3', alignment: 'center' }
                  ],
                  ...victimasResult.rows.map(v => [
                    { text: v.TTR_CEDULA, alignment: 'center' },
                    { text: v.TTR_NOMBRE, alignment: 'center' },
                    { text: v.TTR_APELLI, alignment: 'center' }
                  ])
                ]
              },
              layout: {
                hLineWidth: () => 1,
                vLineWidth: () => 1,
                hLineColor: () => '#bbb',
                vLineColor: () => '#bbb',
                paddingLeft: () => 6,
                paddingRight: () => 6,
                paddingTop: () => 4,
                paddingBottom: () => 4
              },
              margin: [0, 0, 0, 12]
            },

        // Pérdidas con descripción amplia (horizontal)
        { text: 'Pérdidas', style: 'subheader', margin: [0, 6, 0, 6] },
        perdidasResult.rows.length === 0
          ? { text: 'No hay pérdidas registradas.', italics: true }
          : {
              table: {
                headerRows: 1,
                // dar espacio amplio a la columna de descripción
                widths: ['auto', 140, 140, 140, '*', 90],
                body: [
                  [
                    { text: 'N°Doc', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Nombre', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Apellido', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Tipo', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Descripción', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Valor', bold: true, fillColor: '#e3e3e3', alignment: 'center' }
                  ],
                  ...perdidasResult.rows.map(p => [
                    { text: p.TTR_CEDULA, alignment: 'center' },
                    { text: p.TTR_NOMBRE, alignment: 'center' },
                    { text: p.TTR_APELLI, alignment: 'center' },
                    { text: p.tipo_perdida, alignment: 'center' },
                    // aplicar fuente pequeña y permitir salto de línea dentro de la celda
                    { text: p.TTR_DESCRI ? String(p.TTR_DESCRI).trim() : '-', alignment: 'center', fontSize: 9, margin: [0, 2, 0, 2] },
                    { text: p.TTR_VAESTI != null ? Number(p.TTR_VAESTI).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-', alignment: 'center' }
                  ])
                ]
              },
              layout: {
                hLineWidth: () => 1,
                vLineWidth: () => 1,
                hLineColor: () => '#bbb',
                vLineColor: () => '#bbb',
                paddingLeft: () => 6,
                paddingRight: () => 6,
                paddingTop: () => 4,
                paddingBottom: () => 4
              }
            },

        // Afectados de BDTTR_HERI
        { text: 'Afectados', style: 'subheader', margin: [0, 6, 0, 6] },
        afectadosResult.rows.length === 0
          ? { text: 'No hay afectados registrados', italics: true }
          : {
              table: {
                headerRows: 1,
                widths: ['*', '*', '*', '*'],
                body: [
                  [
                    { text: 'N°Doc', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Nombre ', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Apellido', bold: true, fillColor: '#e3e3e3', alignment: 'center' },
                    { text: 'Teléfono', bold: true, fillColor: '#e3e3e3', alignment: 'center' }
                  ],
                  ...afectadosResult.rows.map(a => [
                    { text: a.TTR_CEDULA, alignment: 'center' },
                    { text: a.TTR_NOMBRE, alignment: 'center' },
                    { text: a.TTR_APELLI, alignment: 'center' },
                    { text: a.TTR_TELEFO, alignment: 'center' }
                  ])
                ]
              },
              layout: {
                hLineWidth: () => 1,
                vLineWidth: () => 1,
                hLineColor: () => '#bbb',
                vLineColor: () => '#bbb',
                paddingLeft: () => 6,
                paddingRight: () => 6,
                paddingTop: () => 4,
                paddingBottom: () => 4
              }
            }
      ],
      styles: {
        membrete: { fontSize: 10, bold: true, margin: [0, 0, 0, 2], font: 'Helvetica' },
        header: { fontSize: 14, bold: true, alignment: 'center', font: 'Helvetica' },
        subheader: { fontSize: 12, bold: true, margin: [0, 6, 0, 6], font: 'Helvetica' }
      },
      defaultStyle: {
        font: 'Helvetica',
        fontSize: 10
      }
    };

    // 6. Generar y enviar el PDF
    const fonts = {
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    };

    const printer = new PdfPrinter(fonts);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    let chunks = [];
    pdfDoc.on('data', chunk => chunks.push(chunk));
    pdfDoc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=afectacion_${id}.pdf`);
      res.send(pdfBuffer);
    });
    pdfDoc.end();

  } catch (error) {
    console.error('Error al generar PDF:', error);
    res.status(500).json({ mensaje: 'Error al generar PDF', error: error.message });
  }
};


// Listar afectaciones resumen por fecha
export const listarAfectacionesResumenPorFecha = async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const result = await pool.query(`
      SELECT 
        a."TTR_COAFEC",
        c."TMA_NOMBRE" AS comunidad,
        d."TMA_NOMBRE" AS desastre,
        a."TTR_FEAFEC",
        -- ¿Tiene damnificados?
        EXISTS (
          SELECT 1 FROM "BDTTR_DAMN" dam WHERE dam."TTR_COAFEC" = a."TTR_COAFEC"
        ) AS tiene_damnificados,
        -- ¿Tiene víctimas?
        EXISTS (
          SELECT 1 FROM "BDTTR_VICT" vic WHERE vic."TTR_COAFEC" = a."TTR_COAFEC"
        ) AS tiene_victimas,
        -- ¿Tiene pérdidas?
        EXISTS (
          SELECT 1 FROM "BDTTR_PERD" per WHERE per."TTR_COAFEC" = a."TTR_COAFEC"
        ) AS tiene_perdidas,
        -- ¿Tiene afectados?
        EXISTS (
          SELECT 1 FROM "BDTTR_HERI" her WHERE her."TTR_COAFEC" = a."TTR_COAFEC"
        ) AS tiene_afectados
      FROM "BDTTR_AFEC" a
      JOIN "BDTMA_COMU" c ON a."TTR_CODCOM" = c."TMA_CODCOM"
      JOIN "BDTMA_DESA" d ON a."TTR_CODESA" = d."TMA_CODESA"
      WHERE a."TTR_FEAFEC" BETWEEN $1 AND $2
      ORDER BY a."TTR_FEAFEC" DESC
    `, [desde, hasta]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al listar resumen de afectaciones:', error);
    res.status(500).json({ mensaje: 'Error al listar resumen de afectaciones', error: error.message });
  }
};

export const generarPdfResumenAfectacionesPorFecha = async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    // Lee la imagen y conviértela a base64
    const logoPath = path.join(process.cwd(), 'src/assets/logodesastres-removebg-preview.png');
    let logoBase64 = '';
    try {
      const imageBuffer = fs.readFileSync(logoPath);
      logoBase64 = 'data:image/jpeg;base64,' + imageBuffer.toString('base64');
    } catch (e) {
      logoBase64 = '';
    }

    // Consulta con conteos y suma de pérdidas, incluyendo afectados de BDTTR_HERI
    const result = await pool.query(`
      SELECT 
        a."TTR_COAFEC",
        c."TMA_NOMBRE" AS comunidad,
        d."TMA_NOMBRE" AS desastre,
        a."TTR_FEAFEC",
        (SELECT COUNT(*) FROM "BDTTR_DAMN" dam WHERE dam."TTR_COAFEC" = a."TTR_COAFEC") AS cantidad_damnificados,
        (SELECT COUNT(*) FROM "BDTTR_VICT" vic WHERE vic."TTR_COAFEC" = a."TTR_COAFEC") AS cantidad_victimas,
        (SELECT COUNT(*) FROM "BDTTR_PERD" per WHERE per."TTR_COAFEC" = a."TTR_COAFEC") AS cantidad_perdidas,
        COALESCE((SELECT SUM("TTR_VAESTI") FROM "BDTTR_PERD" per WHERE per."TTR_COAFEC" = a."TTR_COAFEC"), 0) AS suma_perdidas,
        (SELECT COUNT(*) FROM "BDTTR_HERI" her WHERE her."TTR_COAFEC" = a."TTR_COAFEC") AS cantidad_afectados
      FROM "BDTTR_AFEC" a
      JOIN "BDTMA_COMU" c ON a."TTR_CODCOM" = c."TMA_CODCOM"
      JOIN "BDTMA_DESA" d ON a."TTR_CODESA" = d."TMA_CODESA"
      WHERE a."TTR_FEAFEC" BETWEEN $1 AND $2
      ORDER BY a."TTR_FEAFEC" DESC
    `, [desde, hasta]);

    // Calcular totales
    const totalAfectaciones = result.rows.length;
    const totalDamnificados = result.rows.reduce((sum, r) => sum + Number(r.cantidad_damnificados || 0), 0);
    const totalVictimas = result.rows.reduce((sum, r) => sum + Number(r.cantidad_victimas || 0), 0);
    const totalPerdidas = result.rows.reduce((sum, r) => sum + Number(r.cantidad_perdidas || 0), 0);
    const totalMontoPerdidas = result.rows.reduce((sum, r) => sum + Number(r.suma_perdidas || 0), 0);
    const totalAfectados = result.rows.reduce((sum, r) => sum + Number(r.cantidad_afectados || 0), 0);

    const docDefinition = {
      pageSize: { width: 1150, height: 612 }, // Ajustar el ancho de la hoja
      pageOrientation: 'landscape',
      content: [
        {
          columns: [
            {
              image: logoBase64,
              width: 90,
              alignment: 'left',
              margin: [20, 0, 0, 10]
            },
            {
              stack: [
                { text: 'República Bolivariana De Venezuela', style: 'membrete', alignment: 'center' },
                { text: 'Ministerio del Poder Popular para Relaciones Interiores, Justicia y Paz', style: 'membrete', alignment: 'center' },
                { text: 'Dirección Nacional De Protección Civil y Administración de Desastres', style: 'membrete', alignment: 'center' },
                { text: 'Sistema De Gestión De Desastres Naturales', style: 'membrete', alignment: 'center' }
              ]
            },
            {
              image: 'src/assets/gobierno.png',
              width: 80,
              height: 75, 
              alignment: 'right',
              margin: [0, 15, 20, 10]
            }
          ]
        },
        { text: 'RESUMEN DE AFECTACIONES', style: 'header', alignment: 'center', margin: [0, 0, 0, 10] },
        {
          text: `Desde: ${desde}   Hasta: ${hasta}`,
          alignment: 'center',
          margin: [0, 0, 0, 10]
        },
        // Tabla de detalle principal
        {
          alignment: 'center',
          table: {
            headerRows: 1,
            widths: [
              30, 150, '*', 70, // #
              80, 55,            // ¿Damnificados? | Cantidad
              65, 55,            // ¿Víctimas?     | Cantidad
              65, 55,            // ¿Pérdidas?     | Cantidad
              100,               // Total Pérdidas
              55, 55             // ¿Afectados?    | Cantidad
            ],
            body: [
              [
                { text: '#', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Comunidad', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Desastre', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Fecha', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Damnificados', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Cantidad', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Víctimas', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Cantidad', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                 { text: 'Afectados', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Cantidad', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Pérdidas', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Cantidad', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Pérdidas Bs', bold: true, fillColor: '#eeeeee', alignment: 'center' }
               
              ],
              ...result.rows.map((a, idx) => [
                { text: idx + 1, alignment: 'center' },
                { text: a.comunidad, alignment: 'center' },
                { text: a.desastre, alignment: 'center' },
                { text: a.TTR_FEAFEC ? new Date(a.TTR_FEAFEC).toLocaleDateString('es-VE') : '', alignment: 'center' },
                { text: a.cantidad_damnificados > 0 ? 'Sí' : 'No', alignment: 'center' },
                { text: a.cantidad_damnificados || 0, alignment: 'center' },
                { text: a.cantidad_victimas > 0 ? 'Sí' : 'No', alignment: 'center' },
                { text: a.cantidad_victimas || 0, alignment: 'center' },
                   { text: a.cantidad_afectados > 0 ? 'Sí' : 'No', alignment: 'center' },
                { text: a.cantidad_afectados || 0, alignment: 'center' },
                { text: a.cantidad_perdidas > 0 ? 'Sí' : 'No', alignment: 'center' },
                { text: a.cantidad_perdidas || 0, alignment: 'center' },
                { text: Number(a.suma_perdidas).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), alignment: 'center' }
             
              ])
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#bbb',
            vLineColor: () => '#bbb',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 4,
            paddingBottom: () => 4
          }
        },
        // Tabla de totales debajo de la principal
        {
          alignment: 'center',
          margin: [125, 20, 0, 0],
          table: {
            widths: [120, 120, 120, 120, 120, 120],
            body: [
              [
                { text: 'Total Afectaciones', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Total Damnificados', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Total Víctimas', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Total Afectados', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Total Pérdidas', bold: true, fillColor: '#eeeeee', alignment: 'center' },
                { text: 'Monto Total Pérdidas', bold: true, fillColor: '#eeeeee', alignment: 'center' }
                
              ],
              [
                { text: totalAfectaciones, alignment: 'center' },
                { text: totalDamnificados, alignment: 'center' },
                { text: totalVictimas, alignment: 'center' },
                { text: totalAfectados, alignment: 'center' },
                { text: totalPerdidas, alignment: 'center' },
                { text: Number(totalMontoPerdidas).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), alignment: 'center' }
                
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#bbb',
            vLineColor: () => '#bbb',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 4,
            paddingBottom: () => 4
          }
        }
      ],
      styles: {
        membrete: { fontSize: 11, bold: true, margin: [0, 0, 0, 2], font: 'Helvetica' },
        header: { fontSize: 16, bold: true, alignment: 'center', font: 'Helvetica' }
      },
      defaultStyle: {
        font: 'Helvetica'
      }
    };

    const fonts = {
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    };

    const printer = new PdfPrinter(fonts);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    let chunks = [];
    pdfDoc.on('data', chunk => chunks.push(chunk));
    pdfDoc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=resumen_afectaciones.pdf`);
      res.send(pdfBuffer);
    });
    pdfDoc.end();

  } catch (error) {
    console.error('Error al generar PDF resumen:', error);
    res.status(500).json({ mensaje: 'Error al generar PDF', error: error.message });
  }
};

// Listar todos los usuarios with campos relevantes
export const listarUsuarios = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        "TMA_CEDULA" AS cedula,
        "TMA_NOMBRE" AS nombres,
        "TMA_APELLI" AS apellidos,
        "TMA_DIRECC" AS direccion,
        "TMA_TELEFO" AS telefono,
        "TMA_CORREO" AS correo,
        "TMA_USUARI" AS usuario,
        "TMA_ROLE" AS rol
      FROM "BDTMA_USUA"
      ORDER BY "TMA_NOMBRE" ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al listar usuarios:', error);
    res.status(500).json({ mensaje: 'Error al listar usuarios', error: error.message });
  }
};

// Editar usuario (campos relevantes)
export const editarUsuario = async (req, res) => {
  try {
    const { cedula } = req.params;
    const { nombres, apellidos, direccion, telefono, correo, usuario, rol } = req.body;

    const result = await pool.query(
      `UPDATE "BDTMA_USUA"
       SET "TMA_NOMBRE" = INITCAP($1),
           "TMA_APELLI" = INITCAP($2),
           "TMA_DIRECC" = $3,
           "TMA_TELEFO" = $4,
           "TMA_CORREO" = $5,
           "TMA_USUARI" = $6,
           "TMA_ROLE" = LOWER($7)
       WHERE "TMA_CEDULA" = $8
       RETURNING *`,
      [nombres, apellidos, direccion, telefono, correo, usuario, rol, cedula]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    res.json({ mensaje: 'Usuario actualizado', usuario: result.rows[0] });
  } catch (error) {
    console.error('Error al editar usuario:', error);
    res.status(500).json({ mensaje: 'Error al editar usuario', error: error.message });
  }
};

// Eliminar usuario por cédula
export const eliminarUsuario = async (req, res) => {
  try {
    const { cedula } = req.params;
    const result = await pool.query(
      `DELETE FROM "BDTMA_USUA" WHERE "TMA_CEDULA" = $1 RETURNING *`,
      [cedula]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }
    res.json({ mensaje: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    res.status(500).json({ mensaje: 'Error al eliminar usuario', error: error.message });
  }
};



//////////// 


// Verificar identidad (cedula + fecha de nacimiento) y generar token temporal
export const verificarIdentidad = async (req, res) => {
  try {
    const { cedula, fecha_nac } = req.body;
    if (!cedula || !fecha_nac) {
      return res.status(400).json({ mensaje: "Faltan datos: cedula y fecha_nac son obligatorios" });
    }

    // Busca usuario por cédula y fecha de nacimiento 
    const q = `SELECT "TMA_CEDULA", "TMA_USUARI" FROM "BDTMA_USUA"
               WHERE "TMA_CEDULA" = $1 AND DATE("TMA_FENACI") = $2::date LIMIT 1`;
    const result = await pool.query(q, [String(cedula).trim(), fecha_nac]);
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: "No se encontró usuario con esos datos" });
    }

    // Generar token temporal y expiración (15 min)
    const token = crypto.randomBytes(24).toString('hex');
    const expiracion = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    await pool.query(
      `UPDATE "BDTMA_USUA" SET "TMA_RESETO" = $1, "TMA_RESETP" = $2 WHERE "TMA_CEDULA" = $3`,
      [token, expiracion, cedula]
    );

    // Devolver token para que frontend habilite los inputs de nueva contraseña
    return res.json({ ok: true, mensaje: "Identidad verificada", token, expires_at: expiracion });
  } catch (error) {
    console.error('verificarIdentidad error:', error);
    return res.status(500).json({ mensaje: "Error verificando identidad", error: error.message });
  }
};

// Registrar personas afectadas
export const registerPersonaAfectada = async (req, res) => {
    const { TTR_TIPODO, TTR_CEDULA, TTR_NOMBRE, TTR_APELLI, TTR_TELEFO, TTR_COAFEC } = req.body;

    // Validar que todos los campos requeridos estén presentes
    if (!TTR_TIPODO || !TTR_CEDULA || !TTR_NOMBRE || !TTR_APELLI || !TTR_TELEFO || !TTR_COAFEC) {
        return res.status(400).json({
            message: "Todos los campos son obligatorios: TTR_TIPODO, TTR_CEDULA, TTR_NOMBRE, TTR_APELLI, TTR_TELEFO, TTR_COAFEC."
        });
    }

    try {
        const query = `INSERT INTO "BDTTR_HERI" ("TTR_TIPODO", "TTR_CEDULA", "TTR_NOMBRE", "TTR_APELLI", "TTR_TELEFO", "TTR_COAFEC")
                       VALUES ($1, $2, INITCAP($3), INITCAP($4), $5, $6) RETURNING *`;
        const values = [TTR_TIPODO, TTR_CEDULA, TTR_NOMBRE, TTR_APELLI, TTR_TELEFO, TTR_COAFEC];

        const result = await pool.query(query, values);
        return res.status(201).json({ message: "Persona afectada registrada exitosamente", data: result.rows[0] });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al registrar la persona afectada" });
    }
};

// Listar personas afectadas
export const listarAfectados = async (req, res) => {
    try {
        const query = `
            SELECT h.*, 
                   t."TMA_NOMBRE" AS "tipo_documento",
                   COALESCE(c."TMA_NOMBRE") AS "comunidad"
            FROM "BDTTR_HERI" h
            LEFT JOIN "BDTMA_TIDO" t ON h."TTR_TIPODO" = t."TMA_CODDOC"
            LEFT JOIN "BDTTR_AFEC" a ON h."TTR_COAFEC" = a."TTR_COAFEC"
            LEFT JOIN "BDTMA_COMU" c ON a."TTR_CODCOM" = c."TMA_CODCOM"
            ORDER BY h."TTR_NOMBRE" ASC
        `;
        const result = await pool.query(query);
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al listar los afectados" });
    }
};

// Editar persona afectada
export const editarAfectado = async (req, res) => {
    try {
        const { id } = req.params;
        const { TTR_TIPODO, TTR_CEDULA, TTR_NOMBRE, TTR_APELLI, TTR_TELEFO, TTR_COAFEC } = req.body;

        const query = `
            UPDATE "BDTTR_HERI"
            SET "TTR_TIPODO" = $1, "TTR_CEDULA" = $2, "TTR_NOMBRE" = $3, "TTR_APELLI" = $4, "TTR_TELEFO" = $5, "TTR_COAFEC" = $6
            WHERE "TTR_COHERI" = $7 RETURNING *
        `;
        const values = [TTR_TIPODO, TTR_CEDULA, TTR_NOMBRE, TTR_APELLI, TTR_TELEFO, TTR_COAFEC, id];

        const result = await pool.query(query, values);
        if (result.rowCount === 0) return res.status(404).json({ message: "Afectado no encontrado" });

        return res.json({ message: "Afectado actualizado exitosamente", data: result.rows[0] });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al editar el afectado" });
    }
};

// Eliminar persona afectada
export const eliminarAfectado = async (req, res) => {
    try {
        const { id } = req.params;

        const query = `
            DELETE FROM "BDTTR_HERI"
            WHERE "TTR_COHERI" = $1`;
        const values = [id];

        const result = await pool.query(query, values);
        if (result.rowCount === 0) return res.status(404).json({ message: "Afectado no encontrado" });

        return res.json({ message: "Afectado eliminado exitosamente" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Error al eliminar el afectado" });
    }
};


import { generateReportePDF } from "../pdf/generateReportePDF.js";

/* =========================
   CREAR REPORTE
========================= */
export const crearReporte = async (req, res) => {
    try {
        const {
            fecha,
            unidad_numero,
            folio_numero,
            direccion,
            hora_inicio_llamada,
            hora_activacion,
            hora_en_sitio,
            hora_culminacion,
            condicion,
            observaciones,
            elaborado_por,
            cargo,
            cedula_identidad,
            tipos_actividad,
            acciones_tomadas,
            danos,
            comision
        } = req.body;

        const result = await pool.query(`
            INSERT INTO "RA_REPORTE" (
                "RA_FECHA","RA_UNIDAD_NUMERO","RA_FOLIO_NUMERO","RA_DIRECCION",
                "RA_HORA_INICIO","RA_HORA_ACTIVACION","RA_HORA_SITIO","RA_HORA_CULMINACION",
                "RA_CONDICION","RA_OBSERVACIONES","RA_ELABORADO_POR","RA_CARGO","RA_CEDULA"
            )
            VALUES ($1,$2,$3,INITCAP($4),$5,$6,$7,$8,$9,INITCAP($10),INITCAP($11),INITCAP($12),$13)
            RETURNING "RA_ID"
        `, [
            fecha,
            unidad_numero,
            folio_numero,
            direccion,
            hora_inicio_llamada ? hora_inicio_llamada.slice(0, 5) : null,
            hora_activacion ? hora_activacion.slice(0, 5) : null,
            hora_en_sitio ? hora_en_sitio.slice(0, 5) : null,
            hora_culminacion ? hora_culminacion.slice(0, 5) : null,
            condicion,
            observaciones,
            elaborado_por,
            cargo,
            cedula_identidad
        ]);

        const raId = result.rows[0].RA_ID;

        for (const t of tipos_actividad) {
            await pool.query(
                `INSERT INTO "RA_TIPO_ACTIVIDAD" ("RA_ID","TA_NOMBRE") VALUES ($1,$2)`,
                [raId, t]
            );
        }

        for (const a of acciones_tomadas) {
            await pool.query(
                `INSERT INTO "RA_ACCION" ("RA_ID","AC_NOMBRE") VALUES ($1,$2)`,
                [raId, a]
            );
        }

        for (const d of danos) {
            await pool.query(
                `INSERT INTO "RA_DANO" ("RA_ID","DA_NOMBRE") VALUES ($1,$2)`,
                [raId, d]
            );
        }

        for (const c of comision) {
            await pool.query(
                `INSERT INTO "RA_COMISION"
                ("RA_ID","CO_POSICION","CO_NOMBRE","CO_ORGANISMO")
                VALUES ($1,$2,INITCAP($3),$4)`,
                [raId, c.posicion, c.nombre, c.organismo]
            );
        }

        res.json({ message: "Reporte creado", id: raId });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al crear reporte" });
    }
};

/* =========================
   LISTAR REPORTES
========================= */
export const listarReportes = async (req, res) => {
    const result = await pool.query(
        `SELECT * FROM "RA_REPORTE" ORDER BY "RA_FECHA_REGISTRO" DESC`
    );
    res.json(result.rows);
};

/* =========================
   GENERAR PDF
========================= */
export const imprimirReporte = async (req, res) => {
    try {
        const { id } = req.params;

        const reporte = await pool.query(
            `SELECT * FROM "RA_REPORTE" WHERE "RA_ID"=$1`,
            [id]
        );

        const tipos = await pool.query(
            `SELECT "TA_NOMBRE" FROM "RA_TIPO_ACTIVIDAD" WHERE "RA_ID"=$1`,
            [id]
        );

        const acciones = await pool.query(
            `SELECT "AC_NOMBRE" FROM "RA_ACCION" WHERE "RA_ID"=$1`,
            [id]
        );

        const danos = await pool.query(
            `SELECT "DA_NOMBRE" FROM "RA_DANO" WHERE "RA_ID"=$1`,
            [id]
        );

        const comision = await pool.query(
            `SELECT * FROM "RA_COMISION" WHERE "RA_ID"=$1`,
            [id]
        );

        const data = {
            fecha: reporte.rows[0].RA_FECHA,
            unidad_numero: reporte.rows[0].RA_UNIDAD_NUMERO,
            folio_numero: reporte.rows[0].RA_FOLIO_NUMERO,
            direccion: reporte.rows[0].RA_DIRECCION,
            hora_inicio_llamada: reporte.rows[0].RA_HORA_INICIO ? reporte.rows[0].RA_HORA_INICIO.slice(0, 5) : null,
            hora_activacion: reporte.rows[0].RA_HORA_ACTIVACION ? reporte.rows[0].RA_HORA_ACTIVACION.slice(0, 5) : null,
            hora_en_sitio: reporte.rows[0].RA_HORA_SITIO ? reporte.rows[0].RA_HORA_SITIO.slice(0, 5) : null,
            hora_culminacion: reporte.rows[0].RA_HORA_CULMINACION ? reporte.rows[0].RA_HORA_CULMINACION.slice(0, 5) : null,
            condicion: reporte.rows[0].RA_CONDICION,
            observaciones: reporte.rows[0].RA_OBSERVACIONES,
            elaborado_por: reporte.rows[0].RA_ELABORADO_POR,
            cargo: reporte.rows[0].RA_CARGO,
            cedula_identidad: reporte.rows[0].RA_CEDULA,
            tipos_actividad: tipos.rows.map(r => r.TA_NOMBRE),
            acciones_tomadas: acciones.rows.map(r => r.AC_NOMBRE),
            danos: danos.rows.map(r => r.DA_NOMBRE),
            comision: comision.rows
        };

        console.log("Datos del reporte:", reporte.rows[0]);
        console.log("Tipos de actividad:", tipos.rows);
        console.log("Acciones tomadas:", acciones.rows);
        console.log("Daños:", danos.rows);
        console.log("Comisión:", comision.rows);

        console.log("Datos enviados a generateReportePDF:", data);
        const pdfBytes = await generateReportePDF(data);

        res.setHeader("Content-Type", "application/pdf");
        res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al generar PDF" });
    }
};

export const eliminarReporte = async (req, res) => {
    try {
        const { id } = req.params;

        // Eliminar registros relacionados primero (por FK)
        await pool.query(
            `DELETE FROM "RA_TIPO_ACTIVIDAD" WHERE "RA_ID" = $1`,
            [id]
        );

        await pool.query(
            `DELETE FROM "RA_ACCION" WHERE "RA_ID" = $1`,
            [id]
        );

        await pool.query(
            `DELETE FROM "RA_DANO" WHERE "RA_ID" = $1`,
            [id]
        );

        await pool.query(
            `DELETE FROM "RA_COMISION" WHERE "RA_ID" = $1`,
            [id]
        );

        // Eliminar reporte principal
        const result = await pool.query(
            `DELETE FROM "RA_REPORTE" WHERE "RA_ID" = $1 RETURNING *`,
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: "Reporte no encontrado" });
        }

        res.json({
            message: "Reporte eliminado correctamente",
            reporte: result.rows[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al eliminar reporte" });
    }
};
