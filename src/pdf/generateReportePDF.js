import fs from "fs";
import path from "path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const M = 30;
const PAGE_W = 612;
const PAGE_H = 792;
const LINE = 18;

/* ===== CONFIG LOGOS (EDITABLES) ===== */
const LOGO_LEFT = { path: "src/assets/logo1.png", width: 170, height: 50 };
const LOGO_RIGHT = { path: "src/assets/logopc2.png", width: 100, height: 85 };

/* ===== COLOR ===== */
const GRIS_PLOMO = rgb(0.88, 0.88, 0.88);

const formatDate = (v) => {
  const d = new Date(v);
  if (isNaN(d)) return v || "";
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
};

export async function generateReportePDF(data) {

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const txt = (p,t,x,y,s=8,b=false)=>
    p.drawText(String(t||""),{x,y,size:s,font:b?bold:font});

  const txtCenter = (p, t, y, size = 7) => {
    const text = String(t || "");
    const w = italic.widthOfTextAtSize(text, size);
    p.drawText(text,{
      x:(PAGE_W-w)/2,
      y,
      size,
      font:italic
    });
  };

  const box = (p,x,y,w,h,fill=null)=>
    p.drawRectangle({
      x,y,width:w,height:h,
      borderWidth:1,
      borderColor:rgb(0,0,0),
      color: fill || undefined
    });

  const chk = (p,x,y,v)=>{
    box(p,x,y,10,10);
    if(v){
      p.drawLine({start:{x:x+1,y:y+1},end:{x:x+9,y:y+9},thickness:1});
      p.drawLine({start:{x:x+9,y:y+1},end:{x:x+1,y:y+9},thickness:1});
    }
  };

  const loadImg = async (filePath) => {
    const p = path.resolve(filePath);
    if (!fs.existsSync(p)) return null;
    return await pdf.embedPng(fs.readFileSync(p));
  };

  const logoL = await loadImg(LOGO_LEFT.path);
  const logoR = await loadImg(LOGO_RIGHT.path);

  /* =========================
     PAGE 1
  ========================= */
  const p = pdf.addPage([PAGE_W,PAGE_H]);
  let y = PAGE_H - 40;

  if(logoL) p.drawImage(logoL,{x:M,y:y-LOGO_LEFT.height,width:LOGO_LEFT.width,height:LOGO_LEFT.height});
  if(logoR) p.drawImage(logoR,{x:PAGE_W-M-LOGO_RIGHT.width,y:y-LOGO_RIGHT.height,width:LOGO_RIGHT.width,height:LOGO_RIGHT.height});

  y -= Math.max(LOGO_LEFT.height, LOGO_RIGHT.height) + 10;

  txt(p,"REPORTE DE ACTIVIDADES",M,y-15,14,true);
  y -= 30;

  // FECHA / UNIDAD / FOLIO
  box(p,M,y-30,160,30);
  box(p,M+160,y-30,200,30);
  box(p,M+360,y-30,192,30);

  /*txt(p,"FECHA",M+5,y-12,8,true);
  txt(p,formatDate(data.fecha),M+5,y-25);
  txt(p,"UNIDAD Nº",M+165,y-12,8,true);
  txt(p,data.unidad_numero,M+165,y-25);
  txt(p,"FOLIO Nº",M+365,y-12,8,true);
  txt(p,data.folio_numero,M+365,y-25);*/


  // CENTROS DE CADA CELDA
const cFecha  = M + 160 / 2;
const cUnidad = M + 160 + 200 / 2;
const cFolio  = M + 360 + 192 / 2;

/* ===== FECHA ===== */
const lf = "FECHA";
const lfW = bold.widthOfTextAtSize(lf, 8);
txt(p, lf, cFecha - lfW / 2, y - 12, 8, true);

const vf = formatDate(data.fecha);
const vfW = font.widthOfTextAtSize(vf, 8);
txt(p, vf, cFecha - vfW / 2, y - 25,10);

/* ===== UNIDAD ===== */
const lu = "UNIDAD Nº";
const luW = bold.widthOfTextAtSize(lu, 8);
txt(p, lu, cUnidad - luW / 2, y - 12, 8, true);

const vu = data.unidad_numero || "";
const vuW = font.widthOfTextAtSize(vu, 8);
txt(p, vu, cUnidad - vuW / 2, y - 25,10);

/* ===== FOLIO ===== */
const lf2 = "FOLIO Nº";
const lf2W = bold.widthOfTextAtSize(lf2, 8);
txt(p, lf2, cFolio - lf2W / 2, y - 12, 8, true);

const vf2 = data.folio_numero || "";
const vf2W = font.widthOfTextAtSize(vf2, 8);
txt(p, vf2, cFolio - vf2W / 2, y - 25,10);

  y -= 30;

  // DIRECCION
  box(p,M,y-30,552,30);
  txt(p,"DIRECCIÓN:",M+5,y-12,8,true);
  txt(p,data.direccion,M+60,y-20,10);
  y -= 30;

  // HORAS
  const hw = 552/4;
  ["INICIO","ACTIVACIÓN","EN SITIO","CULMINACIÓN"].forEach((t,i)=>{
    box(p,M+i*hw,y-30,hw,30);
    txt(p,`HORA ${t}`,M+i*hw+5,y-12,7,true);
  });
  txt(p,data.hora_inicio_llamada,M+5,y-25,10);
  txt(p,data.hora_activacion,M+hw+5,y-25,10);
  txt(p,data.hora_en_sitio,M+hw*2+5,y-25,10);
  txt(p,data.hora_culminacion,M+hw*3+5,y-25,10);
  y -= 30;

  // TIPO ACTIVIDAD
  box(p,M,y-150,552,150);
  txt(p,"TIPO DE ACTIVIDAD",M+5,y-12,9,true);
  const acts=[ "ACCIDENTE DE TRANSITO","MAT-PEL","TALA DE ARBOL","EMERGENCIAS MEDICAS","DETRESFA",
    "BUSQUEDA","INCENDIO DE ESTRUCTURA","RECUPERACION DE CADAVER","POV","INCENDIO VEHICULAR",
    "INSPECCION","EVENTO","INCENDIO FORESTAL","RESCATE DE PERSONA","OTROS __________________"];
  acts.forEach((a,i)=>{
    const c=i%3,r=Math.floor(i/3);
    chk(p,M+15+c*180,y-35-r*LINE,data.tipos_actividad?.includes(a));
    txt(p,a,M+30+c*180,y-33-r*LINE);
  });
  y -= 150;

  // CONDICION
  box(p,M,y-40,552,40);
  txt(p,"CONDICIÓN",M+5,y-12,9,true);
  ["NORMAL","URGENTE","EMERGENCIA","OTROS ____________"].forEach((c,i)=>{
    chk(p,M+20+i*130,y-30,data.condicion===c);
    txt(p,c,M+35+i*130,y-28);
  });
  y -= 40;

  // ACCIONES
  box(p,M,y-60,552,60);
  txt(p,"ACCIONES TOMADAS",M+5,y-12,9,true);
  ["ELIMINACIÓN DE RIESGOS","ACORDONAMIENTO","ESTABILIZACIÓN DEL PACIENTE",
   "INMOVILIZACIÓN DEL PACIENTE","OTROS _____________________"].forEach((a,i)=>{
    chk(p,M+20+(i%3)*180,y-30-Math.floor(i/3)*LINE,data.acciones_tomadas?.includes(a));
    txt(p,a,M+35+(i%3)*180,y-28-Math.floor(i/3)*LINE);
  });
  y -= 60;

  // DAÑOS
  box(p,M,y-80,552,80);
  txt(p,"DAÑOS",M+5,y-12,9,true);
  ["ALUMBRADO PUBLICO","HIDRANTES","VIVIENDAS","PUENTES","VIAS COMUNICACION",
   "VEHICULOS","INST PUB","INST PRIV","OTROS___________________"].forEach((d,i)=>{
    chk(p,M+20+(i%4)*135,y-30-Math.floor(i/4)*LINE,data.danos?.includes(d));
    txt(p,d,M+35+(i%4)*135,y-28-Math.floor(i/4)*LINE);
  });
  y -= 80; // 🔽 bajado para no chocar

  // COMISION
  const roles=["OPERADOR / DESPACHADOR","JEFE DE COMISION","CONDUCTOR","AUXILIAR","AUXILIAR","AUXILIAR"];
  const comH = roles.length * LINE + 50;
  box(p,M,y-comH,552,comH);
  txt(p,"COMISIÓN",M+5,y-12,9,true);

  box(p,M,y-50,185,LINE,GRIS_PLOMO);
  box(p,M+185,y-50,220,LINE,GRIS_PLOMO);
  box(p,M+405,y-50,147,LINE,GRIS_PLOMO);

 
 /* txt(p,"NOMBRE",M+190,y-45,8,true);
  txt(p,"ORGANISMO",M+410,y-45,8,true);*/

    // CENTROS
    const cRol  = M + 185 / 2;
    const cNom  = M + 185 + 220 / 2;
    const cOrg  = M + 405 + 147 / 2;

    // HEADERS
    const hNom = "NOMBRE";
    const hNomW = bold.widthOfTextAtSize(hNom, 8);
    txt(p, hNom, cNom - hNomW / 2, y - 45, 8, true);

    const hOrg = "ORGANISMO";
    const hOrgW = bold.widthOfTextAtSize(hOrg, 8);
    txt(p, hOrg, cOrg - hOrgW / 2, y - 45, 8, true);


  /*let ry = y-50;
  roles.forEach((r,i)=>{
    ry -= LINE;
    box(p,M,ry,185,LINE);
    box(p,M+185,ry,220,LINE);
    box(p,M+405,ry,147,LINE);
    txt(p,r,M+8,ry+5);
    txt(p,data.comision?.[i]?.nombre||"",M+190,ry+5);
    txt(p,"INAPROCET",M+410,ry+5);
  });*/

  let ry = y - 50;

roles.forEach((r, i) => {
  ry -= LINE;

  box(p, M, ry, 185, LINE);
  box(p, M + 185, ry, 220, LINE);
  box(p, M + 405, ry, 147, LINE);

  // ROL (opcional, si lo quieres centrado también)
  const rW = font.widthOfTextAtSize(r, 8);
  /*txt(p, r, cRol - rW / 2, ry + 5);*/
   txt(p,r,M+8,ry+5);

  // NOMBRE
  const nom = data.comision?.[i]?.CO_NOMBRE || "";
  const nomW = font.widthOfTextAtSize(nom, 8);
  txt(p, nom, cNom - nomW / 2, ry + 5);

  // ORGANISMO
  const org = "INAPROCET";
  const orgW = font.widthOfTextAtSize(org, 8);
  txt(p, org, cOrg - orgW / 2, ry + 5);
});


  /* =========================
     PAGE 2 – OBSERVACIONES
  ========================= */
  const p2 = pdf.addPage([PAGE_W,PAGE_H]);
  let y2 = PAGE_H - 40;

  if(logoL) p2.drawImage(logoL,{x:M,y:y2-LOGO_LEFT.height,width:LOGO_LEFT.width,height:LOGO_LEFT.height});
  if(logoR) p2.drawImage(logoR,{x:PAGE_W-M-LOGO_RIGHT.width,y:y2-LOGO_RIGHT.height,width:LOGO_RIGHT.width,height:LOGO_RIGHT.height});

  y2 -= Math.max(LOGO_LEFT.height,LOGO_RIGHT.height) + 30;


  const OBS_OFFSET = 4; // ⬅️ ajusta aquí (sube/baja todo el módulo)

// TÍTULO
  txt(p2,"OBSERVACIONES",M,y2-OBS_OFFSET,12,true);
  box(p2,M,y2-450,552,440);

  // Wrap text every 100 characters
  const observacionesText = String(data.observaciones || "");
  const wrappedText = observacionesText.replace(/(.{100})/g, "$1\n");

  p2.drawText(wrappedText, {
    x: M + 10,
    y: y2 - 50, // Adjusteded y-coordinate to ensure text starts lower
    size: 9,
    font,
    maxWidth: 532,     // 552 - 20
    lineHeight: 12     // Reduced line height to fit more lines within the box
  });


  // FIRMAS
  const sigY = y2-480;
  const sw = 552/3;
  box(p2,M,sigY-30,sw,60);
  box(p2,M+sw,sigY-30,sw,60);
  box(p2,M+sw*2,sigY-30,sw,60);

// CENTROS DE CADA CELDA
const c1 = M + sw / 2;
const c2 = M + sw + sw / 2;
const c3 = M + sw * 2 + sw / 2;

// ===== ELABORADO POR =====
const l1 = "ELABORADO POR:";
const l1W = bold.widthOfTextAtSize(l1, 8);
txt(p2, l1, c1 - l1W / 2, sigY + 15, 8, true);

const v1 = data.elaborado_por || "";
const v1W = font.widthOfTextAtSize(v1, 8);
txt(p2, v1, c1 - v1W / 2, sigY - 10,9);

// ===== CARGO =====
const l2 = "CARGO:";
const l2W = bold.widthOfTextAtSize(l2, 8);
txt(p2, l2, c2 - l2W / 2, sigY + 15, 8, true);

const v2 = data.cargo || "";
const v2W = font.widthOfTextAtSize(v2, 8);
txt(p2, v2, c2 - v2W / 2, sigY - 10, 8);

/*// ===== CÉDULA / FIRMA =====
const l3 = "CÉDULA / FIRMA";
const l3W = bold.widthOfTextAtSize(l3, 8);
txt(p2, l3, c3 - l3W / 2, sigY + 15, 8, true);

const v3 = data.cedula_identidad || "";
const v3W = font.widthOfTextAtSize(v3, 8);
txt(p2, v3, c3 - v3W / 2, sigY - 10);*/


  txt(p2,"CÉDULA:",M+sw*2+5,sigY+20,8,true);
  txt(p2,data.cedula_identidad,M+sw*2+70,sigY+20,9);
  txt(p2,"FIRMA:",M+sw*2+5,sigY-5,8,true);

  const footer = [
    "___________________________________________________________________________________________________",
    "Sector Pueblo Nuevo, frente a Plaza Monumental de Toros, San Cristóbal, Estado Táchira.",
    "Contacto: (58-276) 3531907. Correo Electrónico: pacd.tachira.operaciones@gmail.com",
    "Web: http://www.pctachira.com"
  ];

  footer.forEach((l,i)=>{
    txtCenter(p,l,38-i*10);
    txtCenter(p2,l,60-i*10);
  });

  return await pdf.save();
}
