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

// Crear usuario
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

    // Validaciones
    if (!cedula) errors.push('Cédula es obligatoria');
    else if (!digitsRegex.test(cedula)) errors.push('Cédula inválida (solo dígitos)');

    if (!nombres) errors.push('Nombres son obligatorios');
    else if (!nameRegex.test(nombres)) errors.push('Nombres inválidos solo letras (solo letras, espacios,)');

    if (apellidos && !nameRegex.test(apellidos)) errors.push('Apellidos inválidos solo letras (solo letras, espacios, - y \')');

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

    // Pre-check en BD para cédula, usuario o correo existentes
    const conflict = await pool.query(
      `SELECT "TMA_CEDULA", "TMA_USUARI", "TMA_CORREO" FROM "BDTMA_USUA"
       WHERE "TMA_CEDULA" = $1 OR "TMA_USUARI" = $2 OR "TMA_CORREO" = $3 LIMIT 1`,
      [cedula, usuario, email]
    );
    if (conflict.rows.length > 0) {
      const row = conflict.rows[0];
      const detalles = [];
      if (row.TMA_CEDULA && String(row.TMA_CEDULA) === cedula) detalles.push('Cédula ya registrada');
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
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
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
            ) VALUES ($1, $2, NOW(), $3, $4, $5) RETURNING *`,
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
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [nombre, apelli, fenaci, contac, coafec, esalud, cedula, tipodo]
        );
        res.status(201).json({ mensaje: "Damnificado registrado", damnificado: result.rows[0] });
    } catch (error) {
        console.error("Error al registrar damnificado:", error);
        res.status(500).json({ mensaje: "Error al registrar damnificado", error: error.message });
    }
};

// Registrar víctima (con apellido)
export const crearVictima = async (req, res) => {
    try {
        const { cedula, tipodo, nombre, apelli, coafec, certif } = req.body;
        if (!cedula || !tipodo || !nombre || !apelli || !coafec) {
            return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
        }
        // Validar que no exista ya como víctima en la misma afectación
        const victima = await pool.query(
            `SELECT 1 FROM "BDTTR_VICT" WHERE "TTR_CEDULA" = $1 AND "TTR_COAFEC" = $2 LIMIT 1`,
            [cedula, coafec]
        );
        if (victima.rows.length > 0) {
            return res.status(400).json({ mensaje: "Ya existe una víctima con esa cédula en esta afectación." });
        }
        
        const result = await pool.query(
            `INSERT INTO "BDTTR_VICT" (
                "TTR_CEDULA", "TTR_TIPODO", "TTR_NOMBRE", "TTR_APELLI", "TTR_COAFEC", "TTR_CERTIF"
            ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [cedula, tipodo, nombre, apelli, coafec, certif]
        );
        res.status(201).json({ mensaje: "Víctima registrada", victima: result.rows[0] });
    } catch (error) {
        console.error("Error al registrar víctima:", error);
        res.status(500).json({ mensaje: "Error al registrar víctima", error: error.message });
    }
};

