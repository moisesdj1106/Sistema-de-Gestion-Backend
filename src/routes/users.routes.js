import { Router } from "express";
import {  validarUsuario, checkExistence, getTipoDocumentos, getComunidades, crearNoticia, obtenerNoticias, getDesastres, createUser, getComunidad, getParroquias, crearComunidad, editarComunidad, eliminarComunidad, crearAfectacion, getComunidadesNombres, getDesastresNombres, getAfectaciones, crearDamnificado, crearVictima, listarDamnificados, editarDamnificado, eliminarDamnificado, listarVictimas, editarVictima, eliminarVictima, getZonasAfectadas, getTiposPerdida, crearPerdidas, getTiposDocument, listarPerdidas, editarPerdida, eliminarPerdida, getDashboardData, registrarDonante, getTiposDonante, registrarDonacion, listarDonantes, getTiposEstiloDonacion, listarDonaciones, editarDonacion, eliminarDonacion, editarDonante, eliminarDonante, listarDonantesFull, eliminarNoticia, solicitarRecuperacion, restablecerContrasena, listarPaises, listarEstadosPorPais, listarMunicipiosPorEstado, listarParroquiasPorMunicipio, listarComunidadesPorParroquia, listarAfectaciones, editarAfectacion, eliminarAfectacion, obtenerUltimaAfectacion, generarPdfAfectacion, listarAfectacionesResumenPorFecha, generarPdfResumenAfectacionesPorFecha, listarUsuarios, editarUsuario, eliminarUsuario } from "../controllers/users.controllers.js";

const router = Router();

router.post("/users", createUser);

router.post("/login", validarUsuario); 

router.get("/documento", getTipoDocumentos);

router.get('/comunidad', getComunidades);

router.post('/noticias', crearNoticia);

router.delete('/noticias/:id', eliminarNoticia);


router.get('/noticias', obtenerNoticias);

router.get('/desastres', getDesastres);

/////// comunidades ////

router.get('/comunidades', getComunidad);
router.get('/parroquias', getParroquias);
router.post('/comunidades', crearComunidad);
router.put('/comunidades/:codcom', editarComunidad);
router.delete('/comunidades/:codcom', eliminarComunidad);

// afectaciones //

router.post('/afectaciones', crearAfectacion);
router.get('/comunidades/nombres', getComunidadesNombres);
router.get('/desastres/nombres', getDesastresNombres);

/// damnificados y victimas //

router.get('/afectacion', getAfectaciones); // Para el select de comunidades afectadas
router.post('/damnificados', crearDamnificado);
router.post('/victimas', crearVictima);

/// crud damnificados y victimas 


// ...otras rutas...

// CRUD damnificados
router.get('/damnificados/lista', listarDamnificados);
router.put('/damnificados/editar/:id', editarDamnificado);
router.delete('/damnificados/eliminar/:id', eliminarDamnificado);

// CRUD víctimas
router.get('/victimas/lista', listarVictimas);
router.put('/victimas/editar/:id', editarVictima);
router.delete('/victimas/eliminar/:id', eliminarVictima);


// zonas 
router.get('/zonas-afectadas', getZonasAfectadas);

// perdidas
router.post('/perdidas', crearPerdidas);
router.get('/tipos-perdida', getTiposPerdida);
router.get('/tipos-documento', getTiposDocument);

// listar perdidas

router.get('/perdidas/lista', listarPerdidas);
router.put('/perdidas/editar/:id', editarPerdida);
router.delete('/perdidas/eliminar/:id', eliminarPerdida);

// dasboard
router.get('/dashboard', getDashboardData);
// doanntes
router.post('/donantes', registrarDonante);

router.get('/tipos-donante', getTiposDonante);
// donanciones 
router.post('/donaciones', registrarDonacion);
router.get('/donantesregistrados', listarDonantes);
router.get('/tipos-estilo-donacion', getTiposEstiloDonacion);

router.get('/donaciones', listarDonaciones);
router.put('/donaciones/:id', editarDonacion);
router.delete('/donaciones/:id', eliminarDonacion);

router.put('/donantes/:id', editarDonante);
router.delete('/donantes/:id', eliminarDonante);
router.get('/donantesfull', listarDonantesFull);

/// recuperar usuario
router.post('/solicitar-recuperacion', solicitarRecuperacion);

router.post('/restablecer/:token', restablecerContrasena);


router.get('/paises', listarPaises);
router.get('/estados/:codpais', listarEstadosPorPais);
router.get('/municipios/:coesta', listarMunicipiosPorEstado);
router.get('/parroquias/:comuni', listarParroquiasPorMunicipio);
router.get('/comunidades/:coparr', listarComunidadesPorParroquia);


// Ejemplo en tu archivo de rutas
router.get('/afectaciones/ultima', obtenerUltimaAfectacion);
router.get('/afectaciones', listarAfectaciones);
router.put('/afectaciones/:id', editarAfectacion);
router.delete('/afectaciones/:id', eliminarAfectacion);


router.get('/afectaciones/resumen/pdf', generarPdfResumenAfectacionesPorFecha);
router.get('/afectaciones/:id/pdf', generarPdfAfectacion);
router.get('/afectaciones/resumen', listarAfectacionesResumenPorFecha);


// editar usuarios
router.get('/usuarios', listarUsuarios);
router.put('/usuarios/:cedula', editarUsuario);
router.delete('/usuarios/:cedula', eliminarUsuario);
router.get('/existe', checkExistence);

export default router;