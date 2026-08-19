/**
 * Seed BrandsWorkedWith collection from Book4.xlsx
 * Run: node scripts/seedBrands.js
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongoose from "mongoose";
import XLSX from "xlsx";

const XLSX_PATH = "C:/Users/Admin/Downloads/Book4.xlsx";

// Connect to MasterDB
const conn = mongoose.createConnection(process.env.MONGO_URI1);
await new Promise((res, rej) => { conn.once("open", res); conn.once("error", rej); });
console.log("MasterDB connected");

const BrandSchema = new mongoose.Schema(
  { name: { type: String, required: true, trim: true, unique: true }, eventsCount: Number, addedBy: String },
  { timestamps: true }
);
const Brand = conn.model("BrandsWorkedWith", BrandSchema);

// Read Excel
const wb   = XLSX.readFile(XLSX_PATH);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const names = [...new Set(
  rows
    .map(r => (r["Account Name"] || "").toString().trim())
    .filter(Boolean)
)];
console.log(`Unique brands from Excel: ${names.length}`);

// Upsert
let inserted = 0, skipped = 0;
for (const name of names) {
  const exists = await Brand.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
  if (exists) { skipped++; continue; }
  await Brand.create({ name, addedBy: "seed" });
  inserted++;
}

console.log(`Done — inserted: ${inserted}, skipped (already existed): ${skipped}`);
await conn.close();
process.exit(0);
