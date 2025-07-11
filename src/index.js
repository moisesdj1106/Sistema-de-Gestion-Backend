import express from "express";
import cors from "cors";
import { PORT } from "./config.js";
import usersRoutes from "./routes/users.routes.js";
import morgan from "morgan";

const app = express();

app.use(cors({ origin: ["http://localhost:3000","https://sistema-de-gestion-desastres.netlify.app"] }));
app.use(morgan("dev"));

// SOLO ESTA LÍNEA, antes de las rutas
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use(usersRoutes);

app.listen(PORT, () => {
  console.log("Server on port", PORT);
});