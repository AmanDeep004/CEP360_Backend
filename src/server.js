import dotenv from 'dotenv'
import connectToDatabase from './configs/db.js';
import app from './app.js';

dotenv.config();

const startServer = async () => {
  try {
    await connectToDatabase();
    const PORT = process.env.PORT || 5001;

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port: ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to connect to database. Server not started.");
    process.exit(1);
  }
};

startServer();