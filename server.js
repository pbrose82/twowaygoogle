import express from "express";
import googleRoutes from "./googleMiddleware.js";
import alchemyRoutes from "./alchemyMiddleware.js";

const app = express();
app.use(express.json());

app.use("/", googleRoutes);
app.use("/", alchemyRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Middleware running on port ${PORT}`);
});
