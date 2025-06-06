import mongoose from 'mongoose';

const db = async () => {
  try {
    console.log("MONGODB_URI:", process.env.MONGODB_URI); 

    if (!process.env.MONGODB_URI) {
      throw new Error("❌ MONGODB_URI is not defined in .env file");
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
};

export default db;
