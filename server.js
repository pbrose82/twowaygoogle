import express from "express";
import alchemyRoutes from "./alchemyMiddleware.js";

const app = express();
app.use(express.json());

// ✅ Attach middleware
app.use("/", alchemyRoutes);

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Middleware running on port ${PORT}`);
});