/// crud damnificados y victimas 
// Listar damnificados con búsqueda y paginación
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
             SET "TTR_NOMBRE"=$1, "TTR_APELLI"=$2, "TTR_FENACI"=$3, "TTR_CONTAC"=$4, "TTR_COAFEC"=$5, "TTR_ESALUD"=$6, "TTR_CEDULA"=$7, "TTR_TIPODO"=$8
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
        const { cedula, tipodo, nombre, apelli, coafec, certif } = req.body;
        const result = await pool.query(
            `UPDATE "BDTTR_VICT"
             SET "TTR_CEDULA"=$1, "TTR_TIPODO"=$2, "TTR_NOMBRE"=$3, "TTR_APELLI"=$4, "TTR_COAFEC"=$5, "TTR_CERTIF"=$6
             WHERE "TTR_COVICT"=$7 RETURNING *`,
            [cedula, tipodo, nombre, apelli, coafec, certif, id]
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

// Registrar varias pérdidas (con datos personales)
export const crearPerdidas = async (req, res) => {
    try {
        const { coafec, perdidas, coddoc, cedula, nombre, apelli } = req.body;
        if (!coafec || !coddoc || !cedula || !nombre || !apelli || !Array.isArray(perdidas) || perdidas.length === 0) {
            return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
        }
        // Validar cada pérdida
        for (const p of perdidas) {
            if (!p.cotipo || !p.vaesti) {
                return res.status(400).json({ mensaje: "Faltan datos en una de las pérdidas" });
            }
        }
        // Insertar cada pérdida
        const results = [];
        for (const p of perdidas) {
            const result = await pool.query(
                `INSERT INTO "BDTTR_PERD" (
                    "TTR_COAFEC", "TTR_COTIPO", "TTR_VAESTI", "TTR_CODDOC", "TTR_CEDULA", "TTR_NOMBRE", "TTR_APELLI"
                ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [coafec, p.cotipo, p.vaesti, coddoc, cedula, nombre, apelli]
            );
            results.push(result.rows[0]);
        }
        res.status(201).json({ mensaje: "Pérdidas registradas", perdidas: results });
    } catch (error) {
        console.error("Error al registrar pérdidas:", error);
        res.status(500).json({ mensaje: "Error al registrar pérdidas", error: error.message });
    }
};

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
             SET "TTR_COAFEC"=$1, "TTR_COTIPO"=$2, "TTR_VAESTI"=$3, "TTR_CODDOC"=$4, "TTR_CEDULA"=$5, "TTR_NOMBRE"=$6, "TTR_APELLI"=$7
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
        // Total fallecidos (víctimas con certificado)
        const victimas = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE "TTR_CERTIF" IS NOT NULL AND "TTR_CERTIF" != '') AS fallecidos
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
                COUNT(v."TTR_COVICT") FILTER (WHERE v."TTR_CERTIF" IS NOT NULL AND v."TTR_CERTIF" != '') as fallecidos
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
            WHERE "TTR_CERTIF" IS NOT NULL AND "TTR_CERTIF" != ''
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
    else if (!digitsRegex.test(cedula)) errors.push('Cédula inválida (solo dígitos)');
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


// Editar donante
export const editarDonante = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, contac, tipodn, cedula, coddoc } = req.body;
        const result = await pool.query(
            `UPDATE "BDTMA_DONT"
             SET "TMA_NOMBRE"=$1, "TMA_CONTAC"=$2, "TMA_TIPODN"=$3, "TMA_CEDULA"=$4, "TMA_CODDOC"=$5
             WHERE "TMA_CODONT"=$6 RETURNING *`,
            [nombre, contac, tipodn, cedula, coddoc, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ mensaje: "No encontrado" });
        res.json({ mensaje: "Donante actualizado", donante: result.rows[0] });
    } catch (error) {
        console.error("Error al editar donante:", error);
        res.status(500).json({ mensaje: "Error al editar donante" });
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






// Transporte SMTP configurable via .env (no credenciales en código)
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : undefined;
const EMAIL_SECURE = process.env.EMAIL_SECURE === 'true'; // true -> 465
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sistema-de-gestion-desastres.netlify.app';

const transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: EMAIL_PORT || (EMAIL_SECURE ? 465 : 587),
  secure: EMAIL_SECURE,
  auth: EMAIL_USER && EMAIL_PASS ? { user: EMAIL_USER, pass: EMAIL_PASS } : undefined,
  requireTLS: true,
  tls: { rejectUnauthorized: process.env.EMAIL_REJECT_UNAUTHORIZED !== 'false' },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  pool: false,
});

// Verificar transporter al arrancar (log)
transporter.verify()
  .then(() => console.log('Transporter SMTP verificado'))
  .catch(err => console.error('Advertencia: no se pudo verificar SMTP transporter:', err && err.message ? err.message : err));


// Solicitar recuperación (envía enlace SIN token en URL; token se guarda en BD)
export const solicitarRecuperacion = async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ mensaje: 'Correo requerido' });

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

    // Enlace al frontend SIN token
    const enlace = `${FRONTEND_URL}/restablecer`;

    const fromAddress = EMAIL_USER ? `"Soporte Liceo" <${EMAIL_USER}>` : '"Soporte Liceo" <no-reply@example.com>';

    const mailOptions = {
      from: fromAddress,
      to: email,
      subject: "Recuperación de acceso",
      html: `<p>Hola,</p>
             <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta (usuario: <strong>${usuario.TMA_USUARI || ''}</strong>).</p>
             <p>Por favor abre este enlace y completa el formulario indicando tu correo y la nueva contraseña:</p>
             <p><a href="${enlace}" target="_blank" rel="noopener">${enlace}</a></p>
             <p>Este enlace (la solicitud) expirará en 1 hora. Si no has solicitado el cambio, ignora este correo.</p>`
    };

    try {
      await transporter.sendMail(mailOptions);
      return res.json({ mensaje: "Correo de recuperación enviado" });
    } catch (mailErr) {
      console.error('Error enviando correo:', mailErr);
      if (mailErr && mailErr.code === 'ETIMEDOUT') {
        return res.status(500).json({ mensaje: "Tiempo de espera agotado al enviar correo. Revise la configuración SMTP o use un proveedor de envío (SendGrid/Mailgun)." });
      }
      if (mailErr && (mailErr.code === 'ECONNECTION' || /Auth|Invalid/.test(mailErr.message))) {
        return res.status(500).json({ mensaje: "Error de conexión o autenticación SMTP. Revise credenciales y configuración." });
      }
      return res.status(500).json({ mensaje: "Error enviando correo de recuperación", error: mailErr && mailErr.message ? mailErr.message : String(mailErr) });
    }
  } catch (error) {
    console.error('Error en solicitarRecuperacion:', error);
    return res.status(500).json({ mensaje: "Error procesando solicitud de recuperación", error: error.message });
  }
};


// Restablecer contraseña
// Soporta:
//  - POST /restablecer con { email, nuevaContrasena } (frontend nuevo)
//  - POST /restablecer/:token con { nuevaContrasena } (compatibilidad)
export const restablecerContrasena = async (req, res) => {
  const tokenParam = req.params?.token;
  const { email, nuevaContrasena } = req.body || {};

  if (!nuevaContrasena || String(nuevaContrasena).length < 6) {
    return res.status(400).json({ mensaje: "Contraseña inválida (mínimo 6 caracteres)" });
  }

  try {
    let usuarioRow;

    if (tokenParam) {
      // ruta antigua con token en URL
      const result = await pool.query(
        'SELECT * FROM "BDTMA_USUA" WHERE "TMA_RESETO" = $1 AND "TMA_RESETP" > NOW()',
        [tokenParam]
      );
      if (result.rows.length === 0) return res.status(400).json({ mensaje: "Token inválido o expirado" });
      usuarioRow = result.rows[0];
    } else {
      // nuevo flujo: se recibe email, verificamos que exista solicitud activa (TMA_RESETO no nulo y TMA_RESETP > now)
      if (!email) return res.status(400).json({ mensaje: "Email requerido" });

      const result = await pool.query(
        'SELECT * FROM "BDTMA_USUA" WHERE "TMA_CORREO" = $1 AND "TMA_RESETO" IS NOT NULL AND "TMA_RESETP" > NOW()',
        [email]
      );
      if (result.rows.length === 0) return res.status(400).json({ mensaje: "No hay una solicitud válida de restablecimiento para este correo (token inválido o expirado)" });
      usuarioRow = result.rows[0];
    }

    const hash = await bcrypt.hash(String(nuevaContrasena), 10);

    await pool.query(
      'UPDATE "BDTMA_USUA" SET "TMA_CONTRA" = $1, "TMA_RESETO" = NULL, "TMA_RESETP" = NULL WHERE "TMA_CEDULA" = $2 OR "TMA_CORREO" = $3',
      [hash, usuarioRow.TMA_CEDULA, usuarioRow.TMA_CORREO]
    );

    return res.json({ mensaje: "Contraseña restablecida correctamente" });
  } catch (error) {
    console.error('Error en restablecerContrasena:', error);
    return res.status(500).json({ mensaje: "Error al restablecer la contraseña", error: error.message });
  }
};
//# sourceMappingURL=usuarios.js.map