// config.js
import dotenv from 'dotenv';
dotenv.config();
/*
export const DB_DATABASE = 'SISGESDESN';
export const DB_HOST = 'localhost';
export const DB_PASSWORD = 'moises';
export const DB_PORT = 54432;
export const DB_USER = 'postgres';
export const PORT = 4000;*/


export const DB_DATABASE = process.env.DB_DATABASE;
export const DB_HOST = process.env.DB_HOST;
export const DB_PASSWORD = process.env.DB_PASSWORD;
export const DB_PORT = process.env.DB_PORT;
export const DB_USER = process.env.DB_USER;
export const PORT = process.env.PORT || 4001;