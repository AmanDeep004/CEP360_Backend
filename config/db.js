import mongoose from "mongoose";

let primaryConnection = null;
let secondaryConnection = null;

export const connectDB = async () => {
  try {
    console.log("Connecting to databases...");
    console.log("Primary URI:", process.env.MONGO_URI);
    console.log("Secondary URI:", process.env.MONGO_URI1);

    // Connection options
    const connectionOptions = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    };

    // Create both connections
    primaryConnection = mongoose.createConnection(
      process.env.MONGO_URI,
      connectionOptions
    );
    secondaryConnection = mongoose.createConnection(
      process.env.MONGO_URI1,
      connectionOptions
    );

    // Wait for both connections to be established
    await Promise.all([
      new Promise((resolve, reject) => {
        primaryConnection.once("open", () => {
          console.log("Primary DB connected successfully");
          resolve();
        });
        primaryConnection.once("error", reject);
      }),
      new Promise((resolve, reject) => {
        secondaryConnection.once("open", () => {
          console.log("Secondary DB connected successfully");
          resolve();
        });
        secondaryConnection.once("error", reject);
      }),
    ]);

    console.log("All database connections established");
    return { primaryConnection, secondaryConnection };
  } catch (error) {
    console.error(" DB Connection Error:", error.message);
    process.exit(1);
  }
};

export const getPrimaryConnection = () => {
  if (!primaryConnection) {
    throw new Error(
      "Primary DB not connected. Make sure to call connectDB() first."
    );
  }
  return primaryConnection;
};

export const getSecondaryConnection = () => {
  if (!secondaryConnection) {
    throw new Error(
      "Secondary DB not connected. Make sure to call connectDB() first."
    );
  }
  return secondaryConnection;
};

export { primaryConnection, secondaryConnection };

// import { connect } from "mongoose";
// const connectDB = async () => {
//   try {
//     const conn = await connect(process.env.MONGO_URI);
//     console.log(`MongoDB Connected: ${conn.connection.host}`);
//   } catch (error) {
//     console.error(`Error: ${error.message}`);
//     process.exit(1);
//   }
// };
// export default connectDB;
